import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { stockLevel, type StockLevel } from "@/lib/stock";

function toLowStockItems(rows: { product: string; sku: string; onHand: number; minStock: number; level: StockLevel }[]) {
  return rows
    .sort((a, b) => a.onHand / a.minStock - b.onHand / b.minStock)
    .slice(0, 20)
    .map((r) => ({ product: r.product, sku: r.sku, onHand: r.onHand.toString(), minStock: r.minStock.toString(), level: r.level }));
}

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  let warehouseId = session.warehouseId;
  if (!warehouseId && session.role === "ADMIN") {
    const firstWh = await db.warehouse.findFirst({ where: { active: true } });
    warehouseId = firstWh?.id ?? null;
  }
  if (!warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const endOfYesterday = new Date(startOfToday.getTime() - 1);

  const [
    todaysOrders,
    yesterdaysOrders,
    pendingQc,
    completedToday,
    allProducts,
    inventory,
    staffCount,
    lockedOrders,
    todaysBills,
    yesterdaysBills,
    pendingTasksCount,
    pendingPOsCount,
    pendingDiscountsCount,
  ] = await Promise.all([
    db.order.count({ where: { warehouseId, createdAt: { gte: startOfToday } } }),
    db.order.count({ where: { warehouseId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } } }),
    db.order.count({ where: { warehouseId, status: { in: ["READY_FOR_QC", "QC_IN_PROGRESS"] } } }),
    db.order.count({ where: { warehouseId, status: "COMPLETED", updatedAt: { gte: startOfToday } } }),
    db.product.findMany({
      where: { active: true },
      select: { id: true, name: true, sku: true, minStock: true, wholesalePrice: true },
    }),
    db.inventory.findMany({
      where: { warehouseId },
      select: { productId: true, quantityOnHand: true },
    }),
    db.user.count({ where: { warehouseId, active: true } }),
    db.order.findMany({
      where: { warehouseId, status: "QC_IN_PROGRESS" },
      select: {
        id: true,
        orderNumber: true,
        qcSessions: {
          where: { status: { in: ["IN_PROGRESS", "CHANGES_REQUIRED"] } },
          include: { qcUser: { select: { name: true } } },
        },
      },
    }),
    db.bill.findMany({
      where: { warehouseId, createdAt: { gte: startOfToday } },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }),
    db.bill.findMany({
      where: { warehouseId, createdAt: { gte: startOfYesterday, lte: endOfYesterday } },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    }),
    db.task.count({ where: { warehouseId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    db.purchaseOrder.count({ where: { warehouseId, status: "PENDING_APPROVAL" } }),
    db.discountApproval.count({ where: { warehouseId, status: "PENDING" } }),
  ]);

  const salesToday = todaysBills.reduce((s, b) => s + Number(b.versions[0]?.total ?? 0), 0);
  const salesYesterday = yesterdaysBills.reduce((s, b) => s + Number(b.versions[0]?.total ?? 0), 0);

  const invMap = new Map<string, number>();
  for (const inv of inventory) {
    invMap.set(inv.productId, Number(inv.quantityOnHand || 0));
  }

  let inventoryValue = 0;
  let oosCount = 0;
  const lowStock: Array<{ product: string; sku: string; onHand: number; minStock: number; level: StockLevel }> = [];

  for (const p of allProducts) {
    const onHand = invMap.get(p.id) || 0;
    const minStock = p.minStock != null ? Number(p.minStock) : 0;
    const price = Number(p.wholesalePrice || 0);

    if (onHand > 0) {
      inventoryValue += onHand * price;
      if (minStock > 0) {
        const level = stockLevel(onHand, minStock);
        if (level !== "ok") {
          lowStock.push({ product: p.name, sku: p.sku, onHand, minStock, level });
        }
      }
    } else {
      oosCount++;
    }
  }

  const activeQcLocks = lockedOrders.flatMap((o) =>
    o.qcSessions.map((s) => ({
      qcSessionId: s.id,
      orderId: o.id,
      orderNumber: o.orderNumber,
      holderName: s.qcUser.name,
      lockedSince: s.lastActiveAt,
    }))
  );

  return NextResponse.json({
    warehouseId,
    salesToday,
    salesYesterday,
    salesGrowthPercent: salesYesterday > 0 ? ((salesToday - salesYesterday) / salesYesterday) * 100 : 0,
    todaysOrders,
    yesterdaysOrders,
    pendingQc,
    completedToday,
    inventoryValue,
    lowStockCount: lowStock.filter((i) => i.level === "low").length,
    nearMinCount: lowStock.filter((i) => i.level === "near").length,
    oosCount,
    lowStockItems: toLowStockItems(lowStock),
    staffCount,
    activeQcLocks,
    pendingTasksCount,
    pendingPOsCount,
    pendingDiscountsCount,
  });
}
