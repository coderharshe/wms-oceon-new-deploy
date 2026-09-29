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

    // 1. Fetch all active products in catalog
    const allProducts = await db.product.findMany({
      where: { active: true },
      include: {
        baseUnit: true,
      },
      orderBy: { name: "asc" },
    });

    // 2. Fetch inventory records with warehouse
    const inventoryRows = await db.inventory.findMany({
      where: whereInventory,
      include: {
        warehouse: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Map inventory by productId
    const productStockMap = new Map<string, { totalQty: number; warehouseNames: Set<string> }>();
    for (const r of inventoryRows) {
      const q = Number(r.quantityOnHand || 0);
      const entry = productStockMap.get(r.productId) || { totalQty: 0, warehouseNames: new Set<string>() };
      entry.totalQty += q;
      if (r.warehouse?.name) entry.warehouseNames.add(r.warehouse.name);
      productStockMap.set(r.productId, entry);
    }

    let defaultWhName = "All Warehouses";
    if (warehouseId) {
      const targetWh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } });
      if (targetWh) defaultWhName = targetWh.name;
    }

    const totalSkus = allProducts.length;
    let inStockSkus = 0;
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

    for (const p of allProducts) {
      const stockInfo = productStockMap.get(p.id);
      const q = stockInfo ? Math.max(0, stockInfo.totalQty) : 0;
      const price = Number(p.wholesalePrice || 0);
      const min = Number(p.minStock || 0);
      const whName =
        stockInfo && stockInfo.warehouseNames.size > 0
          ? Array.from(stockInfo.warehouseNames).join(", ")
          : defaultWhName;

      if (q > 0) {
        inStockSkus++;
        totalQuantity += q;
        totalValuation += q * price;

        if (min > 0 && q <= min) {
          lowStockCount++;
          lowStockList.push({
            id: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.baseUnit?.symbol || "units",
            quantity: q,
            minStock: min,
            shortage: Math.max(0, min - q),
            warehouseName: whName,
            wholesalePrice: price,
          });
        }
      } else {
        oosCount++;
        oosList.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.baseUnit?.symbol || "units",
          quantity: 0,
          minStock: min,
          warehouseName: whName,
          wholesalePrice: price,
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

    // 2b. Also check products with product-level expiryDate that don't have explicit batch entries
    const batchProductIds = new Set(batches.map((b) => b.productId));
    for (const p of allProducts) {
      if (!p.expiryDate || batchProductIds.has(p.id)) continue;
      const stockInfo = productStockMap.get(p.id);
      const q = stockInfo ? Math.max(0, stockInfo.totalQty) : 0;
      if (q <= 0) continue;

      const expDate = new Date(p.expiryDate);
      const expMs = expDate.getTime();
      const cost = Number(p.wholesalePrice);
      const val = q * cost;
      const whName =
        stockInfo && stockInfo.warehouseNames.size > 0
          ? Array.from(stockInfo.warehouseNames).join(", ")
          : defaultWhName;

      if (expMs < todayMs) {
        const daysOverdue = Math.max(1, Math.floor((todayMs - expMs) / (1000 * 60 * 60 * 24)));
        expiredValuation += val;
        expiredList.push({
          id: `prod-${p.id}`,
          batchNumber: "CATALOG-SKU",
          productName: p.name,
          sku: p.sku,
          unit: p.baseUnit?.symbol || "units",
          quantity: q,
          costRate: cost,
          valuation: val,
          expiryDate: expDate.toISOString(),
          mfgDate: p.mfgDate ? new Date(p.mfgDate).toISOString() : null,
          daysOverdue,
          warehouseName: whName,
          warehouseCode: "ALL",
        });
      } else if (expDate <= sixtyDaysLater) {
        const daysRemaining = Math.max(0, Math.floor((expMs - todayMs) / (1000 * 60 * 60 * 24)));
        nearExpiryValuation += val;
        nearExpiryList.push({
          id: `prod-${p.id}`,
          batchNumber: "CATALOG-SKU",
          productName: p.name,
          sku: p.sku,
          unit: p.baseUnit?.symbol || "units",
          quantity: q,
          costRate: cost,
          valuation: val,
          expiryDate: expDate.toISOString(),
          mfgDate: p.mfgDate ? new Date(p.mfgDate).toISOString() : null,
          daysRemaining,
          warehouseName: whName,
          warehouseCode: "ALL",
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
      lowStockList: lowStockList.slice(0, 200),
      oosList: oosList.slice(0, 500),
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
