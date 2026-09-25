import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

// GET: Returns all products with their supplier comparisons
export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;

  const productId = req.nextUrl.searchParams.get("productId") ?? undefined;
  const q = req.nextUrl.searchParams.get("q")?.trim();

  try {
    const db = getDb();
    const where: any = { active: true };
    if (productId) where.id = productId;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ];
    }

    const products = await db.product.findMany({
      where,
      include: {
        baseUnit: true,
        supplierRates: {
          include: {
            supplier: {
              select: { id: true, name: true, contactPerson: true, phone: true, gstin: true },
            },
          },
          orderBy: { rate: "asc" },
        },
        purchaseItems: {
          take: 5,
          orderBy: { purchaseBill: { billDate: "desc" } },
          include: {
            purchaseBill: {
              select: { billDate: true, supplier: { select: { name: true } } },
            },
          },
        },
      },
      take: 50,
      orderBy: { name: "asc" },
    });

    const results = products.map((p) => {
      const rates = p.supplierRates.map((sr) => Number(sr.rate));
      const minRate = rates.length ? Math.min(...rates) : null;
      const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      const lastPurchase = p.purchaseItems[0]
        ? {
            rate: Number(p.purchaseItems[0].rate),
            supplier: p.purchaseItems[0].purchaseBill?.supplier?.name,
            date: p.purchaseItems[0].purchaseBill?.billDate,
          }
        : null;

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        baseUnit: p.baseUnit.symbol,
        wholesalePrice: Number(p.wholesalePrice),
        retailPrice: Number(p.retailPrice),
        minRate,
        avgRate,
        lastPurchase,
        suppliers: p.supplierRates.map((sr) => ({
          id: sr.id,
          supplierId: sr.supplier.id,
          supplierName: sr.supplier.name,
          phone: sr.supplier.phone,
          rate: Number(sr.rate),
          moq: Number(sr.moq),
          creditDays: sr.creditDays,
          schemeText: sr.schemeText,
          deliveryDays: sr.deliveryDays,
          // Landed Cost estimator formula: Rate - Scheme (if % parsed) + Freight
          estimatedLandedCost: Number(sr.rate),
        })),
      };
    });

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch supplier rates" }, { status: 500 });
  }
}

const addRateSchema = z.object({
  productId: z.string().min(1),
  supplierId: z.string().min(1),
  rate: z.number().positive(),
  moq: z.number().default(1),
  creditDays: z.number().default(0),
  schemeText: z.string().optional(),
  deliveryDays: z.number().default(1),
});

// POST: Add or update a supplier quote for a SKU
export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;

  const parsed = addRateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const db = getDb();
    const rate = await db.supplierSkuRate.upsert({
      where: {
        supplierId_productId: {
          supplierId: parsed.data.supplierId,
          productId: parsed.data.productId,
        },
      },
      update: {
        rate: parsed.data.rate,
        moq: parsed.data.moq,
        creditDays: parsed.data.creditDays,
        schemeText: parsed.data.schemeText,
        deliveryDays: parsed.data.deliveryDays,
        active: true,
      },
      create: {
        supplierId: parsed.data.supplierId,
        productId: parsed.data.productId,
        rate: parsed.data.rate,
        moq: parsed.data.moq,
        creditDays: parsed.data.creditDays,
        schemeText: parsed.data.schemeText,
        deliveryDays: parsed.data.deliveryDays,
      },
    });

    return NextResponse.json({ success: true, rate });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save supplier rate" }, { status: 500 });
  }
}
