import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { publish } from "@/lib/realtime";

const schema = z.object({ event: z.enum(["joined", "left"]) });

// "Someone else is here too" awareness for the finance order page — advisory
// only (the row locks in payment-service.ts are what actually keep
// concurrent actions safe). Published to warehouse:<id>:FINANCE, not
// order:<id> — that scope is shared with the unauthenticated payment
// display screen (see events/route.ts), so staff names must never land
// there.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  // navigator.sendBeacon (used on tab close) can't reliably set a
  // Content-Type header cross-browser, so accept the body as text.
  const raw = await req.text();
  const parsed = schema.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let warehouseId: string | null | undefined;
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [ord] = await getDrizzleDb().select({ warehouseId: order.warehouseId }).from(order).where(eq(order.id, id));
    warehouseId = ord?.warehouseId;
  } else {
    const db = (await import("@/lib/db")).getDb();
    const ord = await db.order.findUnique({ where: { id }, select: { warehouseId: true } });
    warehouseId = ord?.warehouseId;
  }

  if (!warehouseId) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  publish(`warehouse:${warehouseId}:FINANCE`, `presence:${parsed.data.event}`, { orderId: id, userId: session.sub, name: session.name });
  return NextResponse.json({ userId: session.sub, name: session.name });
}
