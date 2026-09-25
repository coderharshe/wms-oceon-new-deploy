import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({
  needsReview: z.boolean(),
  // Optional so the manager can correct an import-guessed price and clear the
  // flag in one action, instead of a round trip through the Products screen.
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  // The import guesses a category from the product's name, so correcting it
  // belongs on the same screen and in the same action as correcting the price.
  category: z.string().trim().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { needsReview, wholesalePrice, retailPrice, category } = parsed.data;

  // Clearing the flag is the manager saying "this row is now correct", so the
  // import's guesswork note goes with it — a stale note on a reviewed product
  // reads as an unresolved problem.
  const reviewNotes = needsReview ? undefined : null;

  // 26 products came in inactive purely because the sheet had no price for
  // them. Pricing one here is exactly the act that makes it sellable, so
  // switching it back on is the point of the screen — leaving it off would
  // let a manager "fix" a product that still cannot be billed.
  const reactivate = wholesalePrice !== undefined && wholesalePrice > 0;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [before] = await db.select().from(product).where(eq(product.id, id));
    if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const [updated] = await db
      .update(product)
      .set({
        needsReview,
        ...(reactivate ? { active: true } : {}),
        ...(reviewNotes === null ? { reviewNotes: null } : {}),
        ...(wholesalePrice !== undefined ? { wholesalePrice: wholesalePrice.toString() } : {}),
        ...(retailPrice !== undefined ? { retailPrice: retailPrice.toString() } : {}),
        ...(category !== undefined ? { category } : {}),
      })
      .where(eq(product.id, id))
      .returning();
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      action: "PRODUCT_REVIEWED",
      entityType: "Product",
      entityId: id,
      oldValue: { needsReview: before.needsReview, reviewNotes: before.reviewNotes, wholesalePrice: before.wholesalePrice.toString(), retailPrice: before.retailPrice.toString() },
      newValue: { ...parsed.data, ...(reactivate ? { active: true } : {}) },
    });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const before = await db.product.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const updated = await db.product.update({
    where: { id },
    data: {
      needsReview,
      ...(reactivate ? { active: true } : {}),
      ...(reviewNotes === null ? { reviewNotes: null } : {}),
      ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
      ...(retailPrice !== undefined ? { retailPrice } : {}),
      ...(category !== undefined ? { category } : {}),
    },
  });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    action: "PRODUCT_REVIEWED",
    entityType: "Product",
    entityId: id,
    oldValue: { needsReview: before.needsReview, reviewNotes: before.reviewNotes, wholesalePrice: before.wholesalePrice.toString(), retailPrice: before.retailPrice.toString() },
    newValue: { ...parsed.data, ...(reactivate ? { active: true } : {}) },
  });
  return NextResponse.json(updated);
}
