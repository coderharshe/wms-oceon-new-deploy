import { Decimal } from "@prisma/client/runtime/library";
import { eq, and, inArray } from "drizzle-orm";
import { bill, payment, paymentTransaction, paymentAdjustment, order, customer } from "@/generated/drizzle/schema";
import type { getDrizzleDb } from "./drizzle-db";
import { assertResolutionDirection, computeChange, computePaymentStatus, evaluateBillChange, PaymentError, receivableDelta } from "./payments";
import { writeAuditDrizzle } from "./drizzle-audit";
import { publish } from "./realtime";
import { notifyDrizzle } from "./drizzle-notifications";
import { claimIdempotencyKeyDrizzle } from "./idempotency";
import { drizzleQ, recordCashMovement } from "./cash";

type Tx = import("./drizzle-db").DrizzleDbOrTx;

/** Drizzle equivalent of src/lib/payment-service.ts — same append-only-ledger design. */
export async function sumConfirmedPaymentsDrizzle(tx: Tx, paymentId: string) {
  const txs = await tx.select().from(paymentTransaction).where(and(eq(paymentTransaction.paymentId, paymentId), eq(paymentTransaction.status, "CONFIRMED")));
  let paid = new Decimal(0);
  for (const t of txs) paid = t.type === "REFUND" ? paid.sub(t.amount) : paid.add(t.amount);
  return paid;
}

const PRE_QC_STATUSES = ["BILLED", "PAYMENT_PENDING", "PAID"];

/** See the ACCOUNTS RECEIVABLE SIGN CONVENTION comment in payment-service.ts. */
/** Drizzle mirror of applyReceivableDelta — see payment-service.ts for the convention. */
export async function applyReceivableDeltaDrizzle(
  tx: Tx,
  customerId: string,
  prev: { due: Decimal | number | string; paid: Decimal | number | string },
  next: { due: Decimal | number | string; paid: Decimal | number | string }
) {
  const delta = receivableDelta(prev, next);
  if (delta.isZero()) return;
  const [cust] = await tx.select().from(customer).where(eq(customer.id, customerId));
  if (!cust) return;
  await tx
    .update(customer)
    .set({ outstandingBalance: new Decimal(cust.outstandingBalance).add(delta).toString() })
    .where(eq(customer.id, cust.id));
}

async function afterLedgerChange(tx: Tx, billId: string, warehouseId: string, orderId: string) {
  const [b] = await tx.select().from(bill).where(eq(bill.id, billId));
  const [pay] = await tx.select().from(payment).where(eq(payment.billId, billId));
  if (!b || !pay) return;
  const paid = await sumConfirmedPaymentsDrizzle(tx, pay.id);
  const status = computePaymentStatus(pay.amountDue, paid);
  const [ord] = await tx.select().from(order).where(eq(order.id, orderId));
  // Stored figures are read BEFORE the overwrite below — they are this bill's
  // previous contribution to the customer's receivable.
  if (ord) {
    await applyReceivableDeltaDrizzle(tx, ord.customerId, { due: pay.amountDue, paid: pay.amountPaid }, { due: pay.amountDue, paid });
  }
  await tx.update(payment).set({ amountPaid: paid.toString() }).where(eq(payment.id, pay.id));
  await tx.update(bill).set({ paymentStatus: status }).where(eq(bill.id, billId));

  if (status === "PAID") {
    const nextStatus = ord && PRE_QC_STATUSES.includes(ord.status) ? "PAID" : "READY_FOR_HANDOVER";
    if (ord && ord.status !== nextStatus) {
      await tx.update(order).set({ status: nextStatus as any, updatedAt: new Date().toISOString() }).where(eq(order.id, orderId));
    }
    await notifyDrizzle(tx, { role: "FINANCE", warehouseId, type: "PAYMENT_SUCCESSFUL", title: "Payment successful", message: `Bill ${b.billNumber} is fully paid` });
  }

  publish(`order:${orderId}`, "payment:updated", { billId, status, amountPaid: paid.toString() });
  publish(`warehouse:${warehouseId}`, "payment:updated", { orderId, billId, status });
  return { status, paid };
}

