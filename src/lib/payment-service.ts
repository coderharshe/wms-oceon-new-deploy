import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@/generated/prisma/client";
import { assertResolutionDirection, computeChange, computePaymentStatus, evaluateBillChange, PaymentError, receivableDelta } from "./payments";
import { writeAudit } from "./audit";
import { publish } from "./realtime";
import { notify } from "./notifications";
import { claimIdempotencyKey } from "./idempotency";
import { prismaQ, recordCashMovement } from "./cash";

type Tx = Prisma.TransactionClient;

/**
 * Payment amounts are never edited in place — they are derived by summing
 * the append-only PaymentTransaction ledger for the bill (PRD §7: "Finance
 * should not be allowed to silently overwrite payment records").
 */
export async function sumConfirmedPayments(tx: Tx, paymentId: string) {
  const txs = await tx.paymentTransaction.findMany({
    where: { paymentId, status: "CONFIRMED" },
  });
  let paid = new Decimal(0);
  for (const t of txs) {
    paid = t.type === "REFUND" ? paid.sub(t.amount) : paid.add(t.amount);
  }
  return paid;
}

// Orders still on the pre-QC side of the flow (PRD's own diagram: bill ->
// payment -> QC). Once an order has moved past this point, settling the
// ledger should push it toward handover, not back to "PAID" — that status
// means something different (and earlier) once QC has already run.
const PRE_QC_STATUSES = ["BILLED", "PAYMENT_PENDING", "PAID"];

/**
 * ACCOUNTS RECEIVABLE SIGN CONVENTION
 * `Customer.outstandingBalance` = money the CUSTOMER OWES THE STORE. It goes
 * UP when a bill is left unpaid and DOWN when payment is received; it is never
 * negative for a fully-settled customer. Because the payment ledger is
 * append-only and afterLedgerChange re-derives the whole bill on every write,
 * the balance is moved by the DELTA of this one bill's outstanding, never
 * assigned — otherwise the same bill would be counted once per transaction.
 */
/**
 * Moves a customer's receivable by the change in ONE bill's outstanding.
 *
 * Every place `amountDue` or `amountPaid` moves must route through here, or
 * the balance drifts: raising a bill increases what the customer owes,
 * collecting against it decreases it, and revising the total moves it either
 * way. Deltas (not assignment) because a customer has many bills and this
 * only ever knows about one of them.
 */
export async function applyReceivableDelta(
  tx: Tx,
  customerId: string,
  prev: { due: Decimal | number | string; paid: Decimal | number | string },
  next: { due: Decimal | number | string; paid: Decimal | number | string }
) {
  const delta = receivableDelta(prev, next);
  if (delta.isZero()) return;
  await tx.customer.update({ where: { id: customerId }, data: { outstandingBalance: { increment: delta } } });
}

async function afterLedgerChange(tx: Tx, billId: string, warehouseId: string, orderId: string) {
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { payment: true, order: true } });
  if (!bill.payment) return;
  const paid = await sumConfirmedPayments(tx, bill.payment.id);
  const status = computePaymentStatus(bill.payment.amountDue, paid);
  // Read the stored figures BEFORE overwriting amountPaid — they are this
  // bill's previous contribution to the customer's receivable.
  await applyReceivableDelta(
    tx,
    bill.order.customerId,
    { due: bill.payment.amountDue, paid: bill.payment.amountPaid },
    { due: bill.payment.amountDue, paid }
  );
  await tx.payment.update({ where: { id: bill.payment.id }, data: { amountPaid: paid } });
  await tx.bill.update({ where: { id: billId }, data: { paymentStatus: status } });

  if (status === "PAID") {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const nextStatus = PRE_QC_STATUSES.includes(order.status) ? "PAID" : "READY_FOR_HANDOVER";
    if (order.status !== nextStatus) {
      await tx.order.update({ where: { id: orderId }, data: { status: nextStatus } });
    }
    await notify(tx, {
      role: "FINANCE",
      warehouseId,
      type: "PAYMENT_SUCCESSFUL",
      title: "Payment successful",
      message: `Bill ${bill.billNumber} is fully paid`,
    });
  }

  publish(`order:${orderId}`, "payment:updated", { billId, status, amountPaid: paid.toString() });
  publish(`warehouse:${warehouseId}`, "payment:updated", { orderId, billId, status });
  return { status, paid };
}

