import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

type SaleUnitRow = {
  symbol: string;
  factorToBase: string;
  isDefaultSaleUnit: boolean;
  wholesalePrice: string | null;
  retailPrice: string | null;
};

export type ReviewRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  active: boolean;
  wholesalePrice: string;
  retailPrice: string;
  reviewNotes: string | null;
  baseUnit: string;
  onHand: string;
  saleUnits: SaleUnitRow[];
};

// Prisma hands back Decimal objects and Drizzle hands back strings for the
// same columns; both branches funnel through here so the JSON shape can't
// drift between Node and Workers.
const dec = (v: unknown) => String(v ?? "0");
const decOrNull = (v: unknown) => (v == null ? null : String(v));

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const category = req.nextUrl.searchParams.get("category")?.trim();

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit, inventory } = await import("@/generated/drizzle/schema");
    const { and, or, eq, ilike, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const where = and(
      eq(product.needsReview, true),
      category ? eq(product.category, category) : undefined,
      q ? or(ilike(product.name, `%${q}%`), ilike(product.sku, `%${q}%`)) : undefined
    );
    const products = await db.select().from(product).where(where).orderBy(asc(product.category), asc(product.name));
    const productIds = products.map((p) => p.id);
    const baseUnitIds = [...new Set(products.map((p) => p.baseUnitId))];
    const [saleUnits, stock] = await Promise.all([
      productIds.length ? db.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : Promise.resolve([]),
      productIds.length ? db.select().from(inventory).where(inArray(inventory.productId, productIds)) : Promise.resolve([]),
    ]);
    const unitIds = [...new Set([...baseUnitIds, ...saleUnits.map((su) => su.unitId)])];
    const units = unitIds.length ? await db.select().from(unit).where(inArray(unit.id, unitIds)) : [];
    const unitMap = new Map(units.map((u) => [u.id, u.symbol]));

    const saleUnitsByProduct = new Map<string, SaleUnitRow[]>();
    for (const su of saleUnits) {
      saleUnitsByProduct.set(su.productId, [
        ...(saleUnitsByProduct.get(su.productId) ?? []),
        {
          symbol: unitMap.get(su.unitId) ?? "",
          factorToBase: dec(su.factorToBase),
          isDefaultSaleUnit: su.isDefaultSaleUnit,
          wholesalePrice: decOrNull(su.wholesalePrice),
          retailPrice: decOrNull(su.retailPrice),
        },
      ]);
    }
    const onHandByProduct = new Map<string, number>();
    for (const i of stock) onHandByProduct.set(i.productId, (onHandByProduct.get(i.productId) ?? 0) + Number(i.quantityOnHand));

    const rows: ReviewRow[] = products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      active: p.active,
      wholesalePrice: dec(p.wholesalePrice),
      retailPrice: dec(p.retailPrice),
      reviewNotes: p.reviewNotes,
      baseUnit: unitMap.get(p.baseUnitId) ?? "",
      onHand: String(onHandByProduct.get(p.id) ?? 0),
      saleUnits: saleUnitsByProduct.get(p.id) ?? [],
    }));
    return NextResponse.json(rows);
  }

  const db = (await import("@/lib/db")).getDb();
  const products = await db.product.findMany({
    where: {
      needsReview: true,
      ...(category ? { category } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { sku: { contains: q, mode: "insensitive" as const } }] } : {}),
    },
    include: { baseUnit: true, saleUnits: { include: { unit: true } }, inventory: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const rows: ReviewRow[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    active: p.active,
    wholesalePrice: dec(p.wholesalePrice),
    retailPrice: dec(p.retailPrice),
    reviewNotes: p.reviewNotes,
    baseUnit: p.baseUnit.symbol,
    onHand: String(p.inventory.reduce((sum, i) => sum + Number(i.quantityOnHand), 0)),
    saleUnits: p.saleUnits.map((su) => ({
      symbol: su.unit.symbol,
      factorToBase: dec(su.factorToBase),
      isDefaultSaleUnit: su.isDefaultSaleUnit,
      wholesalePrice: decOrNull(su.wholesalePrice),
      retailPrice: decOrNull(su.retailPrice),
    })),
  }));
  return NextResponse.json(rows);
}