export async function recordCashPaymentDrizzle(tx: Tx, args: { billId: string; amountReceived: Decimal; userId: string; warehouseId: string; orderId: string; clickedAt?: Date; clientRequestId?: string }) {
  // A retried offline-queue flush (offline-fetch.ts) of the same click must
  // not double-charge — claimed before anything else runs.
  if (args.clientRequestId) await claimIdempotencyKeyDrizzle(tx, args.clientRequestId);
  // Row lock: serializes concurrent cash-collection attempts on the same
  // bill — see the matching comment in payment-service.ts's recordCashPayment.
  const [pay] = await tx.select().from(payment).where(eq(payment.billId, args.billId)).for("update");
  if (!pay) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPaymentsDrizzle(tx, pay.id);
  const remainingDue = new Decimal(pay.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const applied = Decimal.min(args.amountReceived, remainingDue);
  const change = computeChange(args.amountReceived, remainingDue);

  const [transaction] = await tx
    .insert(paymentTransaction)
    .values({
      id: crypto.randomUUID(),
      paymentId: pay.id,
      type: "PAYMENT",
      method: "CASH",
      amount: applied.toString(),
      amountReceived: args.amountReceived.toString(),
      changeGiven: change.toString(),
      status: "CONFIRMED",
      recordedByUserId: args.userId,
      clickedAt: args.clickedAt?.toISOString(),
    })
    .returning();

  await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);

  await recordCashMovement(drizzleQ(tx), { warehouseId: args.warehouseId, userId: args.userId, type: "SALE", amount: applied, referenceId: transaction!.id });

  await writeAuditDrizzle({ userId: args.userId, warehouseId: args.warehouseId, action: "PAYMENT_RECORDED", entityType: "PaymentTransaction", entityId: transaction!.id, newValue: { method: "CASH", amount: applied.toString(), amountReceived: args.amountReceived.toString() } }, tx);
  return { transaction, change };
}

export async function initiateUpiPaymentDrizzle(tx: Tx, args: { billId: string; userId: string; warehouseId: string; orderId: string }) {
  // Same row lock recordCashPaymentDrizzle takes: without it two taps on
  // "Show QR" each mint a PENDING transaction for the full due, and confirming
  // both charges the customer twice.
  const [pay] = await tx.select().from(payment).where(eq(payment.billId, args.billId)).for("update");
  if (!pay) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPaymentsDrizzle(tx, pay.id);
  const remainingDue = new Decimal(pay.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");

  // At most one live PENDING transaction per payment - see initiateUpiPayment.
  const pending = await tx.select().from(paymentTransaction).where(and(eq(paymentTransaction.paymentId, pay.id), eq(paymentTransaction.status, "PENDING")));
  const reusable = pending.find((p) => new Decimal(p.amount).eq(remainingDue));
  const staleIds = pending.filter((p) => p.id !== reusable?.id).map((p) => p.id);
  if (staleIds.length) {
    await tx.update(paymentTransaction).set({ status: "FAILED" }).where(inArray(paymentTransaction.id, staleIds));
  }

  const transaction =
    reusable ??
    (
      await tx
        .insert(paymentTransaction)
        .values({ id: crypto.randomUUID(), paymentId: pay.id, type: "PAYMENT", method: "UPI", amount: remainingDue.toString(), status: "PENDING", recordedByUserId: args.userId })
        .returning()
    )[0]!;

  publish(`order:${args.orderId}`, "payment:pending", { billId: args.billId, transactionId: transaction.id, amount: remainingDue.toString() });
  return transaction;
}

export async function confirmUpiPaymentDrizzle(tx: Tx, args: { transactionId: string; userId: string; warehouseId: string; orderId: string; billId: string; upiReference?: string; clickedAt?: Date }) {
  const [t0] = await tx.select().from(paymentTransaction).where(eq(paymentTransaction.id, args.transactionId));
  if (!t0) throw new PaymentError("Transaction is not pending");
  // Lock the same Payment row recordCashPaymentDrizzle locks, then re-read —
  // closes the race for two concurrent confirms of this transaction.
  const [pay] = await tx.select().from(payment).where(eq(payment.id, t0.paymentId)).for("update");
  const [transaction] = await tx.select().from(paymentTransaction).where(eq(paymentTransaction.id, args.transactionId));
  if (!transaction || transaction.status !== "PENDING") throw new PaymentError("Transaction is not pending");
  // The ledger, not the QR, decides what is still owed: cash or another UPI
  // confirm may have landed since this transaction was minted.
  const remainingDue = new Decimal(pay!.amountDue).sub(await sumConfirmedPaymentsDrizzle(tx, t0.paymentId));
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const amount = Decimal.min(transaction.amount, remainingDue);
  await tx.update(paymentTransaction).set({ status: "CONFIRMED", amount: amount.toString(), upiReference: args.upiReference ?? transaction.upiReference, clickedAt: args.clickedAt?.toISOString() }).where(eq(paymentTransaction.id, args.transactionId));
  const result = await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);
  await writeAuditDrizzle({ userId: args.userId, warehouseId: args.warehouseId, action: "PAYMENT_CONFIRMED", entityType: "PaymentTransaction", entityId: args.transactionId, newValue: { method: "UPI", status: "CONFIRMED" } }, tx);
  publish(`order:${args.orderId}`, "payment:confirmed", { billId: args.billId, status: result?.status });
  return result;
}

