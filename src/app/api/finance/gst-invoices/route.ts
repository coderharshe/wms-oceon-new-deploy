import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { buildRegister, GST_ENTITY_TYPE, GST_ISSUED, GST_DEDUCTED_LATER, type RegisterRow } from "@/lib/gst-register";

/**
 * The GST invoice register. Reads the audit log rather than an invoice table —
 * a GST tax invoice is standalone by design, so its audit row is the record.
 *
 * Warehouse-scoped like every other Finance read (PRD §6): a counter sees the
 * invoices raised at its own warehouse, ADMIN sees all. Deliberately NOT the
 * ADMIN/MANAGER-only /api/admin/audit route, which returns raw log rows for a
 * different audience.
 */

// One screen's worth. The register is browsed and filtered, not paged through
// — a month filter narrows it long before this bites.
const LIMIT = 500;

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  // ADMIN has no home warehouse and sees everything; anyone else is pinned to
  // their own, and a session without one sees nothing rather than everything.
  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? null : session.warehouseId;
  if (session.role !== "ADMIN" && !warehouseId) return NextResponse.json([]);

  const actions = [GST_ISSUED, GST_DEDUCTED_LATER];
  let rows: RegisterRow[];

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { auditLog, user } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const where = and(
      eq(auditLog.entityType, GST_ENTITY_TYPE),
      inArray(auditLog.action, actions),
      warehouseId ? eq(auditLog.warehouseId, warehouseId) : undefined
    );
    const logs = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.timestamp)).limit(LIMIT);
    const userIds = [...new Set(logs.map((l) => l.userId).filter((v): v is string => !!v))];
    const users = userIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)) : [];
    rows = buildRegister(logs, new Map(users.map((u) => [u.id, u.name])));
  } else {
    const db = (await import("@/lib/db")).getDb();
    const logs = await db.auditLog.findMany({
      where: { entityType: GST_ENTITY_TYPE, action: { in: actions }, warehouseId: warehouseId ?? undefined },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { timestamp: "desc" },
      take: LIMIT,
    });
    const names = new Map(logs.filter((l) => l.user).map((l) => [l.user!.id, l.user!.name]));
    rows = buildRegister(logs, names);
  }

  return NextResponse.json(rows);
}