/** Cash is synchronous — confirmed the moment it's recorded (PRD §17). */
export async function recordCashPayment(
  tx: Tx,
  args: { billId: string; amountReceived: Decimal; userId: string; warehouseId: string; orderId: string; clickedAt?: Date; clientRequestId?: string }
) {
  // A retried offline-queue flush (offline-fetch.ts) of the same click must
  // not double-charge — claimed before anything else runs.
  if (args.clientRequestId) await claimIdempotencyKey(tx, args.clientRequestId);
  // Row lock: serializes concurrent cash-collection attempts on the same bill
  // (two staff, or a retried/replayed request) so they can't both read the
  // same "remaining due" snapshot and both apply a full payment against it.
  const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
    SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
  `;
  if (!payment) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPayments(tx, payment.id);
  const remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const applied = Decimal.min(args.amountReceived, remainingDue);
  const change = computeChange(args.amountReceived, remainingDue);

  const transaction = await tx.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      type: "PAYMENT",
      method: "CASH",
      amount: applied,
      amountReceived: args.amountReceived,
      changeGiven: change,
      status: "CONFIRMED",
      recordedByUserId: args.userId,
      clickedAt: args.clickedAt,
    },
  });

  await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);

  // Feed the EOD reconciliation (PRD §19): into the collector's drawer,
  // which opens itself if this is their first cash of the session.
  await recordCashMovement(prismaQ(tx), { warehouseId: args.warehouseId, userId: args.userId, type: "SALE", amount: applied, referenceId: transaction.id });

  await writeAudit(
    {
      userId: args.userId,
      warehouseId: args.warehouseId,
      action: "PAYMENT_RECORDED",
      entityType: "PaymentTransaction",
      entityId: transaction.id,
      newValue: { method: "CASH", amount: applied.toString(), amountReceived: args.amountReceived.toString() },
    },
    tx
  );
  return { transaction, change };
}

/** UPI QR shown, not yet confirmed (PRD §18: never mark paid just for a displayed QR). */
export async function initiateUpiPayment(
  tx: Tx,
  args: { billId: string; userId: string; warehouseId: string; orderId: string }
) {
  // Same row lock recordCashPayment takes: without it two taps on "Show QR"
  // each mint a PENDING transaction for the full due, and confirming both
  // charges the customer twice.
  const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
    SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
  `;
  if (!payment) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPayments(tx, payment.id);
  const remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");

  // At most one live PENDING transaction per payment. One still matching the
  // current due is re-shown; any other is stale (bill revised, or cash taken
  // meanwhile) and is failed so its QR can never be confirmed later.
  const pending = await tx.paymentTransaction.findMany({ where: { paymentId: payment.id, status: "PENDING" } });
  const reusable = pending.find((p) => new Decimal(p.amount).eq(remainingDue));
  const staleIds = pending.filter((p) => p.id !== reusable?.id).map((p) => p.id);
  if (staleIds.length) {
    await tx.paymentTransaction.updateMany({ where: { id: { in: staleIds } }, data: { status: "FAILED" } });
  }

  const transaction =
    reusable ??
    (await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: "PAYMENT",
        method: "UPI",
        amount: remainingDue,
        status: "PENDING",
        recordedByUserId: args.userId,
      },
    }));

  publish(`order:${args.orderId}`, "payment:pending", {
    billId: args.billId,
    transactionId: transaction.id,
    amount: remainingDue.toString(),
  });
  return transaction;
}

