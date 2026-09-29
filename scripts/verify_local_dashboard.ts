import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();

  const allProducts = await db.product.findMany({
    where: { active: true },
    include: { baseUnit: true },
    orderBy: { name: "asc" },
  });

  const inventoryRows = await db.inventory.findMany({
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
    },
  });

  const productStockMap = new Map<string, { totalQty: number; warehouseNames: Set<string> }>();
  for (const r of inventoryRows) {
    const q = Number(r.quantityOnHand || 0);
    const entry = productStockMap.get(r.productId) || { totalQty: 0, warehouseNames: new Set<string>() };
    entry.totalQty += q;
    if (r.warehouse?.name) entry.warehouseNames.add(r.warehouse.name);
    productStockMap.set(r.productId, entry);
  }

  const totalSkus = allProducts.length;
  let inStockSkus = 0;
  let totalQuantity = 0;
  let totalValuation = 0;
  let lowStockCount = 0;
  let oosCount = 0;

  const lowStockList: any[] = [];
  const oosList: any[] = [];

  for (const p of allProducts) {
    const stockInfo = productStockMap.get(p.id);
    const q = stockInfo ? Math.max(0, stockInfo.totalQty) : 0;
    const price = Number(p.wholesalePrice || 0);
    const min = Number(p.minStock || 0);
    const whName =
      stockInfo && stockInfo.warehouseNames.size > 0
        ? Array.from(stockInfo.warehouseNames).join(", ")
        : "Main Central Hub";

    if (q > 0) {
      inStockSkus++;
      totalQuantity += q;
      totalValuation += q * price;

      if (min > 0 && q <= min) {
        lowStockCount++;
        lowStockList.push({
          name: p.name,
          sku: p.sku,
          unit: p.baseUnit?.symbol || "pc",
          quantity: q,
          minStock: min,
          shortage: Math.max(0, min - q),
        });
      }
    } else {
      oosCount++;
      oosList.push({
        name: p.name,
        sku: p.sku,
        unit: p.baseUnit?.symbol || "pc",
        quantity: 0,
        minStock: min,
      });
    }
  }

  const batches = await db.stockBatch.findMany({
    where: { quantityOnHand: { gt: 0 } },
    include: { product: true },
    orderBy: { expiryDate: "asc" },
  });

  const now = new Date();
  const todayMs = now.getTime();
  const sixtyDaysLater = new Date(todayMs + 60 * 24 * 60 * 60 * 1000);

  const expiredList: any[] = [];
  const nearExpiryList: any[] = [];
  let expiredValuation = 0;
  let nearExpiryValuation = 0;

  for (const b of batches) {
    const expDate = new Date(b.expiryDate);
    const expMs = expDate.getTime();
    const qty = Number(b.quantityOnHand);
    const cost = Number(b.costRate ?? b.product.wholesalePrice);
    const val = qty * cost;

    if (expMs < todayMs) {
      const daysOverdue = Math.max(1, Math.floor((todayMs - expMs) / (1000 * 60 * 60 * 24)));
      expiredValuation += val;
      expiredList.push({
        batchNumber: b.batchNumber,
        productName: b.product.name,
        quantity: qty,
        valuation: val,
        daysOverdue,
      });
    } else if (expDate <= sixtyDaysLater) {
      const daysRemaining = Math.max(0, Math.floor((expMs - todayMs) / (1000 * 60 * 60 * 24)));
      nearExpiryValuation += val;
      nearExpiryList.push({
        batchNumber: b.batchNumber,
        productName: b.product.name,
        quantity: qty,
        valuation: val,
        daysRemaining,
      });
    }
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const todayMovements = await db.inventoryMovement.findMany({
    where: { timestamp: { gte: startOfToday } },
  });

  let todayInward = 0;
  let todayOutward = 0;

  for (const m of todayMovements) {
    const q = Math.abs(Number(m.movementQty));
    if (m.movementType === "GRN" || m.movementType === "TRANSFER_IN") todayInward += q;
    else if (["SALE", "DAMAGE", "EXPIRY", "TRANSFER_OUT"].includes(m.movementType)) todayOutward += q;
  }

  console.log("=== LOCAL DOCKER INVENTORY DASHBOARD VERIFICATION ===");
  console.log({
    totalSkus,
    inStockSkus,
    oosCount,
    totalQuantity,
    totalValuation: Math.round(totalValuation),
    lowStockCount,
    expiredCount: expiredList.length,
    expiredValuation: Math.round(expiredValuation),
    nearExpiryCount: nearExpiryList.length,
    nearExpiryValuation: Math.round(nearExpiryValuation),
    todayInward,
    todayOutward,
  });

  console.log("\n--- Near Expiry Batches in Local DB ---");
  console.log(nearExpiryList);

  console.log("\n--- Expired Batches in Local DB ---");
  console.log(expiredList);

  console.log("\n--- Low Stock Products in Local DB ---");
  console.log(lowStockList);

  console.log("\n--- Out of Stock Products in Local DB ---");
  console.log(oosList);
}

main().catch(console.error);