export async function failUpiPaymentDrizzle(tx: Tx, args: { transactionId: string; orderId: string }) {
  await tx.update(paymentTransaction).set({ status: "FAILED" }).where(eq(paymentTransaction.id, args.transactionId));
  publish(`order:${args.orderId}`, "payment:failed", { transactionId: args.transactionId });
}

export async function applyBillRevisionAdjustmentDrizzle(tx: Tx, args: { billId: string; previousTotal: Decimal; newTotal: Decimal; warehouseId: string; orderId: string }) {
  const [pay] = await tx.select().from(payment).where(eq(payment.billId, args.billId));
  if (!pay) throw new Error("Bill has no payment record");
  // The bill total moved, so what the customer owes on it moved with it —
  // including a cancellation, which revises the total to zero.
  const [revOrd] = await tx.select().from(order).where(eq(order.id, args.orderId));
  if (revOrd) {
    await applyReceivableDeltaDrizzle(tx, revOrd.customerId, { due: pay.amountDue, paid: pay.amountPaid }, { due: args.newTotal, paid: pay.amountPaid });
  }
  await tx.update(payment).set({ amountDue: args.newTotal.toString() }).where(eq(payment.id, pay.id));

  const paid = await sumConfirmedPaymentsDrizzle(tx, pay.id);
  const outcome = evaluateBillChange(args.newTotal, paid);

  // A revision that leaves the total unchanged owes nobody anything. Writing a
  // zero-difference row would park an unresolvable "Pending" adjustment on the
  // bill forever — no resolution type is valid for a difference of zero.
  const difference = args.newTotal.sub(args.previousTotal);
  if (!difference.isZero()) {
    await tx.insert(paymentAdjustment).values({
      id: crypto.randomUUID(),
      billId: args.billId,
      previousTotal: args.previousTotal.toString(),
      newTotal: args.newTotal.toString(),
      difference: difference.toString(),
    });
  }

  await tx.update(bill).set({ paymentStatus: outcome.status }).where(eq(bill.id, args.billId));
  publish(`order:${args.orderId}`, "bill:revised", { billId: args.billId, newTotal: args.newTotal.toString(), status: outcome.status });
  publish(`warehouse:${args.warehouseId}`, "bill:revised", { orderId: args.orderId, status: outcome.status });
  return outcome;
}

export async function resolvePaymentAdjustmentDrizzle(
  tx: Tx,
  args: { adjustmentId: string; resolutionType: "CASH_REFUND" | "UPI_REFUND" | "CUSTOMER_CREDIT" | "MANAGER_ADJUSTMENT" | "ADDITIONAL_PAYMENT"; userId: string; notes?: string; clickedAt?: Date; amount?: Decimal }
) {
  const [adj] = await tx.select().from(paymentAdjustment).where(eq(paymentAdjustment.id, args.adjustmentId));
  if (!adj) throw new Error("Adjustment not found");
  const [b] = await tx.select().from(bill).where(eq(bill.id, adj.billId));
  if (!b) throw new Error("Bill not found");

  // Resolving twice would write a second refund for the same difference.
  if (adj.resolutionType) throw new PaymentError("This adjustment has already been resolved");
  assertResolutionDirection(new Decimal(adj.difference), args.resolutionType);

  await tx.update(paymentAdjustment).set({ resolutionType: args.resolutionType, resolvedByUserId: args.userId, notes: args.notes }).where(eq(paymentAdjustment.id, args.adjustmentId));

  if (args.resolutionType === "ADDITIONAL_PAYMENT") return;
  const [pay] = await tx.select().from(payment).where(eq(payment.billId, adj.billId));
  if (!pay) return;

  const amount = args.amount ?? new Decimal(adj.difference).abs(); // see payment-service.ts
  const method = args.resolutionType === "UPI_REFUND" ? "UPI" : "CASH";
  const [refundTx] = await tx
    .insert(paymentTransaction)
    .values({ id: crypto.randomUUID(), paymentId: pay.id, type: "REFUND", method: method as any, amount: amount.toString(), status: "CONFIRMED", recordedByUserId: args.userId, clickedAt: args.clickedAt?.toISOString() })
    .returning();

  if (args.resolutionType === "CASH_REFUND") {
    await recordCashMovement(drizzleQ(tx), { warehouseId: b.warehouseId, userId: args.userId, type: "REFUND", amount, referenceId: refundTx!.id });
  }
  // CUSTOMER_CREDIT deliberately touches outstandingBalance only through the
  // REFUND row above: afterLedgerChange re-derives the customer's receivable
  // from the ledger, so a manual decrement here would count the credit twice.

  await afterLedgerChange(tx, adj.billId, b.warehouseId, b.orderId);
}
