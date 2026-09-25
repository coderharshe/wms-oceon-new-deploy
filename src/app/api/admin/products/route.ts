import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";
import { fail } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit } = await import("@/generated/drizzle/schema");
    const { or, ilike, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const where = q ? or(ilike(product.name, `%${q}%`), ilike(product.sku, `%${q}%`)) : undefined;
    const products = await db.select().from(product).where(where).orderBy(asc(product.name)).limit(200);
    const productIds = products.map((p) => p.id);
    const baseUnitIds = [...new Set(products.map((p) => p.baseUnitId))];
    const [saleUnits, baseUnits] = await Promise.all([
      productIds.length ? db.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : Promise.resolve([]),
      baseUnitIds.length ? db.select().from(unit).where(inArray(unit.id, baseUnitIds)) : Promise.resolve([]),
    ]);
    const unitIds = [...new Set(saleUnits.map((su) => su.unitId))];
    const units = unitIds.length ? await db.select().from(unit).where(inArray(unit.id, unitIds)) : [];
    const unitMap = new Map(units.map((u) => [u.id, u]));
    const baseUnitMap = new Map(baseUnits.map((u) => [u.id, u]));
    const saleUnitsByProduct = new Map<string, any[]>();
    for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), { ...su, unit: unitMap.get(su.unitId) ?? null }]);
    return NextResponse.json(products.map((p) => ({ ...p, baseUnit: baseUnitMap.get(p.baseUnitId) ?? null, saleUnits: saleUnitsByProduct.get(p.id) ?? [] })));
  }

  const db = (await import("@/lib/db")).getDb();
  const products = await db.product.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {},
    include: { baseUnit: true, saleUnits: { include: { unit: true } } },
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json(products);
}

const schema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(1),
  category: z.string().optional(),
  brand: z.string().optional(),
  baseUnitId: z.string(),
  wholesalePrice: z.number().nonnegative(),
  retailPrice: z.number().nonnegative(),
  taxPercent: z.number().min(0).max(100).default(0),
  minStock: z.number().optional(),
  maxStock: z.number().optional(),
  saleUnits: z
    .array(
      z.object({
        unitId: z.string(),
        factorToBase: z.number().positive(),
        isBaseUnit: z.boolean(),
        // Per-packaging barcode — scanned off the carton, or software-
        // generated (POST /api/admin/products/barcode) for unbranded goods.
        barcode: z.string().min(1).optional(),
        barcodeGenerated: z.boolean().default(false),
      })
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  // Finance creating a product mid-bill is a manager-controlled privilege, and
  // the check lives here rather than only in the UI — hiding a button is not a
  // permission. Admin and Manager are unaffected by the switch.
  if (session.role === "FINANCE" && !(await (await import("@/lib/settings")).financeCanAddProducts())) {
    return fail(403, "Adding new products from the billing screen is switched off.", { label: "Turn it on", href: "/manager/settings" });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { saleUnits, ...data } = parsed.data;

  // Two barcodes on the same product's units would each be unique in the DB
  // but are always a data-entry slip (the same code scanned into two rows),
  // and Postgres wouldn't catch it — the rows differ. Cheap pre-check.
  const enteredBarcodes = saleUnits.map((su) => su.barcode).filter(Boolean);
  if (new Set(enteredBarcodes).size !== enteredBarcodes.length) {
    return NextResponse.json({ error: "The same barcode is used on more than one unit of this product" }, { status: 400 });
  }

  try {
    return await createProduct(session, data, saleUnits);
  } catch (err) {
    if (isUniqueViolation(err, "barcode")) {
      return fail(409, "That barcode is already assigned to another product or unit.", { label: "Find it", href: `/manager/products?q=${encodeURIComponent(parsed.data.barcode ?? "")}` });
    }
    if (isUniqueViolation(err, "sku")) {
      return fail(409, "That SKU is already in use.", { label: "Open that product", href: `/manager/products?q=${encodeURIComponent(parsed.data.sku)}` });
    }
    throw err;
  }
}

type ParsedSchema = z.infer<typeof schema>;

async function createProduct(
  session: Exclude<Awaited<ReturnType<typeof requireRole>>, NextResponse>,
  data: Omit<ParsedSchema, "saleUnits">,
  saleUnits: ParsedSchema["saleUnits"]
) {
  // A product invented at the counter carries a price nobody has checked, so
  // it goes onto the manager's review list the moment it is created. Admin and
  // Manager add products deliberately from the catalogue screens, so theirs do
  // not need a second pair of eyes.
  const fromBillingScreen = session.role === "FINANCE";
  const review = fromBillingScreen
    ? {
      needsReview: true,
      reviewNotes:
        `Added at the billing counter by ${session.role.toLowerCase()} while making a bill, so the price was typed in from memory.` +
        `||Check the wholesale and retail prices against the supplier bill, set the category, then mark it reviewed.`,
    }
    : null;
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, productUnit, unit } = await import("@/generated/drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const result = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(product)
        .values({
          id: crypto.randomUUID(),
          sku: data.sku,
          barcode: data.barcode,
          name: data.name,
          category: data.category,
          brand: data.brand,
          baseUnitId: data.baseUnitId,
          wholesalePrice: data.wholesalePrice.toString(),
          retailPrice: data.retailPrice.toString(),
          taxPercent: data.taxPercent.toString(),
          minStock: data.minStock?.toString(),
          maxStock: data.maxStock?.toString(),
          ...(review ?? {}),
        })
        .returning();
      const insertedUnits = await tx
        .insert(productUnit)
        .values(saleUnits.map((su) => ({ id: crypto.randomUUID(), productId: created!.id, unitId: su.unitId, factorToBase: su.factorToBase.toString(), isBaseUnit: su.isBaseUnit, barcode: su.barcode, barcodeGenerated: su.barcodeGenerated })))
        .returning();
      // baseUnit belongs in the response for the same reason saleUnits does:
      // the billing screen bills this product the instant it comes back, and
      // it reads `baseUnit.symbol` on every line row. Returning the bare
      // Product row here crashed the whole till mid-sale — every other
      // product endpoint (/api/products, /api/sync/catalog, the GET above)
      // already includes it, so this was the odd one out.
      const unitIds = [...new Set([...insertedUnits.map((u) => u.unitId), created!.baseUnitId])];
      const units = unitIds.length ? await tx.select().from(unit).where(inArray(unit.id, unitIds)) : [];
      const unitMap = new Map(units.map((u) => [u.id, u]));
      return {
        ...created,
        baseUnit: unitMap.get(created!.baseUnitId) ?? null,
        saleUnits: insertedUnits.map((su) => ({ ...su, unit: unitMap.get(su.unitId) ?? null })),
      };
    });

    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "PRODUCT_CREATED", entityType: "Product", entityId: result.id!, newValue: { sku: result.sku, name: result.name } });
    return NextResponse.json(result, { status: 201 });
  }

  const db = (await import("@/lib/db")).getDb();
  const product = await db.product.create({
    data: { ...data, ...(review ?? {}), saleUnits: { create: saleUnits } },
    include: { baseUnit: true, saleUnits: { include: { unit: true } } },
  });
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "PRODUCT_CREATED", entityType: "Product", entityId: product.id, newValue: { sku: product.sku, name: product.name } });
  return NextResponse.json(product, { status: 201 });
}
