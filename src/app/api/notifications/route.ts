import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { notification } = await import("@/generated/drizzle/schema");
    const { or, and, eq, isNull, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const notifications = await db
      .select()
      .from(notification)
      .where(
        or(
          eq(notification.userId, session.sub),
          and(eq(notification.role, session.role), session.warehouseId ? eq(notification.warehouseId, session.warehouseId) : isNull(notification.warehouseId)),
          and(eq(notification.role, session.role), isNull(notification.warehouseId))
        )
      )
      .orderBy(desc(notification.createdAt))
      .limit(30);
    return NextResponse.json(notifications);
  }

  const db = (await import("@/lib/db")).getDb();
  const notifications = await db.notification.findMany({
    where: {
      OR: [
        { userId: session.sub },
        { role: session.role, warehouseId: session.warehouseId },
        { role: session.role, warehouseId: null },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json(notifications);
}
