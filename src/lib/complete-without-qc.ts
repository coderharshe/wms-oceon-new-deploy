import { Decimal } from "@prisma/client/runtime/library";
import { isQcEnabled } from "./settings";
import { isWorkersRuntime } from "./cf-env";
import { publish } from "./realtime";

/**
 * Finishes an order with QC switched off: no QC session, no QC bill version,
 * no QC staff. The order's reserved stock is deducted for real and the order
 * lands on COMPLETED.
 *
 * Reservations are the source of truth for what the order is holding — one
 * ACTIVE row per product, in base units (see reserveStockBatch). With no QC
 * step there is nothing to short-pick, so the fulfilled quantity is exactly
 * the reserved quantity. Rows are walked in productId order to keep the same
 * inventory lock order every other batch path uses.
 *
 * Returns null when there is nothing left to deduct (already completed, or a
 * replayed request).
 */
export async function completeWithoutQc(orderId: string, userId: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { order, stockReservation } = await import("@/generated/drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const { finalizeQcDeductionDrizzle } = await import("./drizzle-inventory");
    const { writeAuditDrizzle } = await import("./drizzle-audit");
    const db = getDrizzleDb();

    const [ord] = await db.select().from(order).where(eq(order.id, orderId));
    if (!ord) return null;

    const completed = await db.transaction(async (tx) => {
      const holds = await tx
        .select()
        .from(stockReservation)
        .where(and(eq(stockReservation.orderId, orderId), eq(stockReservation.status, "ACTIVE")));
      for (const h of [...holds].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await finalizeQcDeductionDrizzle(tx, {
          productId: h.productId,
          warehouseId: h.warehouseId,
          reservedBaseQty: new Decimal(h.quantity),
          finalBaseQty: new Decimal(h.quantity),
          referenceId: orderId,
          userId,
        });
      }
      const [row] = await tx
        .update(order)
        .set({ status: "COMPLETED", updatedAt: new Date().toISOString() })
        .where(eq(order.id, orderId))
        .returning();
      return row;
    });

    await writeAuditDrizzle({
      userId,
      warehouseId: ord.warehouseId,
      action: "ORDER_COMPLETED_QC_OFF",
      entityType: "Order",
      entityId: orderId,
      oldValue: { status: ord.status },
      newValue: { status: "COMPLETED" },
    });
    publish(`order:${orderId}`, "status:updated", { status: "COMPLETED" });
    publish(`warehouse:${ord.warehouseId}`, "order:completed", { orderId });
    return completed;
  }

  const db = (await import("./db")).getDb();
  const { finalizeQcDeduction } = await import("./inventory");
  const { writeAudit } = await import("./audit");

  const ord = await db.order.findUnique({ where: { id: orderId } });
  if (!ord) return null;

  const completed = await db.$transaction(async (tx) => {
    const holds = await tx.stockReservation.findMany({
      where: { orderId, status: "ACTIVE" },
      orderBy: { productId: "asc" },
    });
    for (const h of holds) {
      await finalizeQcDeduction(tx, {
        productId: h.productId,
        warehouseId: h.warehouseId,
        reservedBaseQty: new Decimal(h.quantity),
        finalBaseQty: new Decimal(h.quantity),
        referenceId: orderId,
        userId,
      });
    }
    return tx.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
  });

  await writeAudit({
    userId,
    warehouseId: ord.warehouseId,
    action: "ORDER_COMPLETED_QC_OFF",
    entityType: "Order",
    entityId: orderId,
    oldValue: { status: ord.status },
    newValue: { status: "COMPLETED" },
  });
  publish(`order:${orderId}`, "status:updated", { status: "COMPLETED" });
  publish(`warehouse:${ord.warehouseId}`, "order:completed", { orderId });
  return completed;
}

const COMPLETED_STATUSES = new Set(["COMPLETED", "CANCELLED", "DRAFT"]);

/**
 * Called right after an order is created, finalized, or a payment transaction commits.
 * With QC on, orders wait for Finance to send them to QC. With QC off there is
 * no QC step, so the order is finished here and reserved stock is deducted.
 */
export async function completeIfQcOff(orderId: string, userId: string) {
  if (await isQcEnabled()) return;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [ord] = await getDrizzleDb().select().from(order).where(eq(order.id, orderId));
    if (!ord || COMPLETED_STATUSES.has(ord.status)) return;
  } else {
    const db = (await import("./db")).getDb();
    const ord = await db.order.findUnique({ where: { id: orderId } });
    if (!ord || COMPLETED_STATUSES.has(ord.status)) return;
  }
  return completeWithoutQc(orderId, userId);
}

/**
 * When QC is disabled by the manager, process all active stock reservations
 * and open orders that were holding reserved stock. Deducts reserved stock
 * from onHand, clears reservations (CONSUMED), and moves orders to COMPLETED.
 */
export async function processAllOrdersWhenQcDisabled(userId: string, warehouseId?: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { order, stockReservation } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const activeReservations = await db
      .select({ orderId: stockReservation.orderId })
      .from(stockReservation)
      .where(
        and(
          eq(stockReservation.status, "ACTIVE"),
          warehouseId ? eq(stockReservation.warehouseId, warehouseId) : undefined
        )
      );

    const orderIdsFromRes = activeReservations.map((r) => r.orderId);

    const openOrders = await db
      .select({ id: order.id })
      .from(order)
      .where(
        and(
          inArray(order.status, ["BILLED", "PAYMENT_PENDING", "PAID", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER"] as any),
          warehouseId ? eq(order.warehouseId, warehouseId) : undefined
        )
      );

    const allOrderIds = [...new Set([...orderIdsFromRes, ...openOrders.map((o) => o.id)])];
    for (const id of allOrderIds) {
      await completeWithoutQc(id, userId);
    }
    return allOrderIds.length;
  }

  const db = (await import("./db")).getDb();
  const activeReservations = await db.stockReservation.findMany({
    where: {
      status: "ACTIVE",
      ...(warehouseId ? { warehouseId } : {}),
    },
    select: { orderId: true },
  });
  const orderIdsFromRes = activeReservations.map((r) => r.orderId);

  const openOrders = await db.order.findMany({
    where: {
      status: { in: ["BILLED", "PAYMENT_PENDING", "PAID", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER"] },
      ...(warehouseId ? { warehouseId } : {}),
    },
    select: { id: true },
  });

  const allOrderIds = [...new Set([...orderIdsFromRes, ...openOrders.map((o) => o.id)])];
  for (const id of allOrderIds) {
    await completeWithoutQc(id, userId);
  }
  return allOrderIds.length;
}
