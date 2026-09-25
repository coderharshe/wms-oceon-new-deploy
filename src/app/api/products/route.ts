import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { cachedJson } from "@/lib/kv-cache";
import { isWorkersRuntime } from "@/lib/cf-env";
import { matchedUnitIdFor } from "@/lib/barcode";
import { wordStartPattern } from "@/lib/word-search";

// Product search used by Finance (order building) and QC (add product) —
// the highest-QPS read in the app (hit on every keystroke). Name/price/units
// ride a 60s cache (an admin action, not per-second); `available` (per-
// warehouse on-hand minus reserved) is queried fresh on every call and never
// cached, so Finance always sees real stock before billing.
//
// Barcode matching spans BOTH levels: Product.barcode (the manufacturer's
// code for the product as a whole) and ProductUnit.barcode (per-packaging —
// a "box of 24" carries a different code than a loose piece). Scanning a
// unit-level code also returns `matchedUnitId` so the caller can pre-select
// that sale unit instead of defaulting to the base unit — scanning the box
// should bill a box, not a piece.
// One dropdown-worth of rows. 25 was too few to be honest: "%ri%" alone
// matches 64 of the 801 active products, so a cashier searching a common
// syllable saw the 25 alphabetically-first and concluded the rest weren't
// stocked. Callers show a "keep typing" hint when they get exactly this many.
const SEARCH_LIMIT = 50;

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING", "QC"]);
  if (isErrorResponse(session)) return session;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const words = wordStartPattern(q); // "c c 2" -> Coke Can 2L; null for a single word
  // Stock availability is per-warehouse and changes on every sale/receive —
  // it must NOT ride the 60s name/price cache above, or Finance would see
  // stale "in stock" numbers. ADMIN has no home warehouse, so it must pass
  // one explicitly to get stock back; everyone else's is fixed by session.
  const warehouseId = req.nextUrl.searchParams.get("warehouseId") ?? session.warehouseId ?? undefined;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit, inventory } = await import("@/generated/drizzle/schema");
    const { eq, and, or, ilike, inArray, asc, sql } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const products = await cachedJson(`products:search:${q}`, 60, async () => {
      const where = and(
        eq(product.active, true),
        q
          ? or(
              ilike(product.name, `%${q}%`),
              ilike(product.sku, `%${q}%`),
              eq(product.barcode, q),
              inArray(product.id, db.select({ id: productUnit.productId }).from(productUnit).where(eq(productUnit.barcode, q))),
              words ? sql`${product.name} ~* ${words}` : undefined
            )
          : undefined
      );
      // Same ranking as searchProducts: starts with q, then every part starts a
      // word ("c c 2"), then contains — so "c" doesn't fill all 50 slots with
      // A/B names that merely contain a c.
      const rank = words
        ? sql`case when ${product.name} ilike ${`${q}%`} then 0 when ${product.name} ~* ${words} then 1 else 2 end`
        : sql`case when ${product.name} ilike ${`${q}%`} then 0 else 2 end`;
      const rows = await db.select().from(product).where(where).orderBy(rank, asc(product.name)).limit(SEARCH_LIMIT);
      const baseUnitIds = [...new Set(rows.map((p) => p.baseUnitId))];
      const productIds = rows.map((p) => p.id);
      const [baseUnits, saleUnits] = await Promise.all([
        baseUnitIds.length ? db.select().from(unit).where(inArray(unit.id, baseUnitIds)) : Promise.resolve([]),
        productIds.length ? db.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : Promise.resolve([]),
      ]);
      const unitIds = [...new Set(saleUnits.map((su) => su.unitId))];
      const units = unitIds.length ? await db.select().from(unit).where(inArray(unit.id, unitIds)) : [];
      const unitMap = new Map(units.map((u) => [u.id, u]));
      const baseUnitMap = new Map(baseUnits.map((u) => [u.id, u]));
      const saleUnitsByProduct = new Map<string, any[]>();
      for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), { ...su, unit: unitMap.get(su.unitId) ?? null }]);
      return rows.map((p) => {
        const units = saleUnitsByProduct.get(p.id) ?? [];
        return { ...p, baseUnit: baseUnitMap.get(p.baseUnitId) ?? null, saleUnits: units, matchedUnitId: matchedUnitIdFor(units, q) };
      });
    });

    if (!warehouseId || products.length === 0) return NextResponse.json(products.map((p) => ({ ...p, available: null })));
    const stockRows = await db
      .select()
      .from(inventory)
      .where(and(eq(inventory.warehouseId, warehouseId), inArray(inventory.productId, products.map((p) => p.id))));
    const availableByProduct = new Map(stockRows.map((r) => [r.productId, Number(r.quantityOnHand) - Number(r.quantityReserved)]));
    return NextResponse.json(products.map((p) => ({ ...p, available: availableByProduct.get(p.id) ?? 0 })));
  }

  const db = (await import("@/lib/db")).getDb();
  const products = await cachedJson(`products:search:${q}`, 60, async () => {
    // Prisma can neither ORDER BY an expression nor match a regex, so the
    // ranked ids come from SQL (same rules as the Drizzle path above) and the
    // relations are loaded for exactly those ids, kept in rank order.
    const include = { saleUnits: { include: { unit: true } }, baseUnit: true };
    const ids = (
      await db.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Product" p
        WHERE p.active AND (${q} = ''
          OR p.name ILIKE ${`%${q}%`} OR p.sku ILIKE ${`%${q}%`} OR p.barcode = ${q}
          OR p.id IN (SELECT u."productId" FROM "ProductUnit" u WHERE u.barcode = ${q})
          OR (${words}::text IS NOT NULL AND p.name ~* ${words}))
        ORDER BY CASE WHEN p.name ILIKE ${`${q}%`} THEN 0 WHEN ${words}::text IS NOT NULL AND p.name ~* ${words} THEN 1 ELSE 2 END, p.name
        LIMIT ${SEARCH_LIMIT}`
    ).map((r) => r.id);
    const byId = new Map((await db.product.findMany({ where: { id: { in: ids } }, include })).map((p) => [p.id, p]));
    const rows = ids.map((id) => byId.get(id)!).filter(Boolean);
    return rows.map((p) => ({ ...p, matchedUnitId: matchedUnitIdFor(p.saleUnits, q) }));
  });

  if (!warehouseId || products.length === 0) return NextResponse.json(products.map((p) => ({ ...p, available: null })));
  const stockRows = await db.inventory.findMany({
    where: { warehouseId, productId: { in: products.map((p) => p.id) } },
  });
  const availableByProduct = new Map(stockRows.map((r) => [r.productId, Number(r.quantityOnHand) - Number(r.quantityReserved)]));
  return NextResponse.json(products.map((p) => ({ ...p, available: availableByProduct.get(p.id) ?? 0 })));
}