export async function confirmUpiPayment(
  tx: Tx,
  args: { transactionId: string; userId: string; warehouseId: string; orderId: string; billId: string; upiReference?: string; clickedAt?: Date }
) {
  const t0 = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: args.transactionId } });
  // Lock the same Payment row recordCashPayment locks, then re-read the
  // transaction — closes the same race for two concurrent confirms of this
  // transaction (or a confirm racing a cash collection on the same bill).
  const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
    SELECT id, "amountDue" FROM "Payment" WHERE id = ${t0.paymentId} FOR UPDATE
  `;
  const transaction = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: args.transactionId } });
  if (transaction.status !== "PENDING") throw new PaymentError("Transaction is not pending");
  // The ledger, not the QR, decides what is still owed: cash or another UPI
  // confirm may have landed since this transaction was minted.
  const remainingDue = new Decimal(payment!.amountDue).sub(await sumConfirmedPayments(tx, t0.paymentId));
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const amount = Decimal.min(transaction.amount, remainingDue);
  await tx.paymentTransaction.update({
    where: { id: args.transactionId },
    data: { status: "CONFIRMED", amount, upiReference: args.upiReference ?? transaction.upiReference, clickedAt: args.clickedAt },
  });
  const result = await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);
  await writeAudit(
    {
      userId: args.userId,
      warehouseId: args.warehouseId,
      action: "PAYMENT_CONFIRMED",
      entityType: "PaymentTransaction",
      entityId: args.transactionId,
      newValue: { method: "UPI", status: "CONFIRMED" },
    },
    tx
  );
  publish(`order:${args.orderId}`, "payment:confirmed", { billId: args.billId, status: result?.status });
  return result;
}

export async function failUpiPayment(tx: Tx, args: { transactionId: string; orderId: string }) {
  await tx.paymentTransaction.update({ where: { id: args.transactionId }, data: { status: "FAILED" } });
  publish(`order:${args.orderId}`, "payment:failed", { transactionId: args.transactionId });
}

/** Direct Bank Transfer (NEFT / RTGS / IMPS) */
export async function recordBankTransferPayment(
  tx: Tx,
  args: {
    billId: string;
    amount: Decimal;
    userId: string;
    warehouseId: string;
    orderId: string;
    bankReference?: string;
    bankName?: string;
    notes?: string;
    clickedAt?: Date;
    clientRequestId?: string;
  }
) {
  if (args.clientRequestId) await claimIdempotencyKey(tx, args.clientRequestId);
  const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
    SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
  `;
  if (!payment) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPayments(tx, payment.id);
  const remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const applied = Decimal.min(args.amount, remainingDue);

  const transaction = await tx.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      type: "PAYMENT",
      method: "BANK_TRANSFER",
      amount: applied,
      amountReceived: args.amount,
      bankReference: args.bankReference,
      notes: args.notes,
      status: "CONFIRMED",
      recordedByUserId: args.userId,
      clickedAt: args.clickedAt,
    },
  });

  // Automatically record into BankTransaction ledger (all extra fields optional)
  await tx.bankTransaction.create({
    data: {
      warehouseId: args.warehouseId,
      businessDate: new Date(),
      type: "CUSTOMER_TRANSFER",
      amount: applied,
      isCredit: true,
      utrReference: args.bankReference || undefined,
      bankName: args.bankName || undefined,
      partyName: args.notes || undefined,
      notes: `Bill payment for Order #${args.orderId.slice(-6)}`,
      reconciled: true,
      recordedByUserId: args.userId,
    },
  });

  await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);

  await writeAudit(
    {
      userId: args.userId,
      warehouseId: args.warehouseId,
      action: "PAYMENT_RECORDED",
      entityType: "PaymentTransaction",
      entityId: transaction.id,
      newValue: { method: "BANK_TRANSFER", amount: applied.toString(), utr: args.bankReference },
    },
    tx
  );
  return { transaction, change: new Decimal(0) };
}

