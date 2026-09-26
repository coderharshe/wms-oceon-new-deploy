import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const { searchParams } = req.nextUrl;
  const warehouseId = session.role === "ADMIN" ? searchParams.get("warehouseId") || undefined : session.warehouseId || "none";
  const period = searchParams.get("period") || "30d";

  try {
    const db = getDb();

    // Date range filtering
    const now = new Date();
    let startDate: Date | undefined;
    if (period === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "7d") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "30d") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const where: any = {
      movementType: "DAMAGE",
    };
    if (warehouseId) where.warehouseId = warehouseId;
    if (startDate) {
      where.timestamp = { gte: startDate };
    }

    const [movements, warehouses] = await Promise.all([
      db.inventoryMovement.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              category: true,
              wholesalePrice: true,
              retailPrice: true,
              baseUnit: { select: { name: true, symbol: true } },
            },
          },
          user: {
            select: { id: true, name: true, staffId: true },
          },
          warehouse: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { timestamp: "desc" },
        take: 500,
      }),
      session.role === "ADMIN"
        ? db.warehouse.findMany({
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
          })
        : session.warehouseId
        ? db.warehouse.findMany({
            where: { id: session.warehouseId },
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
    ]);

    let totalLossValue = 0;
    let totalUnitsDamaged = 0;
    const productDamageCount: Record<string, { name: string; sku: string; qty: number; loss: number }> = {};

    const formattedMovements = movements.map((m) => {
      const qty = Math.abs(Number(m.movementQty));
      const unitCost = Number(m.product?.wholesalePrice ?? 0);
      const lossVal = qty * unitCost;

      totalUnitsDamaged += qty;
      totalLossValue += lossVal;

      if (m.product) {
        const key = m.product.id;
        if (!productDamageCount[key]) {
          productDamageCount[key] = {
            name: m.product.name,
            sku: m.product.sku,
            qty: 0,
            loss: 0,
          };
        }
        productDamageCount[key].qty += qty;
        productDamageCount[key].loss += lossVal;
      }

      return {
        id: m.id,
        timestamp: m.timestamp.toISOString(),
        product: {
          id: m.product?.id,
          name: m.product?.name ?? "Unknown",
          sku: m.product?.sku ?? "N/A",
          category: m.product?.category ?? "General",
          unit: m.product?.baseUnit?.symbol ?? "unit",
          wholesalePrice: unitCost,
        },
        warehouse: {
          id: m.warehouse?.id,
          name: m.warehouse?.name ?? "Unknown",
          code: m.warehouse?.code ?? "N/A",
        },
        reportedBy: {
          id: m.user?.id,
          name: m.user?.name ?? "Staff",
          staffId: m.user?.staffId ?? "N/A",
        },
        quantity: qty,
        lossValue: lossVal,
        beforeQty: Number(m.beforeQty),
        afterQty: Number(m.afterQty),
        reason: m.referenceId || "Damaged during handling",
      };
    });

    // Top damaged SKU
    const sortedProducts = Object.values(productDamageCount).sort((a, b) => b.qty - a.qty);
    const topDamaged = sortedProducts[0] || null;

    return NextResponse.json({
      stats: {
        totalLossValue,
        totalUnitsDamaged,
        incidentCount: movements.length,
        topDamagedProduct: topDamaged ? `${topDamaged.name} (${topDamaged.qty} units)` : "None",
      },
      warehouses,
      movements: formattedMovements,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load damaged goods" }, { status: 500 });
  }
}
