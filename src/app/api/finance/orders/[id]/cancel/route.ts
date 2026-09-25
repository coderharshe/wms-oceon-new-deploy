import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// Cancellable up to the point Finance hands the order to QC — once QC has
// it, the goods are being physically checked and this isn't the right undo
// path anymore.
const CANCELLABLE = ["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID"];
const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"];

// `refund` says what happened to money already collected, asked in the
// cancel dialog: given back in cash (out of the canceller's drawer), by UPI,
// kept as credit on the customer's account, or not yet (left on Finance's
// "Needs Refund" list, the old behaviour and still the default).
const REFUND = { CASH: "CASH_REFUND", UPI: "UPI_REFUND", CREDIT: "CUSTOMER_CREDIT" } as const;
const schema = z.object({
  reason: z.string().trim().min(1).optional(),
  refund: z.enum(["CASH", "UPI", "CREDIT", "LATER"]).default("LATER"),
});

/** Status/QC state changed between the pre-check and the row lock, or QC holds the order. */
class CancelConflictError extends Error {}
/** Money was already collected and no reason was given for reversing it. */
class ReasonRequiredError extends Error {}

// Reverses whatever was committed: releases any reserved stock, and if money
// was already collected, routes it through the same refund-resolve flow
// Finance already uses for QC-driven refunds (a PaymentAdjustment record with
// newTotal 0 — Finance settles it from the order page like any other refund).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  // Body is optional — an unpaid DRAFT/BILLED cancel needs no explanation.
  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const reason = parsed.data.reason ?? null;
  const resolution = parsed.data.refund === "LATER" ? null : REFUND[parsed.data.refund];

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, bill, billVersion, payment, paymentAdjustment, qcSession } = await import("@/generated/drizzle/schema");
      const { eq, and, inArray, isNull, desc } = await import("drizzle-orm");
      const { releaseOrderReservationsDrizzle } = await import("@/lib/drizzle-inventory");
      const { applyBillRevisionAdjustmentDrizzle, resolvePaymentAdjustmentDrizzle } = await import("@/lib/drizzle-payment-service");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const { publish } = await import("@/lib/realtime");
      const db = getDrizzleDb();

      const [ord0] = await db.select().from(order).where(eq(order.id, id));
      if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
      if (forbidden) return forbidden;

      const updated = await db.transaction(async (tx) => {
        // Lock and re-read the order INSIDE the transaction: the QC-start route
        // locks the same row, so without this a cancel can land while QC is
        // starting and leave a CANCELLED order with a live session that later
        // deducts stock.
        const [ord] = await tx.select().from(order).where(eq(order.id, ord0.id)).for("update");
        if (!CANCELLABLE.includes(ord!.status)) {
          throw new CancelConflictError(`Order is in status ${ord!.status}, cannot cancel from here`);
        }
        const [activeQc] = await tx
          .select({ id: qcSession.id })
          .from(qcSession)
          .where(and(eq(qcSession.orderId, ord!.id), inArray(qcSession.status, ACTIVE_SESSION as any)));
        if (activeQc) throw new CancelConflictError("QC is working on this order — release the QC session before cancelling");

        await releaseOrderReservationsDrizzle(tx, ord!.id);

        const [b] = await tx.select().from(bill).where(eq(bill.orderId, ord!.id));
        if (b) {
          const [pay] = await tx.select().from(payment).where(eq(payment.billId, b.id));
          if (pay && new Decimal(pay.amountPaid).gt(0)) {
            // Money already collected must never be reversed unexplained.
            if (!reason) throw new ReasonRequiredError("A reason is required to cancel an order that has been paid");
            const [currentVersion] = await tx.select().from(billVersion).where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)));
            await applyBillRevisionAdjustmentDrizzle(tx, { billId: b.id, previousTotal: new Decimal(currentVersion!.total), newTotal: new Decimal(0), warehouseId: ord!.warehouseId, orderId: ord!.id });
            if (resolution) {
              const [adj] = await tx.select({ id: paymentAdjustment.id }).from(paymentAdjustment)
                .where(and(eq(paymentAdjustment.billId, b.id), isNull(paymentAdjustment.resolutionType)))
                .orderBy(desc(paymentAdjustment.createdAt)).limit(1);
              // amountPaid, not the bill total: a part-paid bill gives back what was paid.
              if (adj) await resolvePaymentAdjustmentDrizzle(tx, { adjustmentId: adj.id, resolutionType: resolution, userId: session.sub, notes: reason ?? undefined, amount: new Decimal(pay.amountPaid) });
            }
          }
        }

        const [result] = await tx.update(order).set({ status: "CANCELLED", updatedAt: new Date().toISOString() }).where(eq(order.id, ord!.id)).returning();
        await writeAuditDrizzle({ userId: session.sub, role: session.role, warehouseId: ord!.warehouseId, action: "ORDER_CANCELLED", entityType: "Order", entityId: ord!.id, newValue: { refund: parsed.data.refund }, reason }, tx);
        return result;
      });

      publish(`warehouse:${ord0.warehouseId}`, "order:cancelled", { orderId: ord0.id });
      publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const { releaseOrderReservations } = await import("@/lib/inventory");
    const { applyBillRevisionAdjustment, resolvePaymentAdjustment } = await import("@/lib/payment-service");
    const { writeAudit } = await import("@/lib/audit");
    const { publish } = await import("@/lib/realtime");

    const ord0 = await db.order.findUnique({ where: { id } });
    if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
    if (forbidden) return forbidden;

    const updated = await db.$transaction(async (tx) => {
      // Row lock — same reasoning as the Drizzle branch above.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${ord0.id} FOR UPDATE`;
      const ord = await tx.order.findUniqueOrThrow({ where: { id: ord0.id } });
      if (!CANCELLABLE.includes(ord.status)) {
        throw new CancelConflictError(`Order is in status ${ord.status}, cannot cancel from here`);
      }
      const activeQc = await tx.qcSession.findFirst({ where: { orderId: ord.id, status: { in: ACTIVE_SESSION as any } } });
      if (activeQc) throw new CancelConflictError("QC is working on this order — release the QC session before cancelling");

      await releaseOrderReservations(tx, ord.id);

      const bill = await tx.bill.findUnique({ where: { orderId: ord.id }, include: { payment: true, versions: true } });
      if (bill?.payment && new Decimal(bill.payment.amountPaid).gt(0)) {
        // Money already collected must never be reversed unexplained.
        if (!reason) throw new ReasonRequiredError("A reason is required to cancel an order that has been paid");
        const currentVersion = bill.versions.find((v) => v.versionNumber === bill.currentVersion)!;
        await applyBillRevisionAdjustment(tx, { billId: bill.id, previousTotal: new Decimal(currentVersion.total), newTotal: new Decimal(0), warehouseId: ord.warehouseId, orderId: ord.id });
        if (resolution) {
          const adj = await tx.paymentAdjustment.findFirst({ where: { billId: bill.id, resolutionType: null }, orderBy: { createdAt: "desc" } });
          if (adj) await resolvePaymentAdjustment(tx, { adjustmentId: adj.id, resolutionType: resolution, userId: session.sub, notes: reason ?? undefined, amount: new Decimal(bill.payment.amountPaid) });
        }
      }

      const result = await tx.order.update({ where: { id: ord.id }, data: { status: "CANCELLED" } });
      await writeAudit({ userId: session.sub, role: session.role, warehouseId: ord.warehouseId, action: "ORDER_CANCELLED", entityType: "Order", entityId: ord.id, newValue: { refund: parsed.data.refund }, reason }, tx);
      return result;
    });

    publish(`warehouse:${ord0.warehouseId}`, "order:cancelled", { orderId: ord0.id });
    publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ReasonRequiredError) return NextResponse.json({ error: err.message, reasonRequired: true }, { status: 400 });
    if (err instanceof CancelConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
