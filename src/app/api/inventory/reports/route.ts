import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const inventoryRows = await db.inventory.findMany({
      where,
      include: {
        product: {
          include: {
            baseUnit: true,
          },
        },
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

    let totalValuation = 0;
    let totalItems = 0;
    const lowStockList = [];
    const oosList = [];

    for (const row of inventoryRows) {
      const q = Number(row.quantityOnHand);
      const price = Number(row.product.wholesalePrice);
      const min = Number(row.product.minStock || 0);

      totalValuation += q * price;
      totalItems += q;

      if (q <= 0) {
        oosList.push({
          id: row.id,
          name: row.product.name,
          sku: row.product.sku,
          unit: row.product.baseUnit.symbol,
          quantity: q,
          minStock: min,
        });
      } else if (min > 0 && q < min) {
        lowStockList.push({
          id: row.id,
          name: row.product.name,
          sku: row.product.sku,
          unit: row.product.baseUnit.symbol,
          quantity: q,
          minStock: min,
          shortage: min - q,
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalSkus: inventoryRows.length,
        totalItems,
        totalValuation,
        lowStockCount: lowStockList.length,
        oosCount: oosList.length,
      },
      lowStockList,
      oosList,
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
