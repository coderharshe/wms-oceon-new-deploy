import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { QC_LOCK_TIMEOUT_MS } from "@/lib/qc-lock";

const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"];
// Backdating past the stale-lock threshold makes the session immediately
// claimable by anyone via /api/qc/sessions, without a separate "unlocked"
// concept to keep in sync everywhere else that reads lastActiveAt.
const staleTimestamp = () => new Date(Date.now() - QC_LOCK_TIMEOUT_MS - 1000).toISOString();

// Voluntary release — the current holder is done or handing off, without
// completing the QC (see also .../complete for that). Called from a "Leave"
// button and best-effort on tab close (qc/[orderId]/page.tsx).
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
    if (existing.qcUserId !== session.sub) return NextResponse.json({ error: "You don't hold this session's lock" }, { status: 403 });
    if (ACTIVE_SESSION.includes(existing.status)) {
      await db.update(qcSession).set({ lastActiveAt: staleTimestamp() }).where(eq(qcSession.id, id));
    }
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.qcSession.findUnique({ where: { id }, include: { order: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, existing.order.warehouseId);
  if (forbidden) return forbidden;
  if (existing.qcUserId !== session.sub) return NextResponse.json({ error: "You don't hold this session's lock" }, { status: 403 });
  if (ACTIVE_SESSION.includes(existing.status)) {
    await db.qcSession.update({ where: { id }, data: { lastActiveAt: new Date(staleTimestamp()) } });
  }
  return NextResponse.json({ ok: true });
}
