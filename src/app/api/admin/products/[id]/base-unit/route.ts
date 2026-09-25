import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { planBaseUnitChange } from "@/lib/base-unit";

const schema = z.object({ unitId: z.string().min(1) });

/**
 * Switches which of a product's sale units its stock is counted in.
 *
 * Not a flag flip: every quantity, level and price stored against this product
 * is denominated in the base unit, so all of them are rescaled in one
 * transaction — see planBaseUnitChange, which refuses outright rather than
 * rounding stock when the conversion isn't exact.
 *
 * This is the only way to remove a base unit: make something else the base
 * first, then detach the old one like any other unit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { unitId } = parsed.data;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit, inventory } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const [row] = await db.select().from(product).where(eq(product.id, id));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const productUnits = await db.select().from(productUnit).where(eq(productUnit.productId, id));
    const unitIds = productUnits.map((pu) => pu.unitId);
    const units = unitIds.length ? await db.select().from(unit).where(inArray(unit.id, unitIds)) : [];
    const symbols = new Map(units.map((u) => [u.id, u.symbol]));
    const stock = await db.select().from(inventory).where(eq(inventory.productId, id));

    const planned = planBaseUnitChange(
      productUnits.map((pu) => ({ unitId: pu.unitId, symbol: symbols.get(pu.unitId) ?? pu.unitId, factorToBase: pu.factorToBase, isBaseUnit: pu.isBaseUnit })),
      row,
      stock,
      unitId
    );
    if ("error" in planned) return NextResponse.json({ error: planned.error }, { status: 409 });
    const { plan } = planned;

    await db.transaction(async (tx) => {
      for (const f of plan.factors) {
        await tx
          .update(productUnit)
          .set({ factorToBase: f.factorToBase, isBaseUnit: f.isBaseUnit })
          .where(and(eq(productUnit.productId, id), eq(productUnit.unitId, f.unitId)));
      }
      await tx.update(product).set({ baseUnitId: unitId, ...plan.product }).where(eq(product.id, id));
      for (const s of plan.stock) {
        await tx
          .update(inventory)
          .set({ quantityOnHand: s.quantityOnHand, quantityReserved: s.quantityReserved })
          .where(and(eq(inventory.productId, id), eq(inventory.warehouseId, s.warehouseId)));
      }
    });

    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      action: "PRODUCT_BASE_UNIT_CHANGED",
      entityType: "Product",
      entityId: id,
      oldValue: { baseUnitId: row.baseUnitId, wholesalePrice: row.wholesalePrice, retailPrice: row.retailPrice, stock },
      newValue: { baseUnitId: unitId, ...plan.product, stock: plan.stock },
    });
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const row = await db.product.findUnique({ where: { id }, include: { saleUnits: { include: { unit: true } } } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const stock = await db.inventory.findMany({ where: { productId: id } });

  const planned = planBaseUnitChange(
    row.saleUnits.map((su) => ({ unitId: su.unitId, symbol: su.unit.symbol, factorToBase: su.factorToBase.toString(), isBaseUnit: su.isBaseUnit })),
    {
      wholesalePrice: row.wholesalePrice.toString(),
      retailPrice: row.retailPrice.toString(),
      avgCost: row.avgCost?.toString() ?? null,
      minStock: row.minStock?.toString() ?? null,
      maxStock: row.maxStock?.toString() ?? null,
    },
    stock.map((s) => ({ warehouseId: s.warehouseId, quantityOnHand: s.quantityOnHand.toString(), quantityReserved: s.quantityReserved.toString() })),
    unitId
  );
  if ("error" in planned) return NextResponse.json({ error: planned.error }, { status: 409 });
  const { plan } = planned;

  await db.$transaction([
    ...plan.factors.map((f) =>
      db.productUnit.updateMany({ where: { productId: id, unitId: f.unitId }, data: { factorToBase: f.factorToBase, isBaseUnit: f.isBaseUnit } })
    ),
    db.product.update({ where: { id }, data: { baseUnitId: unitId, ...plan.product } }),
    ...plan.stock.map((s) =>
      db.inventory.updateMany({
        where: { productId: id, warehouseId: s.warehouseId },
        data: { quantityOnHand: s.quantityOnHand, quantityReserved: s.quantityReserved },
      })
    ),
  ]);

  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    action: "PRODUCT_BASE_UNIT_CHANGED",
    entityType: "Product",
    entityId: id,
    oldValue: { baseUnitId: row.baseUnitId, wholesalePrice: row.wholesalePrice.toString(), retailPrice: row.retailPrice.toString() },
    newValue: { baseUnitId: unitId, ...plan.product },
  });
  return NextResponse.json({ ok: true });
}
