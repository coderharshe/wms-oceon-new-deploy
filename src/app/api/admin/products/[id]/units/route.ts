import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

/**
 * Exactly one sale unit per product opens the billing line, so promoting one
 * demotes the rest. Done as a sweep rather than a read-modify-write because
 * two people promoting different units at once must not both end up set.
 */
async function clearOtherDefaultsDrizzle(db: any, productId: string, keepId: string) {
  const { productUnit } = await import("@/generated/drizzle/schema");
  const { eq, and, ne } = await import("drizzle-orm");
  await db.update(productUnit).set({ isDefaultSaleUnit: false })
    .where(and(eq(productUnit.productId, productId), ne(productUnit.id, keepId)));
}

const schema = z.object({
  unitId: z.string().min(1),
  factorToBase: z.number().positive(),
  // A peti/bag is normally what the customer buys, and its rate is usually
  // quoted whole rather than derived from the piece price — see
  // resolveUnitPrice. Both optional: omitted keeps the old behaviour.
  isDefaultSaleUnit: z.boolean().default(false),
  wholesalePrice: z.number().positive().nullable().default(null),
  retailPrice: z.number().positive().nullable().default(null),
});

// Attaches an existing unit to an existing product's sellable units (e.g.
// wiring a newly-added "box24" unit onto a product so it shows up in Receive
// Stock). Product creation (POST /api/admin/products) already does this at
// creation time via the same productUnit insert — this covers a product that
// already exists. @@unique([productId, unitId]) in schema.prisma is the
// dup guard, caught below rather than pre-checked.
// FINANCE included: the counter is where a missing packaging is noticed —
// a customer asks for a peti of something only stocked in pieces. Making
// them fetch a manager to add it stalls the queue.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { productUnit, unit } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const { product } = await import("@/generated/drizzle/schema");
    // Re-attaching the unit the stock is actually counted in (Product.baseUnitId,
    // which survives a detach) makes it the base row again — otherwise the flag
    // and the column would disagree about the same unit.
    const [owner] = await db.select({ baseUnitId: product.baseUnitId }).from(product).where(eq(product.id, id));
    const isBase = owner?.baseUnitId === parsed.data.unitId;
    let created;
    try {
      [created] = await db
        .insert(productUnit)
        .values({
          id: crypto.randomUUID(),
          productId: id,
          unitId: parsed.data.unitId,
          factorToBase: parsed.data.factorToBase.toString(),
          isBaseUnit: isBase,
          isDefaultSaleUnit: parsed.data.isDefaultSaleUnit,
          wholesalePrice: parsed.data.wholesalePrice?.toString() ?? null,
          retailPrice: parsed.data.retailPrice?.toString() ?? null,
        })
        .returning();
    } catch {
      return NextResponse.json({ error: "Could not attach unit — it may already be attached to this product" }, { status: 409 });
    }
    if (parsed.data.isDefaultSaleUnit) await clearOtherDefaultsDrizzle(db, id, created!.id);
    const [unitRow] = await db.select().from(unit).where(eq(unit.id, parsed.data.unitId));
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "PRODUCT_UNIT_ADDED", entityType: "Product", entityId: id, newValue: { unitId: parsed.data.unitId } });
    return NextResponse.json({ ...created, unit: unitRow ?? null }, { status: 201 });
  }

  const db = (await import("@/lib/db")).getDb();
  const owner = await db.product.findUnique({ where: { id }, select: { baseUnitId: true } });
  const isBase = owner?.baseUnitId === parsed.data.unitId;
  let created;
  try {
    created = await db.productUnit.create({
      data: {
        productId: id,
        unitId: parsed.data.unitId,
        factorToBase: parsed.data.factorToBase,
        isBaseUnit: isBase,
        isDefaultSaleUnit: parsed.data.isDefaultSaleUnit,
        wholesalePrice: parsed.data.wholesalePrice,
        retailPrice: parsed.data.retailPrice,
      },
      include: { unit: true },
    });
  } catch {
    return NextResponse.json({ error: "Could not attach unit — it may already be attached to this product" }, { status: 409 });
  }
  if (parsed.data.isDefaultSaleUnit) {
    await db.productUnit.updateMany({ where: { productId: id, id: { not: created.id } }, data: { isDefaultSaleUnit: false } });
  }
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "PRODUCT_UNIT_ADDED", entityType: "Product", entityId: id, newValue: parsed.data });
  return NextResponse.json(created, { status: 201 });
}
