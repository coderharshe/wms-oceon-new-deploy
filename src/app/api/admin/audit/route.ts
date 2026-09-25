import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const entityType = req.nextUrl.searchParams.get("entityType") ?? undefined;
  const action = req.nextUrl.searchParams.get("action") ?? undefined;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { auditLog, user } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const conditions = [];
    if (entityType) conditions.push(eq(auditLog.entityType, entityType));
    if (action) conditions.push(eq(auditLog.action, action));
    if (session.role === "MANAGER" && session.warehouseId) conditions.push(eq(auditLog.warehouseId, session.warehouseId));
    const where = conditions.length ? and(...conditions) : undefined;
    const logs = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.timestamp)).limit(200);

    const userIds = [...new Set(logs.map((l) => l.userId).filter((v): v is string => !!v))];
    const users = userIds.length ? await db.select({ id: user.id, name: user.name, staffId: user.staffId }).from(user).where(inArray(user.id, userIds)) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return NextResponse.json(logs.map((l) => ({ ...l, user: l.userId ? userMap.get(l.userId) ?? null : null })));
  }

  const db = (await import("@/lib/db")).getDb();
  const logs = await db.auditLog.findMany({
    where: {
      entityType,
      action,
      warehouseId: session.role === "MANAGER" ? session.warehouseId : undefined,
    },
    include: { user: { select: { name: true, staffId: true } } },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  return NextResponse.json(logs);
}