/** Inward Cheque Payment */
export async function recordChequePayment(
  tx: Tx,
  args: {
    billId: string;
    amount: Decimal;
    userId: string;
    warehouseId: string;
    orderId: string;
    chequeNumber?: string;
    chequeBank?: string;
    chequeDueDate?: Date;
    notes?: string;
    clickedAt?: Date;
    clientRequestId?: string;
  }
) {
  if (args.clientRequestId) await claimIdempotencyKey(tx, args.clientRequestId);
  const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
    SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
  `;
  if (!payment) throw new Error("Bill has no payment record");
  const priorPaid = await sumConfirmedPayments(tx, payment.id);
  const remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
  if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
  const applied = Decimal.min(args.amount, remainingDue);

  const transaction = await tx.paymentTransaction.create({
    data: {
      paymentId: payment.id,
      type: "PAYMENT",
      method: "CHEQUE",
      amount: applied,
      amountReceived: args.amount,
      chequeNumber: args.chequeNumber,
      chequeBank: args.chequeBank,
      chequeDueDate: args.chequeDueDate,
      chequeStatus: "CLEARED", // standard retail clearing or verified inward cheque
      notes: args.notes,
      status: "CONFIRMED",
      recordedByUserId: args.userId,
      clickedAt: args.clickedAt,
    },
  });

  // Record in Bank Statement as inward cheque
  await tx.bankTransaction.create({
    data: {
      warehouseId: args.warehouseId,
      businessDate: new Date(),
      type: "CHEQUE_CLEARANCE",
      amount: applied,
      isCredit: true,
      bankName: args.chequeBank || undefined,
      notes: `Cheque #${args.chequeNumber || "N/A"} - Bill payment for Order #${args.orderId.slice(-6)}`,
      reconciled: true,
      recordedByUserId: args.userId,
    },
  });

  await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);

  await writeAudit(
    {
      userId: args.userId,
      warehouseId: args.warehouseId,
      action: "PAYMENT_RECORDED",
      entityType: "PaymentTransaction",
      entityId: transaction.id,
      newValue: { method: "CHEQUE", amount: applied.toString(), chequeNumber: args.chequeNumber },
    },
    tx
  );
  return { transaction, change: new Decimal(0) };
}

