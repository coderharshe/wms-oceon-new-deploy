import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { publish } from "@/lib/realtime";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isQcEnabled } from "@/lib/settings";
import { completeWithoutQc } from "@/lib/complete-without-qc";

const SENDABLE = ["BILLED", "PAYMENT_PENDING", "PAID"];

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  // QC switched off (manager setting): Finance finalises the order itself —
  // same bill/stock/payment path QC would have run, with nothing changed.
  const qcOn = await isQcEnabled();

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const { notifyDrizzle } = await import("@/lib/drizzle-notifications");
    const db = getDrizzleDb();

    const [ord] = await db.select().from(order).where(eq(order.id, id));
    if (!ord) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord.warehouseId);
    if (forbidden) return forbidden;
    if (!SENDABLE.includes(ord.status)) {
      return NextResponse.json({ error: `Cannot send order in status ${ord.status} to QC` }, { status: 409 });
    }

    if (!qcOn) {
      const result = await completeWithoutQc(id, session.sub);
      return NextResponse.json({ ...result, qcSkipped: true });
    }

    const [updated] = await db.update(order).set({ status: "READY_FOR_QC", updatedAt: new Date().toISOString() }).where(eq(order.id, id)).returning();
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: ord.warehouseId,
      action: "ORDER_SENT_TO_QC",
      entityType: "Order",
      entityId: id,
      oldValue: { status: ord.status },
      newValue: { status: "READY_FOR_QC" },
    });
    publish(`warehouse:${ord.warehouseId}`, "order:ready_for_qc", { orderId: id });
    publish(`order:${id}`, "status:updated", { status: "READY_FOR_QC" });
    await notifyDrizzle(db, {
      role: "QC",
      warehouseId: ord.warehouseId,
      type: "ORDER_READY",
      title: "New order ready for QC",
      message: `${ord.orderNumber} is ready for quality check`,
    });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const { writeAudit } = await import("@/lib/audit");
  const { notify } = await import("@/lib/notifications");
  const order = await db.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, order.warehouseId);
  if (forbidden) return forbidden;
  if (!SENDABLE.includes(order.status)) {
    return NextResponse.json({ error: `Cannot send order in status ${order.status} to QC` }, { status: 409 });
  }

  if (!qcOn) {
    const result = await completeWithoutQc(id, session.sub);
    return NextResponse.json({ ...result, qcSkipped: true });
  }

  const updated = await db.order.update({ where: { id }, data: { status: "READY_FOR_QC" } });
  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: order.warehouseId,
    action: "ORDER_SENT_TO_QC",
    entityType: "Order",
    entityId: id,
    oldValue: { status: order.status },
    newValue: { status: "READY_FOR_QC" },
  });
  publish(`warehouse:${order.warehouseId}`, "order:ready_for_qc", { orderId: id });
  publish(`order:${id}`, "status:updated", { status: "READY_FOR_QC" });
  await notify(db, {
    role: "QC",
    warehouseId: order.warehouseId,
    type: "ORDER_READY",
    title: "New order ready for QC",
    message: `${order.orderNumber} is ready for quality check`,
  });
  return NextResponse.json(updated);
}
