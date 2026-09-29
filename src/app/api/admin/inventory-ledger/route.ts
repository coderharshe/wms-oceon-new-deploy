import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(req.url);
  const targetWarehouseId =
    session.role === "ADMIN"
      ? searchParams.get("warehouseId") || undefined
      : session.warehouseId || undefined;

  const deadStockThresholdDays = Math.max(1, parseInt(searchParams.get("deadStockDays") || "30", 10));

  const db = getDb();

  // 1. Fetch warehouses for dropdown
  const warehouses = await db.warehouse.findMany({
    where: session.role === "ADMIN" ? { active: true } : { id: session.warehouseId || undefined },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  // 2. Fetch all products with base unit, sale units, and inventory
  const products = await db.product.findMany({
    include: {
      baseUnit: true,
      saleUnits: {
        include: { unit: true },
      },
      inventory: {
        where: targetWarehouseId ? { warehouseId: targetWarehouseId } : {},
        include: {
          warehouse: {
            select: { id: true, name: true, code: true },
          },
        },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  // 3. Fetch latest inventory movement per product to detect dead stock
  const latestMovements = await db.inventoryMovement.findMany({
    where: targetWarehouseId ? { warehouseId: targetWarehouseId } : {},
    select: {
      productId: true,
      movementType: true,
      timestamp: true,
      movementQty: true,
    },
    orderBy: { timestamp: "desc" },
    distinct: ["productId"],
  });

  const movementMap = new Map<string, { timestamp: Date; movementType: string; movementQty: number }>();
  for (const m of latestMovements) {
    movementMap.set(m.productId, {
      timestamp: m.timestamp,
      movementType: m.movementType,
      movementQty: Number(m.movementQty),
    });
  }

  // Extract unique categories
  const categoriesSet = new Set<string>();

  let totalSkus = 0;
  let totalUnitsOnHand = 0;
  let totalWholesaleValuation = 0;
  let totalRetailValuation = 0;
  let totalCostValuation = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let deadStockCount = 0;
  let deadStockLockedCapital = 0;
  let expiredCount = 0;
  let expiredLockedCapital = 0;
  let nearExpiryCount = 0;
  let overstockedCount = 0;
  let healthyCount = 0;

  const now = Date.now();
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

  const items = products.map((p) => {
    totalSkus++;
    if (p.category) categoriesSet.add(p.category);

    // Sum inventory quantities across target warehouse(s)
    let onHand = 0;
    let reserved = 0;
    const warehouseBreakdown: Array<{
      warehouseId: string;
      warehouseName: string;
      warehouseCode: string;
      onHand: number;
      reserved: number;
      available: number;
    }> = [];

    for (const inv of p.inventory) {
      const oh = Number(inv.quantityOnHand);
      const res = Number(inv.quantityReserved);
      onHand += oh;
      reserved += res;
      warehouseBreakdown.push({
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouse.name,
        warehouseCode: inv.warehouse.code,
        onHand: oh,
        reserved: res,
        available: Math.max(0, oh - res),
      });
    }

    const available = Math.max(0, onHand - reserved);
    const minStock = p.minStock != null ? Number(p.minStock) : null;
    const maxStock = p.maxStock != null ? Number(p.maxStock) : null;

    const wholesalePrice = Number(p.wholesalePrice);
    const retailPrice = Number(p.retailPrice);
    const costPrice = Number(p.avgCost ?? p.wholesalePrice);
    const taxPercent = Number(p.taxPercent);

    const wholesaleValuation = onHand * wholesalePrice;
    const retailValuation = onHand * retailPrice;
    const costValuation = onHand * costPrice;

    totalUnitsOnHand += onHand;
    totalWholesaleValuation += wholesaleValuation;
    totalRetailValuation += retailValuation;
    totalCostValuation += costValuation;

    // Movement & Dead Stock calculation
    const lastMov = movementMap.get(p.id);
    const lastMovementDate = lastMov ? lastMov.timestamp : p.createdAt;
    const lastMovementType = lastMov ? lastMov.movementType : "CREATION";
    const daysSinceLastMovement = Math.max(
      0,
      Math.floor((now - new Date(lastMovementDate).getTime()) / (1000 * 60 * 60 * 24))
    );

    // Expiry check
    const expMs = p.expiryDate ? new Date(p.expiryDate).getTime() : null;
    const isExpired = expMs !== null && expMs < now;
    const isNearExpiry = expMs !== null && !isExpired && expMs <= now + sixtyDaysMs;

    // Determine stock status
    let status: "OUT_OF_STOCK" | "EXPIRED" | "NEAR_EXPIRY" | "LOW_STOCK" | "DEAD_STOCK" | "OVERSTOCKED" | "HEALTHY";

    if (onHand <= 0) {
      status = "OUT_OF_STOCK";
      outOfStockCount++;
    } else if (isExpired) {
      status = "EXPIRED";
      expiredCount++;
      expiredLockedCapital += costValuation;
    } else if (isNearExpiry) {
      status = "NEAR_EXPIRY";
      nearExpiryCount++;
    } else if (minStock != null && onHand <= minStock) {
      status = "LOW_STOCK";
      lowStockCount++;
    } else if (onHand > 0 && daysSinceLastMovement >= deadStockThresholdDays) {
      status = "DEAD_STOCK";
      deadStockCount++;
      deadStockLockedCapital += costValuation;
    } else if (maxStock != null && onHand > maxStock) {
      status = "OVERSTOCKED";
      overstockedCount++;
    } else {
      status = "HEALTHY";
      healthyCount++;
    }

    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category: p.category || "General",
      brand: p.brand || null,
      mfgDate: p.mfgDate ? p.mfgDate.toISOString().split("T")[0] : null,
      expiryDate: p.expiryDate ? p.expiryDate.toISOString().split("T")[0] : null,
      active: p.active,
      baseUnit: {
        id: p.baseUnit.id,
        name: p.baseUnit.name,
        symbol: p.baseUnit.symbol,
      },
      onHand,
      reserved,
      available,
      minStock,
      maxStock,
      wholesalePrice,
      retailPrice,
      costPrice,
      taxPercent,
      wholesaleValuation,
      retailValuation,
      costValuation,
      status,
      lastMovementDate: lastMovementDate.toISOString(),
      lastMovementType,
      daysSinceLastMovement,
      warehouseBreakdown,
      saleUnitsCount: p.saleUnits.length,
      saleUnits: p.saleUnits.map((su) => ({
        unitId: su.unitId,
        unit: {
          symbol: su.unit?.symbol || "Unit",
        },
        factorToBase: String(su.factorToBase),
        barcode: su.barcode,
        wholesalePrice: su.wholesalePrice ? String(su.wholesalePrice) : null,
        retailPrice: su.retailPrice ? String(su.retailPrice) : null,
      })),
      imageKey: p.imageKey,
    };
  });

  return NextResponse.json({
    summary: {
      totalSkus,
      totalUnitsOnHand,
      totalWholesaleValuation,
      totalRetailValuation,
      totalCostValuation,
      lowStockCount,
      outOfStockCount,
      deadStockCount,
      deadStockLockedCapital,
      expiredCount,
      expiredLockedCapital,
      nearExpiryCount,
      overstockedCount,
      healthyCount,
      deadStockThresholdDays,
    },
    items,
    warehouses,
    categories: Array.from(categoriesSet).sort(),
  });
}
