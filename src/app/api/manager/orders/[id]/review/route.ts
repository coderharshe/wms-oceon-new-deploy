import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({ needsReview: z.boolean() });

/**
 * Clears (or re-raises) the flag on a bill that was issued with something
 * wrong with it. Billing never refuses — see POST /api/finance/orders — so
 * this is the other half of that deal: the manager says the problem has been
 * dealt with, and the note goes with it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { needsReview } = parsed.data;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [before] = await db.select().from(order).where(eq(order.id, id));
    if (!before) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const [updated] = await db
      .update(order)
      .set({ needsReview, ...(needsReview ? {} : { reviewNotes: null }), updatedAt: new Date().toISOString() })
      .where(eq(order.id, id))
      .returning();
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: before.warehouseId,
      action: "ORDER_REVIEWED",
      entityType: "Order",
      entityId: id,
      oldValue: { needsReview: before.needsReview, reviewNotes: before.reviewNotes },
      newValue: { needsReview },
    });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const before = await db.order.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const updated = await db.order.update({
    where: { id },
    data: { needsReview, ...(needsReview ? {} : { reviewNotes: null }) },
  });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: before.warehouseId,
    action: "ORDER_REVIEWED",
    entityType: "Order",
    entityId: id,
    oldValue: { needsReview: before.needsReview, reviewNotes: before.reviewNotes },
    newValue: { needsReview },
  });
  return NextResponse.json(updated);
}