/** Unified Multi-Tender Collector */
export async function recordMultiTenderPayment(
  tx: Tx,
  args: {
    billId: string;
    method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT" | "SPLIT";
    amountReceived: Decimal;
    userId: string;
    warehouseId: string;
    orderId: string;
    bankReference?: string;
    bankName?: string;
    chequeNumber?: string;
    chequeBank?: string;
    chequeDueDate?: Date;
    notes?: string;
    splitItems?: {
      method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
      amount: Decimal;
      reference?: string;
    }[];
    clickedAt?: Date;
    clientRequestId?: string;
  }
) {
  if (args.method === "CASH") {
    return recordCashPayment(tx, {
      billId: args.billId,
      amountReceived: args.amountReceived,
      userId: args.userId,
      warehouseId: args.warehouseId,
      orderId: args.orderId,
      clickedAt: args.clickedAt,
      clientRequestId: args.clientRequestId,
    });
  }

  if (args.method === "BANK_TRANSFER") {
    return recordBankTransferPayment(tx, {
      billId: args.billId,
      amount: args.amountReceived,
      userId: args.userId,
      warehouseId: args.warehouseId,
      orderId: args.orderId,
      bankReference: args.bankReference,
      bankName: args.bankName,
      notes: args.notes,
      clickedAt: args.clickedAt,
      clientRequestId: args.clientRequestId,
    });
  }

  if (args.method === "CHEQUE") {
    return recordChequePayment(tx, {
      billId: args.billId,
      amount: args.amountReceived,
      userId: args.userId,
      warehouseId: args.warehouseId,
      orderId: args.orderId,
      chequeNumber: args.chequeNumber,
      chequeBank: args.chequeBank,
      chequeDueDate: args.chequeDueDate,
      notes: args.notes,
      clickedAt: args.clickedAt,
      clientRequestId: args.clientRequestId,
    });
  }

  if (args.method === "UPI") {
    // Immediate direct UPI confirmation with optional reference
    if (args.clientRequestId) await claimIdempotencyKey(tx, args.clientRequestId);
    const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
      SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
    `;
    if (!payment) throw new Error("Bill has no payment record");
    const priorPaid = await sumConfirmedPayments(tx, payment.id);
    const remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
    if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");
    const applied = Decimal.min(args.amountReceived, remainingDue);

    const transaction = await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: "PAYMENT",
        method: "UPI",
        amount: applied,
        amountReceived: args.amountReceived,
        upiReference: args.bankReference,
        status: "CONFIRMED",
        recordedByUserId: args.userId,
        clickedAt: args.clickedAt,
      },
    });

    // Record into Bank Statement as UPI collection
    await tx.bankTransaction.create({
      data: {
        warehouseId: args.warehouseId,
        businessDate: new Date(),
        type: "UPI_COLLECTION",
        amount: applied,
        isCredit: true,
        utrReference: args.bankReference || undefined,
        notes: `UPI Settlement for Order #${args.orderId.slice(-6)}`,
        reconciled: true,
        recordedByUserId: args.userId,
      },
    });

    await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);
    return { transaction, change: new Decimal(0) };
  }

  if (args.method === "SPLIT" && args.splitItems && args.splitItems.length > 0) {
    if (args.clientRequestId) await claimIdempotencyKey(tx, args.clientRequestId);
    const [payment] = await tx.$queryRaw<{ id: string; amountDue: string }[]>`
      SELECT id, "amountDue" FROM "Payment" WHERE "billId" = ${args.billId} FOR UPDATE
    `;
    if (!payment) throw new Error("Bill has no payment record");
    const priorPaid = await sumConfirmedPayments(tx, payment.id);
    let remainingDue = new Decimal(payment.amountDue).sub(priorPaid);
    if (remainingDue.lte(0)) throw new PaymentError("Bill is already fully paid");

    const createdTxs = [];
    for (const item of args.splitItems) {
      if (remainingDue.lte(0)) break;
      const applied = Decimal.min(item.amount, remainingDue);
      const txRow = await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          type: "PAYMENT",
          method: item.method,
          amount: applied,
          amountReceived: item.amount,
          bankReference: item.method === "BANK_TRANSFER" || item.method === "UPI" ? item.reference : undefined,
          status: "CONFIRMED",
          recordedByUserId: args.userId,
          clickedAt: args.clickedAt,
        },
      });
      createdTxs.push(txRow);

      if (item.method === "CASH") {
        await recordCashMovement(prismaQ(tx), {
          warehouseId: args.warehouseId,
          userId: args.userId,
          type: "SALE",
          amount: applied,
          referenceId: txRow.id,
        });
      } else {
        await tx.bankTransaction.create({
          data: {
            warehouseId: args.warehouseId,
            businessDate: new Date(),
            type: item.method === "UPI" ? "UPI_COLLECTION" : "CUSTOMER_TRANSFER",
            amount: applied,
            isCredit: true,
            utrReference: item.reference || undefined,
            notes: `Split payment (${item.method}) for Order #${args.orderId.slice(-6)}`,
            reconciled: true,
            recordedByUserId: args.userId,
          },
        });
      }
      remainingDue = remainingDue.sub(applied);
    }

    await afterLedgerChange(tx, args.billId, args.warehouseId, args.orderId);
    return { transaction: createdTxs[0], change: new Decimal(0) };
  }

  throw new PaymentError(`Unsupported payment method: ${args.method}`);
}

/**
 * Applies a bill total change (from a QC revision) to the payment ledger:
 * records a PaymentAdjustment row and recomputes the derived payment status
 * (PRD §15 cases A/B/C).
 */
