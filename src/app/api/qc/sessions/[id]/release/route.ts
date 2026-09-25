import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { QC_LOCK_TIMEOUT_MS } from "@/lib/qc-lock";

const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"];
const staleTimestamp = () => new Date(Date.now() - QC_LOCK_TIMEOUT_MS - 1000).toISOString();

// Force-release someone else's active lock — MANAGER (their own warehouse
// only, via assertWarehouseAccess) or ADMIN (any warehouse), for a QC
// session stuck on a crashed/closed device before the idle timeout hits.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { qcSession, order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const [existing] = await db.select().from(qcSession).where(eq(qcSession.id, id));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [ord] = await db.select().from(order).where(eq(order.id, existing.orderId));
    const forbidden = assertWarehouseAccess(session, ord!.warehouseId);
    if (forbidden) return forbidden;

    if (ACTIVE_SESSION.includes(existing.status)) {
      await db.update(qcSession).set({ lastActiveAt: staleTimestamp() }).where(eq(qcSession.id, id));
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: ord!.warehouseId,
        action: "QC_LOCK_FORCE_RELEASED",
        entityType: "QcSession",
        entityId: id,
        oldValue: { previousHolder: existing.qcUserId },
      });
    }
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const { writeAudit } = await import("@/lib/audit");
  const existing = await db.qcSession.findUnique({ where: { id }, include: { order: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, existing.order.warehouseId);
  if (forbidden) return forbidden;

  if (ACTIVE_SESSION.includes(existing.status)) {
    await db.qcSession.update({ where: { id }, data: { lastActiveAt: new Date(staleTimestamp()) } });
    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: existing.order.warehouseId,
      action: "QC_LOCK_FORCE_RELEASED",
      entityType: "QcSession",
      entityId: id,
      oldValue: { previousHolder: existing.qcUserId },
    });
  }
  return NextResponse.json({ ok: true });
}
