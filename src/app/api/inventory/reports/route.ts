import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    // 1. Fetch all active products
    const allProducts = await db.product.findMany({
      where: { active: true },
      include: {
        baseUnit: true,
      },
      orderBy: { name: "asc" },
    });

    // 2. Fetch inventory records
    const inventoryRows = await db.inventory.findMany({
      where,
      include: {
        warehouse: true,
      },
    });

    const movements = await db.inventoryMovement.findMany({
      where,
      take: 100,
      orderBy: { timestamp: "desc" },
      include: {
        product: { select: { name: true, sku: true } },
        user: { select: { name: true, staffId: true } },
      },
    });

    // Map inventory quantity by productId
    const productStockMap = new Map<string, number>();
    for (const row of inventoryRows) {
      const q = Number(row.quantityOnHand || 0);
      productStockMap.set(row.productId, (productStockMap.get(row.productId) || 0) + q);
    }

    let totalValuation = 0;
    let totalItems = 0;
    const lowStockList = [];
    const oosList = [];

    for (const p of allProducts) {
      const q = productStockMap.get(p.id) || 0;
      const price = Number(p.wholesalePrice || 0);
      const min = Number(p.minStock || 0);

      if (q > 0) {
        totalValuation += q * price;
        totalItems += q;

        if (min > 0 && q <= min) {
          lowStockList.push({
            id: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.baseUnit?.symbol || "units",
            quantity: q,
            minStock: min,
            shortage: Math.max(0, min - q),
          });
        }
      } else {
        oosList.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.baseUnit?.symbol || "units",
          quantity: 0,
          minStock: min,
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalSkus: allProducts.length,
        totalItems,
        totalValuation,
        lowStockCount: lowStockList.length,
        oosCount: oosList.length,
      },
      lowStockList: lowStockList.slice(0, 100),
      oosList: oosList.slice(0, 100),
      recentMovements: movements.map((m) => ({
        id: m.id,
        productName: m.product.name,
        sku: m.product.sku,
        movementType: m.movementType,
        movementQty: Number(m.movementQty),
        beforeQty: Number(m.beforeQty),
        afterQty: Number(m.afterQty),
        reference: m.referenceId || m.referenceType,
        staff: m.user.name,
        timestamp: m.timestamp,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate inventory reports" }, { status: 500 });
  }
}
