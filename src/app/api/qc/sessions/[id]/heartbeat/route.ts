import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"];

// Called every QC_HEARTBEAT_INTERVAL_MS while the QC session page is open
// (see qc/[orderId]/page.tsx) — keeps lastActiveAt fresh so /api/qc/sessions
// doesn't treat this lock as abandoned. A 409 means someone else already
// took over (stale timeout passed) — the client stops and shows that.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "QC"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { qcSession, order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const [existing] = await db.select().from(qcSession).where(eq(qcSession.id, id));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [ord] = await db.select().from(order).where(eq(order.id, existing.orderId));
    const forbidden = assertWarehouseAccess(session, ord!.warehouseId);
    if (forbidden) return forbidden;
    if (existing.qcUserId !== session.sub || !ACTIVE_SESSION.includes(existing.status)) {
      return NextResponse.json({ error: "You no longer hold this session's lock" }, { status: 409 });
    }
    await db.update(qcSession).set({ lastActiveAt: new Date().toISOString() }).where(eq(qcSession.id, id));
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.qcSession.findUnique({ where: { id }, include: { order: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, existing.order.warehouseId);
  if (forbidden) return forbidden;
  if (existing.qcUserId !== session.sub || !ACTIVE_SESSION.includes(existing.status)) {
    return NextResponse.json({ error: "You no longer hold this session's lock" }, { status: 409 });
  }
  await db.qcSession.update({ where: { id }, data: { lastActiveAt: new Date() } });
  return NextResponse.json({ ok: true });
}
