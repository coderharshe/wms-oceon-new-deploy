import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { notification } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await getDrizzleDb().update(notification).set({ read: true }).where(eq(notification.id, id));
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  await db.notification.update({ where: { id }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
