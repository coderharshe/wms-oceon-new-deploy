import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// The other side of cancel: cancel undoes an order whose stock is still only
// *reserved*, this undoes one whose stock has actually left on-hand. Anything
// past the QC/handover line lands here.
const REFUNDABLE = ["READY_FOR_HANDOVER", "COMPLETED", "REFUND_REQUIRED", "ADDITIONAL_PAYMENT_REQUIRED"];

const schema = z.object({ reason: z.string().trim().min(1) });

class RefundConflictError extends Error {}

/**
 * Returns everything on the order to stock and reverses the bill to zero.
 *
 * Quantities come from the order's own InventoryMovement rows, not from the
 * bill lines: movements are already in base units, written by the same code
 * that did the deduction, so a peti/loose mix or a QC-shortened line cannot be
 * converted back wrong. EVERY movement carrying this order id counts, not just
 * the SALE — a post-deduction bill revision writes MANUAL_ADJUSTMENT rows
 * against the same order, and missing those would put back the pre-revision
 * quantity. The rows are NETTED, so a SALE of -12 already offset by a RETURN
 * of +12 nets to zero and puts nothing back, making a repeated refund a no-op
 * instead of inflating stock.
 *
 * The money reverses through the same PaymentAdjustment flow QC refunds use:
 * a revision to total 0, left for someone to settle as cash/UPI/credit on the
 * order page.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Manager's call, not Finance's — Finance collects money, reversing a
  // completed sale is a supervisor decision. (ADMIN included as elsewhere.)
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "A reason is required to refund an order" }, { status: 400 });
  const reason = parsed.data.reason;

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, bill, billVersion, inventoryMovement } = await import("@/generated/drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const { adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
      const { applyBillRevisionAdjustmentDrizzle } = await import("@/lib/drizzle-payment-service");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const { publish } = await import("@/lib/realtime");
      const db = getDrizzleDb();

      const [ord0] = await db.select().from(order).where(eq(order.id, id));
      if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
      if (forbidden) return forbidden;

      const updated = await db.transaction(async (tx) => {
        const [ord] = await tx.select().from(order).where(eq(order.id, ord0.id)).for("update");
        if (!REFUNDABLE.includes(ord!.status)) {
          throw new RefundConflictError(`Order is in status ${ord!.status}, cannot refund from here`);
        }

        const moves = await tx
          .select()
          .from(inventoryMovement)
          .where(eq(inventoryMovement.referenceId, ord!.id));
        const net = new Map<string, Decimal>();
        for (const m of moves) {
          net.set(m.productId, (net.get(m.productId) ?? new Decimal(0)).add(m.movementQty));
        }
        // Sorted so concurrent inventory writers take rows in one lock order.
        for (const productId of [...net.keys()].sort()) {
          const back = net.get(productId)!.neg();
          if (back.lte(0)) continue;
          await adjustStockDrizzle(tx, {
            productId,
            warehouseId: ord!.warehouseId,
            deltaBaseQty: back,
            movementType: "RETURN",
            referenceType: "ORDER",
            referenceId: ord!.id,
            userId: session.sub,
          });
        }

        const [b] = await tx.select().from(bill).where(eq(bill.orderId, ord!.id));
        if (b) {
          const [currentVersion] = await tx
            .select()
            .from(billVersion)
            .where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)));
          if (currentVersion && new Decimal(currentVersion.total).gt(0)) {
            await applyBillRevisionAdjustmentDrizzle(tx, {
              billId: b.id,
              previousTotal: new Decimal(currentVersion.total),
              newTotal: new Decimal(0),
              warehouseId: ord!.warehouseId,
              orderId: ord!.id,
            });
          }
        }

        const [result] = await tx
          .update(order)
          .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
          .where(eq(order.id, ord!.id))
          .returning();
        await writeAuditDrizzle(
          {
            userId: session.sub,
            role: session.role,
            warehouseId: ord!.warehouseId,
            action: "ORDER_REFUNDED",
            entityType: "Order",
            entityId: ord!.id,
            oldValue: { status: ord!.status },
            newValue: { status: "CANCELLED" },
            reason,
          },
          tx
        );
        return result;
      });

      publish(`warehouse:${ord0.warehouseId}`, "order:refunded", { orderId: ord0.id });
      publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const { adjustStock } = await import("@/lib/inventory");
    const { applyBillRevisionAdjustment } = await import("@/lib/payment-service");
    const { writeAudit } = await import("@/lib/audit");
    const { publish } = await import("@/lib/realtime");

    const ord0 = await db.order.findUnique({ where: { id } });
    if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
    if (forbidden) return forbidden;

    const updated = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${ord0.id} FOR UPDATE`;
      const ord = await tx.order.findUniqueOrThrow({ where: { id: ord0.id } });
      if (!REFUNDABLE.includes(ord.status)) {
        throw new RefundConflictError(`Order is in status ${ord.status}, cannot refund from here`);
      }

      const moves = await tx.inventoryMovement.findMany({ where: { referenceId: ord.id } });
      const net = new Map<string, Decimal>();
      for (const m of moves) {
        net.set(m.productId, (net.get(m.productId) ?? new Decimal(0)).add(m.movementQty));
      }
      // Sorted so concurrent inventory writers take rows in one lock order.
      for (const productId of [...net.keys()].sort()) {
        const back = net.get(productId)!.neg();
        if (back.lte(0)) continue;
        await adjustStock(tx, {
          productId,
          warehouseId: ord.warehouseId,
          deltaBaseQty: back,
          movementType: "RETURN",
          referenceType: "ORDER",
          referenceId: ord.id,
          userId: session.sub,
        });
      }

      const bill = await tx.bill.findUnique({ where: { orderId: ord.id }, include: { versions: true } });
      const currentVersion = bill?.versions.find((v) => v.versionNumber === bill.currentVersion);
      if (bill && currentVersion && new Decimal(currentVersion.total).gt(0)) {
        await applyBillRevisionAdjustment(tx, {
          billId: bill.id,
          previousTotal: new Decimal(currentVersion.total),
          newTotal: new Decimal(0),
          warehouseId: ord.warehouseId,
          orderId: ord.id,
        });
      }

      const result = await tx.order.update({ where: { id: ord.id }, data: { status: "CANCELLED" } });
      await writeAudit(
        {
          userId: session.sub,
          role: session.role,
          warehouseId: ord.warehouseId,
          action: "ORDER_REFUNDED",
          entityType: "Order",
          entityId: ord.id,
          oldValue: { status: ord.status },
          newValue: { status: "CANCELLED" },
          reason,
        },
        tx
      );
      return result;
    });

    publish(`warehouse:${ord0.warehouseId}`, "order:refunded", { orderId: ord0.id });
    publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof RefundConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
