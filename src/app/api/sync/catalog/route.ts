import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { cachedJson } from "@/lib/kv-cache";
import { isWorkersRuntime } from "@/lib/cf-env";

// Full product/customer/unit snapshot for the client's offline read-cache
// (src/lib/offline-catalog.ts) — deliberately excludes live stock/order/
// payment data, which must never be served stale. Pulled on login, once a
// day, and on reconnect (see ensureFreshCatalog). No live push on product
// edits — same as /api/products' own search cache, which already tolerates
// up to 60s of staleness with no invalidation; this matches that existing
// precedent rather than adding a fresher guarantee only this endpoint has.
// Same 60s KV cache as /api/products, for the same reason: a bulk read, not
// a decision, so a small staleness window is fine and saves Hyperdrive
// round trips when several devices sync close together.
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "QC"]);
  if (isErrorResponse(session)) return session;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit, customer } = await import("@/generated/drizzle/schema");
    const { eq, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const data = await cachedJson("sync:catalog", 60, async () => {
      const [products, units, customers] = await Promise.all([
        db.select().from(product).where(eq(product.active, true)).orderBy(asc(product.name)),
        db.select().from(unit).orderBy(asc(unit.symbol)),
        db.select().from(customer).orderBy(asc(customer.shopName)),
      ]);
      const productIds = products.map((p) => p.id);
      const saleUnits = productIds.length ? await db.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : [];
      const unitMap = new Map(units.map((u) => [u.id, u]));
      const saleUnitsByProduct = new Map<string, any[]>();
      for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), { ...su, unit: unitMap.get(su.unitId) ?? null }]);
      return {
        products: products.map((p) => ({ ...p, baseUnit: unitMap.get(p.baseUnitId) ?? null, saleUnits: saleUnitsByProduct.get(p.id) ?? [] })),
        units,
        customers,
      };
    });
    return NextResponse.json({ ...data, syncedAt: new Date().toISOString() });
  }

  const db = (await import("@/lib/db")).getDb();
  const data = await cachedJson("sync:catalog", 60, async () => {
    const [products, units, customers] = await Promise.all([
      db.product.findMany({ where: { active: true }, include: { saleUnits: { include: { unit: true } }, baseUnit: true }, orderBy: { name: "asc" } }),
      db.unit.findMany({ orderBy: { symbol: "asc" } }),
      db.customer.findMany({ orderBy: { shopName: "asc" } }),
    ]);
    return { products, units, customers };
  });
  return NextResponse.json({ ...data, syncedAt: new Date().toISOString() });
}
