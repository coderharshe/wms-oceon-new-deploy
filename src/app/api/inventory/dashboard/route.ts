import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const whereInventory: any = {};
    if (warehouseId) whereInventory.warehouseId = warehouseId;

    // 1. Fetch all inventory records with product & warehouse
    const inventoryRows = await db.inventory.findMany({
      where: whereInventory,
      include: {
        product: {
          include: {
            baseUnit: true,
          },
        },
        warehouse: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    const totalSkus = inventoryRows.length;
    let totalQuantity = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let oosCount = 0;

    const lowStockList: Array<{
      id: string;
      name: string;
      sku: string;
      unit: string;
      quantity: number;
      minStock: number;
      shortage: number;
      warehouseName: string;
      wholesalePrice: number;
    }> = [];

    const oosList: Array<{
      id: string;
      name: string;
      sku: string;
      unit: string;
      quantity: number;
      minStock: number;
      warehouseName: string;
      wholesalePrice: number;
    }> = [];

    for (const r of inventoryRows) {
      const q = Number(r.quantityOnHand || 0);
      const p = Number(r.product?.wholesalePrice || 0);
      const min = Number(r.product?.minStock || 0);
      totalQuantity += q;
      totalValuation += q * p;

      if (q <= 0) {
        oosCount++;
        oosList.push({
          id: r.productId,
          name: r.product.name,
          sku: r.product.sku,
          unit: r.product.baseUnit.symbol,
          quantity: q,
          minStock: min,
          warehouseName: r.warehouse.name,
          wholesalePrice: p,
        });
      } else if (min > 0 && q <= min) {
        lowStockCount++;
        lowStockList.push({
          id: r.productId,
          name: r.product.name,
          sku: r.product.sku,
          unit: r.product.baseUnit.symbol,
          quantity: q,
          minStock: min,
          shortage: Math.max(0, min - q),
          warehouseName: r.warehouse.name,
          wholesalePrice: p,
        });
      }
    }

    // 2. Fetch Batches & Expiry tracking
    const whereBatch: any = { quantityOnHand: { gt: 0 } };
    if (warehouseId) whereBatch.warehouseId = warehouseId;

    const batches = await db.stockBatch.findMany({
      where: whereBatch,
      include: {
        product: {
          include: { baseUnit: true },
        },
        warehouse: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { expiryDate: "asc" },
    });

    const now = new Date();
    const todayMs = now.getTime();
    const thirtyDaysLater = new Date(todayMs + 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysLater = new Date(todayMs + 60 * 24 * 60 * 60 * 1000);

    const expiredList: Array<{
      id: string;
      batchNumber: string;
      productName: string;
      sku: string;
      unit: string;
      quantity: number;
      costRate: number;
      valuation: number;
      expiryDate: string;
      mfgDate: string | null;
      daysOverdue: number;
      warehouseName: string;
      warehouseCode: string;
    }> = [];

    const nearExpiryList: Array<{
      id: string;
      batchNumber: string;
      productName: string;
      sku: string;
      unit: string;
      quantity: number;
      costRate: number;
      valuation: number;
      expiryDate: string;
      mfgDate: string | null;
      daysRemaining: number;
      warehouseName: string;
      warehouseCode: string;
      urgency: "CRITICAL" | "HIGH" | "MEDIUM";
    }> = [];

    let expiredValuation = 0;
    let nearExpiryValuation = 0;

    for (const b of batches) {
      const expDate = new Date(b.expiryDate);
      const expMs = expDate.getTime();
      const qty = Number(b.quantityOnHand);
      const cost = Number(b.costRate ?? b.product.wholesalePrice);
      const val = qty * cost;

      if (expMs < todayMs) {
        // Expired
        const daysOverdue = Math.max(1, Math.floor((todayMs - expMs) / (1000 * 60 * 60 * 24)));
        expiredValuation += val;
        expiredList.push({
          id: b.id,
          batchNumber: b.batchNumber,
          productName: b.product.name,
          sku: b.product.sku,
          unit: b.product.baseUnit.symbol,
          quantity: qty,
          costRate: cost,
          valuation: val,
          expiryDate: expDate.toISOString(),
          mfgDate: b.mfgDate ? new Date(b.mfgDate).toISOString() : null,
          daysOverdue,
          warehouseName: b.warehouse.name,
          warehouseCode: b.warehouse.code,
        });
      } else if (expDate <= sixtyDaysLater) {
        // Expiring within 60 days
        const daysRemaining = Math.max(0, Math.floor((expMs - todayMs) / (1000 * 60 * 60 * 24)));
        nearExpiryValuation += val;
        nearExpiryList.push({
          id: b.id,
          batchNumber: b.batchNumber,
          productName: b.product.name,
          sku: b.product.sku,
          unit: b.product.baseUnit.symbol,
          quantity: qty,
          costRate: cost,
          valuation: val,
          expiryDate: expDate.toISOString(),
          mfgDate: b.mfgDate ? new Date(b.mfgDate).toISOString() : null,
          daysRemaining,
          warehouseName: b.warehouse.name,
          warehouseCode: b.warehouse.code,
          urgency: daysRemaining <= 7 ? "CRITICAL" : daysRemaining <= 30 ? "HIGH" : "MEDIUM",
        });
      }
    }

    // 3. Fetch today's movements for activity metrics
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const whereMovements: any = {
      timestamp: { gte: startOfToday },
    };
    if (warehouseId) whereMovements.warehouseId = warehouseId;

    const todayMovements = await db.inventoryMovement.findMany({
      where: whereMovements,
      select: {
        movementType: true,
        movementQty: true,
      },
    });

    let todayInward = 0;
    let todayOutward = 0;

    for (const m of todayMovements) {
      const q = Math.abs(Number(m.movementQty));
      if (m.movementType === "GRN" || m.movementType === "TRANSFER_IN") {
        todayInward += q;
      } else if (
        m.movementType === "SALE" ||
        m.movementType === "DAMAGE" ||
        m.movementType === "EXPIRY" ||
        m.movementType === "TRANSFER_OUT"
      ) {
        todayOutward += q;
      }
    }

    return NextResponse.json({
      summary: {
        totalSkus,
        totalQuantity,
        totalValuation,
        lowStockCount,
        oosCount,
        expiredCount: expiredList.length,
        expiredValuation,
        nearExpiryCount: nearExpiryList.length,
        nearExpiryValuation,
        todayInward,
        todayOutward,
      },
      lowStockList: lowStockList.slice(0, 50),
      oosList: oosList.slice(0, 50),
      expiredList,
      nearExpiryList,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load inventory metrics" },
      { status: 500 }
    );
  }
}