export async function applyBillRevisionAdjustment(
  tx: Tx,
  args: { billId: string; previousTotal: Decimal; newTotal: Decimal; warehouseId: string; orderId: string }
) {
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: args.billId }, include: { payment: true, order: true } });
  if (!bill.payment) throw new Error("Bill has no payment record");
  // The bill total moved, so what the customer owes on it moved with it —
  // including a cancellation, which revises the total to zero.
  await applyReceivableDelta(
    tx,
    bill.order.customerId,
    { due: bill.payment.amountDue, paid: bill.payment.amountPaid },
    { due: args.newTotal, paid: bill.payment.amountPaid }
  );
  await tx.payment.update({ where: { id: bill.payment.id }, data: { amountDue: args.newTotal } });

  const paid = await sumConfirmedPayments(tx, bill.payment.id);
  const outcome = evaluateBillChange(args.newTotal, paid);

  // A revision that leaves the total unchanged owes nobody anything. Writing a
  // zero-difference row would park an unresolvable "Pending" adjustment on the
  // bill forever — no resolution type is valid for a difference of zero.
  const difference = args.newTotal.sub(args.previousTotal);
  if (!difference.isZero()) {
    await tx.paymentAdjustment.create({
      data: {
        billId: args.billId,
        previousTotal: args.previousTotal,
        newTotal: args.newTotal,
        difference,
      },
    });
  }

  await tx.bill.update({ where: { id: args.billId }, data: { paymentStatus: outcome.status } });
  publish(`order:${args.orderId}`, "bill:revised", {
    billId: args.billId,
    newTotal: args.newTotal.toString(),
    status: outcome.status,
  });
  publish(`warehouse:${args.warehouseId}`, "bill:revised", { orderId: args.orderId, status: outcome.status });
  return outcome;
}

/**
 * Records how a refund/credit due was actually resolved (PRD §15 Case C).
 * ADDITIONAL_PAYMENT is just a label — the money itself was already collected
 * through the normal cash/UPI recording endpoints, so no transaction is
 * created here for that case (avoids double-counting).
 */
export async function resolvePaymentAdjustment(
  tx: Tx,
  args: {
    adjustmentId: string;
    resolutionType: "CASH_REFUND" | "UPI_REFUND" | "CUSTOMER_CREDIT" | "MANAGER_ADJUSTMENT" | "ADDITIONAL_PAYMENT";
    userId: string;
    notes?: string;
    clickedAt?: Date;
    // What actually goes back, when it isn't the whole difference — a cancelled
    // bill that was only part-paid owes back what was paid, not its total.
    amount?: Decimal;
  }
) {
  const adjustment = await tx.paymentAdjustment.findUniqueOrThrow({
    where: { id: args.adjustmentId },
    include: { bill: { include: { payment: true, order: true } } },
  });
  // Resolving twice would write a second refund for the same difference.
  if (adjustment.resolutionType) throw new PaymentError("This adjustment has already been resolved");
  assertResolutionDirection(new Decimal(adjustment.difference), args.resolutionType);

  await tx.paymentAdjustment.update({
    where: { id: args.adjustmentId },
    data: { resolutionType: args.resolutionType, resolvedByUserId: args.userId, notes: args.notes },
  });

  if (args.resolutionType === "ADDITIONAL_PAYMENT" || !adjustment.bill.payment) return;

  const amount = args.amount ?? new Decimal(adjustment.difference).abs();
  const method = args.resolutionType === "UPI_REFUND" ? "UPI" : "CASH";
  const refundTx = await tx.paymentTransaction.create({
    data: {
      paymentId: adjustment.bill.payment.id,
      type: "REFUND",
      method,
      amount,
      status: "CONFIRMED",
      recordedByUserId: args.userId,
      clickedAt: args.clickedAt,
    },
  });

  if (args.resolutionType === "CASH_REFUND") {
    await recordCashMovement(prismaQ(tx), { warehouseId: adjustment.bill.warehouseId, userId: args.userId, type: "REFUND", amount, referenceId: refundTx.id });
  }
  // CUSTOMER_CREDIT deliberately touches outstandingBalance only through the
  // REFUND row above: afterLedgerChange re-derives the customer's receivable
  // from the ledger, so a manual decrement here would count the credit twice.

  await afterLedgerChange(tx, adjustment.billId, adjustment.bill.warehouseId, adjustment.bill.orderId);
}
