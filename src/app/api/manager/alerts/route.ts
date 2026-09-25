import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { stockLevel } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  let warehouseId = session.warehouseId;
  if (!warehouseId && session.role === "ADMIN") {
    const firstWh = await db.warehouse.findFirst({ where: { active: true } });
    warehouseId = firstWh?.id ?? null;
  }
  if (!warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    inventoryRows,
    ordersNeedingReview,
    overdueTasks,
    pendingDiscounts,
    lockedOrders,
    completedTodayCount,
  ] = await Promise.all([
    db.inventory.findMany({
      where: { warehouseId },
      include: { product: { select: { name: true, sku: true, minStock: true } } },
    }),
    db.order.findMany({
      where: { warehouseId, needsReview: true },
      include: { customer: { select: { shopName: true } } },
      take: 10,
    }),
    db.task.findMany({
      where: {
        warehouseId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        dueDate: { lt: startOfDay },
      },
      include: { assignedTo: { select: { name: true, staffId: true } } },
    }),
    db.discountApproval.findMany({
      where: { warehouseId, status: "PENDING" },
      include: { requestedByUser: { select: { name: true } } },
    }),
    db.qcSession.findMany({
      where: {
        order: { warehouseId },
        status: { in: ["IN_PROGRESS", "CHANGES_REQUIRED"] },
      },
      include: { qcUser: { select: { name: true } }, order: { select: { orderNumber: true } } },
    }),
    db.order.count({ where: { warehouseId, status: "COMPLETED", updatedAt: { gte: startOfDay } } }),
  ]);

  const oosItems = inventoryRows.filter((i) => Number(i.quantityOnHand) <= 0);
  const lowStockItems = inventoryRows.filter((i) => {
    if (i.product.minStock == null) return false;
    const onHand = Number(i.quantityOnHand);
    const min = Number(i.product.minStock);
    return onHand > 0 && stockLevel(onHand, min) !== "ok";
  });

  const critical = [];
  const warning = [];
  const normal = [];

  // Critical: OOS SKUs
  if (oosItems.length > 0) {
    critical.push({
      id: "mgr-oos",
      category: "INVENTORY",
      title: `${oosItems.length} Products Completely Out of Stock (0 Qty)`,
      message: `Impacted items: ${oosItems.slice(0, 4).map((i) => i.product.name).join(", ")}. Requisition needed.`,
      actionUrl: "/manager/inventory",
    });
  }

  // Critical: Orders needing Manager Review
  if (ordersNeedingReview.length > 0) {
    critical.push({
      id: "mgr-order-review",
      category: "ORDERS",
      title: `${ordersNeedingReview.length} Orders Flagged for Manager Review`,
      message: `Issues on orders: ${ordersNeedingReview.map((o) => `${o.orderNumber} (${o.reviewNotes || "Discrepancy"})`).slice(0, 3).join("; ")}.`,
      actionUrl: "/manager/orders",
    });
  }

  // Warning: Overdue Tasks
  if (overdueTasks.length > 0) {
    warning.push({
      id: "mgr-tasks-overdue",
      category: "OPERATIONS",
      title: `${overdueTasks.length} Operations Tasks Overdue`,
      message: `Tasks delayed: ${overdueTasks.map((t) => `${t.taskNo} (${t.title})`).slice(0, 3).join(", ")}.`,
      actionUrl: "/manager/tasks",
    });
  }

  // Warning: Low stock
  if (lowStockItems.length > 0) {
    warning.push({
      id: "mgr-low-stock",
      category: "INVENTORY",
      title: `${lowStockItems.length} Items Below Minimum Stock Threshold`,
      message: `Items needing stock replenishment: ${lowStockItems.slice(0, 4).map((i) => i.product.name).join(", ")}.`,
      actionUrl: "/manager/inventory",
    });
  }

  // Warning: Pending Discounts
  if (pendingDiscounts.length > 0) {
    warning.push({
      id: "mgr-discounts-pending",
      category: "SALES",
      title: `${pendingDiscounts.length} Billing Discounts Pending Review`,
      message: `Discounts requested by billing clerks waiting for sign-off.`,
      actionUrl: "/billing/discounts",
    });
  }

  // Warning: QC Active sessions
  if (lockedOrders.length > 0) {
    warning.push({
      id: "mgr-qc-active",
      category: "QC",
      title: `${lockedOrders.length} Orders Actively in Picking / QC Check`,
      message: `Holders: ${lockedOrders.map((l) => `${l.order.orderNumber} (${l.qcUser.name})`).join(", ")}.`,
      actionUrl: "/manager",
    });
  }

  // Normal: Daily progress
  normal.push({
    id: "mgr-daily-progress",
    category: "DISPATCH",
    title: `${completedTodayCount} Orders Picked, Checked & Dispatched Today`,
    message: `Operations flowing normally for current business date.`,
    actionUrl: "/manager/orders",
  });

  return NextResponse.json({
    summary: {
      critical: critical.length,
      warning: warning.length,
      normal: normal.length,
    },
    critical,
    warning,
    normal,
  });
}
