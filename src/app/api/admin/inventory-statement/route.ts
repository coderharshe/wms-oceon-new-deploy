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

  // Date range parsing (default: start of current month to end of today)
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const startParam = searchParams.get("startDate");
  const endParam = searchParams.get("endDate");

  const startDate = startParam ? new Date(startParam) : defaultStart;
  const endDate = endParam ? new Date(endParam) : defaultEnd;

  // Normalize hours
  if (!startParam) startDate.setHours(0, 0, 0, 0);
  if (!endParam) endDate.setHours(23, 59, 59, 999);

  const db = getDb();

  // 1. Warehouses for filter
  const warehouses = await db.warehouse.findMany({
    where: session.role === "ADMIN" ? { active: true } : { id: session.warehouseId || undefined },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  // 2. Products with inventory
  const products = await db.product.findMany({
    include: {
      baseUnit: true,
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

  // 3. Query all movements relevant to opening and closing calculations
  // We need:
  // a) Movements during the selected period [startDate, endDate]
  // b) Movements after the period (timestamp > endDate) to roll back current on-hand to closing stock
  const [periodMovements, postPeriodMovements] = await Promise.all([
    db.inventoryMovement.findMany({
      where: {
        ...(targetWarehouseId ? { warehouseId: targetWarehouseId } : {}),
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        productId: true,
        warehouseId: true,
        movementQty: true,
        movementType: true,
        timestamp: true,
      },
    }),
    db.inventoryMovement.findMany({
      where: {
        ...(targetWarehouseId ? { warehouseId: targetWarehouseId } : {}),
        timestamp: {
          gt: endDate,
        },
      },
      select: {
        productId: true,
        warehouseId: true,
        movementQty: true,
      },
    }),
  ]);

  // Map post-period net change per product
  const postPeriodDeltaMap = new Map<string, number>();
  for (const m of postPeriodMovements) {
    const prev = postPeriodDeltaMap.get(m.productId) || 0;
    postPeriodDeltaMap.set(m.productId, prev + Number(m.movementQty));
  }

  // Aggregate in-period movements per product
  type MovementAggregate = {
    inwardQty: number;
    outwardQty: number;
    damagedQty: number;
    returnQty: number;
    adjustmentQty: number;
    netPeriodDelta: number;
    breakdown: Record<string, number>;
  };

  const periodMovementMap = new Map<string, MovementAggregate>();

  for (const m of periodMovements) {
    const qty = Number(m.movementQty);
    let agg = periodMovementMap.get(m.productId);
    if (!agg) {
      agg = {
        inwardQty: 0,
        outwardQty: 0,
        damagedQty: 0,
        returnQty: 0,
        adjustmentQty: 0,
        netPeriodDelta: 0,
        breakdown: {},
      };
      periodMovementMap.set(m.productId, agg);
    }

    agg.netPeriodDelta += qty;
    agg.breakdown[m.movementType] = (agg.breakdown[m.movementType] || 0) + Math.abs(qty);

    switch (m.movementType) {
      case "GRN":
      case "PUTAWAY":
      case "TRANSFER_IN":
        if (qty > 0) agg.inwardQty += qty;
        else agg.outwardQty += Math.abs(qty);
        break;

      case "SALE":
      case "TRANSFER_OUT":
        agg.outwardQty += Math.abs(qty);
        break;

      case "DAMAGE":
      case "EXPIRY":
        agg.damagedQty += Math.abs(qty);
        break;

      case "RETURN":
        if (qty > 0) agg.returnQty += qty;
        else agg.outwardQty += Math.abs(qty);
        break;

      case "QC_ADJUSTMENT":
      case "STOCK_COUNT_ADJUSTMENT":
      case "MANUAL_ADJUSTMENT":
      default:
        if (qty > 0) agg.adjustmentQty += qty;
        else agg.adjustmentQty += qty; // signed
        break;
    }
  }

  // 4. Compute opening & closing statement per product and aggregate totals
  const categoriesSet = new Set<string>();

  let totalOpeningQty = 0;
  let totalOpeningCostValuation = 0;
  let totalOpeningWholesaleValuation = 0;

  let totalInwardQty = 0;
  let totalInwardCostValuation = 0;

  let totalOutwardQty = 0;
  let totalOutwardCostValuation = 0;
  let totalOutwardSalesValuation = 0;

  let totalDamagedQty = 0;
  let totalDamagedCostValuation = 0;

  let totalAdjustmentsQty = 0;

  let totalClosingQty = 0;
  let totalClosingCostValuation = 0;
  let totalClosingWholesaleValuation = 0;

  const items = products.map((p) => {
    if (p.category) categoriesSet.add(p.category);

    // Current stock on hand in selected scope
    let currentOnHand = 0;
    for (const inv of p.inventory) {
      currentOnHand += Number(inv.quantityOnHand);
    }

    const postDelta = postPeriodDeltaMap.get(p.id) || 0;
    const periodAgg = periodMovementMap.get(p.id) || {
      inwardQty: 0,
      outwardQty: 0,
      damagedQty: 0,
      returnQty: 0,
      adjustmentQty: 0,
      netPeriodDelta: 0,
      breakdown: {},
    };

    // Closing stock at endDate = currentOnHand - movements that occurred after endDate
    const closingQty = Math.max(0, currentOnHand - postDelta);

    // Opening stock at startDate = closingStock - net change in period
    const openingQty = Math.max(0, closingQty - periodAgg.netPeriodDelta);

    const costPrice = Number(p.avgCost ?? p.wholesalePrice);
    const wholesalePrice = Number(p.wholesalePrice);
    const retailPrice = Number(p.retailPrice);

    // Valuations
    const openingCostValuation = openingQty * costPrice;
    const openingWholesaleValuation = openingQty * wholesalePrice;

    const inwardCostValuation = periodAgg.inwardQty * costPrice;
    const outwardCostValuation = periodAgg.outwardQty * costPrice;
    const outwardSalesValuation = periodAgg.outwardQty * wholesalePrice;
    const damagedCostValuation = periodAgg.damagedQty * costPrice;

    const closingCostValuation = closingQty * costPrice;
    const closingWholesaleValuation = closingQty * wholesalePrice;

    const netChangeQty = closingQty - openingQty;
    const netChangeCostValuation = closingCostValuation - openingCostValuation;

    // Accumulate totals
    totalOpeningQty += openingQty;
    totalOpeningCostValuation += openingCostValuation;
    totalOpeningWholesaleValuation += openingWholesaleValuation;

    totalInwardQty += periodAgg.inwardQty;
    totalInwardCostValuation += inwardCostValuation;

    totalOutwardQty += periodAgg.outwardQty;
    totalOutwardCostValuation += outwardCostValuation;
    totalOutwardSalesValuation += outwardSalesValuation;

    totalDamagedQty += periodAgg.damagedQty;
    totalDamagedCostValuation += damagedCostValuation;

    totalAdjustmentsQty += periodAgg.adjustmentQty;

    totalClosingQty += closingQty;
    totalClosingCostValuation += closingCostValuation;
    totalClosingWholesaleValuation += closingWholesaleValuation;

    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category: p.category || "General",
      brand: p.brand || null,
      active: p.active,
      baseUnit: {
        id: p.baseUnit.id,
        name: p.baseUnit.name,
        symbol: p.baseUnit.symbol,
      },
      costPrice,
      wholesalePrice,
      retailPrice,
      openingQty,
      openingCostValuation,
      openingWholesaleValuation,
      inwardQty: periodAgg.inwardQty,
      inwardCostValuation,
      outwardQty: periodAgg.outwardQty,
      outwardCostValuation,
      outwardSalesValuation,
      damagedQty: periodAgg.damagedQty,
      damagedCostValuation,
      returnQty: periodAgg.returnQty,
      adjustmentQty: periodAgg.adjustmentQty,
      closingQty,
      closingCostValuation,
      closingWholesaleValuation,
      netChangeQty,
      netChangeCostValuation,
      movementBreakdown: periodAgg.breakdown,
    };
  });

  const avgHoldingCostValuation = (totalOpeningCostValuation + totalClosingCostValuation) / 2;
  const turnoverRatio = avgHoldingCostValuation > 0 ? totalOutwardCostValuation / avgHoldingCostValuation : 0;

  return NextResponse.json({
    dateRange: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    summary: {
      totalSkus: products.length,
      totalOpeningQty,
      totalOpeningCostValuation,
      totalOpeningWholesaleValuation,
      totalInwardQty,
      totalInwardCostValuation,
      totalOutwardQty,
      totalOutwardCostValuation,
      totalOutwardSalesValuation,
      totalDamagedQty,
      totalDamagedCostValuation,
      totalAdjustmentsQty,
      totalClosingQty,
      totalClosingCostValuation,
      totalClosingWholesaleValuation,
      netStockChangeQty: totalClosingQty - totalOpeningQty,
      netStockChangeValuation: totalClosingCostValuation - totalOpeningCostValuation,
      turnoverRatio: Number(turnoverRatio.toFixed(2)),
    },
    items,
    warehouses,
    categories: Array.from(categoriesSet).sort(),
  });
}
