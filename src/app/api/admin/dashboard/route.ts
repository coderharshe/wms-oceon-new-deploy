import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  if (isErrorResponse(session)) return session;

  const searchParams = req.nextUrl.searchParams;
  const period = searchParams.get("period") || "30d";
  const warehouseId = searchParams.get("warehouseId") || undefined;

  let since: Date | undefined;
  const now = new Date();
  if (period === "today") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "7d") {
    since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "30d") {
    since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }

  const db = getDb();

  const [
    ordersCount,
    bills,
    cashCollected,
    upiCollected,
    refunds,
    payments,
    inventoryRows,
    qcAdjustments,
    warehouses,
    purchaseBills,
    expenses,
    pendingApprovalsCount,
  ] = await Promise.all([
    db.order.count({
      where: {
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
    }),
    db.bill.findMany({
      where: {
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    }),
    db.paymentTransaction.aggregate({
      where: {
        method: "CASH",
        type: "PAYMENT",
        status: "CONFIRMED",
        ...(since ? { timestamp: { gte: since } } : {}),
      },
      _sum: { amount: true },
    }),
    db.paymentTransaction.aggregate({
      where: {
        method: "UPI",
        type: "PAYMENT",
        status: "CONFIRMED",
        ...(since ? { timestamp: { gte: since } } : {}),
      },
      _sum: { amount: true },
    }),
    db.paymentTransaction.aggregate({
      where: {
        type: "REFUND",
        status: "CONFIRMED",
        ...(since ? { timestamp: { gte: since } } : {}),
      },
      _sum: { amount: true },
    }),
    db.payment.findMany({
      where: {
        bill: {
          paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PAYMENT_ADJUSTMENT_REQUIRED"] },
          ...(warehouseId ? { warehouseId } : {}),
        },
      },
    }),
    db.inventory.findMany({
      where: warehouseId ? { warehouseId } : {},
      include: {
        product: { select: { minStock: true, wholesalePrice: true, name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
    }),
    db.qcAdjustment.count({
      where: since ? { createdAt: { gte: since } } : {},
    }),
    db.warehouse.findMany({ where: { active: true }, select: { id: true, name: true, code: true } }),
    db.purchaseBill.findMany({
      where: {
        ...(since ? { billDate: { gte: since } } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
    }),
    db.expense.aggregate({
      where: {
        ...(since ? { date: { gte: since } } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      _sum: { amount: true },
    }),
    Promise.all([
      db.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } }),
      db.discountApproval.count({ where: { status: "PENDING" } }),
      db.stockAdjustmentRequest.count({ where: { status: "PENDING" } }),
      db.voucher.count({ where: { status: "PENDING_APPROVAL" } }),
    ]),
  ]);

  const totalSales = bills.reduce((s, b) => s + Number(b.versions[0]?.total ?? 0), 0);
  const totalBills = bills.length;
  const aov = totalBills > 0 ? totalSales / totalBills : 0;
  const outstandingReceivables = payments.reduce((s, p) => s + (Number(p.amountDue) - Number(p.amountPaid)), 0);

  const totalPurchases = purchaseBills.reduce((s, p) => s + Number(p.total), 0);
  const totalPayables = purchaseBills
    .filter((p) => p.paymentStatus === "UNPAID" || p.paymentStatus === "PARTIAL")
    .reduce((s, p) => s + Number(p.total), 0);

  const inventoryValue = inventoryRows.reduce(
    (s, i) => s + Number(i.quantityOnHand) * Number(i.product.wholesalePrice),
    0
  );
  const lowStock = inventoryRows.filter(
    (i) => i.product.minStock != null && Number(i.quantityOnHand) <= Number(i.product.minStock)
  );
  const outOfStockCount = inventoryRows.filter((i) => Number(i.quantityOnHand) <= 0).length;

  const totalExpenses = Number(expenses._sum.amount ?? 0);
  const grossMargin = totalSales > 0 ? Math.max(0, ((totalSales - totalPurchases) / totalSales) * 100) : 0;

  const totalPendingApprovals =
    pendingApprovalsCount[0] + pendingApprovalsCount[1] + pendingApprovalsCount[2] + pendingApprovalsCount[3];

  return NextResponse.json({
    period,
    totalOrders: ordersCount,
    totalBills,
    totalSales,
    aov,
    grossMargin,
    cashCollected: Number(cashCollected._sum.amount ?? 0),
    upiCollected: Number(upiCollected._sum.amount ?? 0),
    refunds: Number(refunds._sum.amount ?? 0),
    outstandingReceivables,
    totalPurchases,
    totalPayables,
    totalExpenses,
    inventoryValue,
    lowStockCount: lowStock.length,
    outOfStockCount,
    lowStockItems: lowStock.slice(0, 15).map((i) => ({
      product: i.product.name,
      sku: i.product.sku,
      warehouse: i.warehouse.name,
      onHand: Number(i.quantityOnHand).toFixed(2),
      minStock: i.product.minStock ? Number(i.product.minStock).toFixed(2) : "—",
    })),
    qcAdjustments,
    activeWarehouses: warehouses.length,
    warehousesList: warehouses,
    totalPendingApprovals,
  });
}
