import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const now = new Date();

  const [
    cashDiscrepancies,
    inventoryRows,
    overduePayables,
    overdueReceivables,
    pendingUpi,
    pendingApprovalsCount,
    delayedPos,
  ] = await Promise.all([
    // Cash discrepancies in closed sessions
    db.cashSession.findMany({
      where: {
        status: "CLOSED",
        difference: { not: 0 },
      },
      include: { warehouse: { select: { name: true } }, financeUser: { select: { name: true } } },
      orderBy: { closedAt: "desc" },
      take: 10,
    }),
    // Inventory low stock & OOS
    db.inventory.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true, minStock: true } },
        warehouse: { select: { name: true } },
      },
    }),
    // Overdue payables
    db.purchaseBill.findMany({
      where: {
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        dueDate: { lt: now },
      },
      include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
      take: 15,
    }),
    // Overdue receivables
    db.payment.findMany({
      where: {
        bill: { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      },
      include: {
        bill: {
          include: {
            order: { include: { customer: { select: { shopName: true, mobile: true } } } },
            warehouse: { select: { name: true } },
          },
        },
      },
      take: 15,
    }),
    // UPI settlements pending
    db.uPISettlement.findMany({
      where: { status: "DISCREPANCY" },
      include: { warehouse: { select: { name: true } } },
    }),
    // Pending approvals count
    Promise.all([
      db.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } }),
      db.discountApproval.count({ where: { status: "PENDING" } }),
      db.stockAdjustmentRequest.count({ where: { status: "PENDING" } }),
      db.voucher.count({ where: { status: "PENDING_APPROVAL" } }),
    ]),
    // Delayed POs
    db.purchaseOrder.findMany({
      where: {
        status: "SENT",
        expectedDelivery: { lt: now },
      },
      include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
    }),
  ]);

  const oosItems = inventoryRows.filter((i) => Number(i.quantityOnHand) <= 0);
  const lowStockItems = inventoryRows.filter(
    (i) => i.product.minStock != null && Number(i.quantityOnHand) > 0 && Number(i.quantityOnHand) <= Number(i.product.minStock)
  );

  const totalPendingApprovals =
    pendingApprovalsCount[0] + pendingApprovalsCount[1] + pendingApprovalsCount[2] + pendingApprovalsCount[3];

  const criticalAlerts = [];
  const warningAlerts = [];
  const infoAlerts = [];

  // Critical: Cash mismatches
  for (const cs of cashDiscrepancies) {
    if (Number(cs.difference) !== 0) {
      criticalAlerts.push({
        id: `cash-diff-${cs.id}`,
        category: "FINANCE",
        title: `Cash Difference at ${cs.warehouse.name}`,
        message: `Closing discrepancy of ₹${Math.abs(Number(cs.difference)).toFixed(2)} (${Number(cs.difference) < 0 ? "Shortage" : "Surplus"}) by ${cs.financeUser.name}. Reason: ${cs.discrepancyReason || "None"}`,
        timestamp: cs.closedAt || cs.createdAt,
        actionUrl: "/admin/cash",
      });
    }
  }

  // Critical: Out of Stock
  if (oosItems.length > 0) {
    criticalAlerts.push({
      id: "inv-oos",
      category: "INVENTORY",
      title: `${oosItems.length} Products Completely Out of Stock (0 Qty)`,
      message: `Critical SKUs: ${oosItems.slice(0, 5).map((i) => `${i.product.name} (${i.product.sku})`).join(", ")}${oosItems.length > 5 ? ` and ${oosItems.length - 5} more` : ""}.`,
      timestamp: now,
      actionUrl: "/procurement/requisitions",
    });
  }

  // Critical: UPI Discrepancies
  for (const upi of pendingUpi) {
    criticalAlerts.push({
      id: `upi-disc-${upi.id}`,
      category: "FINANCE",
      title: `UPI Gateway Settlement Discrepancy`,
      message: `Txn ${upi.transactionId}: Collected ₹${Number(upi.collectedAmount).toFixed(2)}, Settled ₹${Number(upi.settlementAmount ?? 0).toFixed(2)}.`,
      timestamp: upi.createdAt,
      actionUrl: "/finance/upi",
    });
  }

  // Warnings: Overdue supplier payables
  if (overduePayables.length > 0) {
    const totalDue = overduePayables.reduce((s, p) => s + Number(p.total), 0);
    warningAlerts.push({
      id: "payables-overdue",
      category: "PURCHASE",
      title: `${overduePayables.length} Supplier Bills Overdue for Payment`,
      message: `Total overdue payable amount: ₹${totalDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })} across suppliers: ${[...new Set(overduePayables.map((p) => p.supplier.name))].slice(0, 4).join(", ")}.`,
      timestamp: now,
      actionUrl: "/finance/payables",
    });
  }

  // Warnings: Overdue Customer Receivables
  if (overdueReceivables.length > 0) {
    const totalRec = overdueReceivables.reduce((s, p) => s + (Number(p.amountDue) - Number(p.amountPaid)), 0);
    warningAlerts.push({
      id: "receivables-overdue",
      category: "SALES",
      title: `${overdueReceivables.length} Customer Bills Unpaid / Payment Overdue`,
      message: `Total outstanding receivables: ₹${totalRec.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`,
      timestamp: now,
      actionUrl: "/finance/receivables",
    });
  }

  // Warnings: Low Stock Items
  if (lowStockItems.length > 0) {
    warningAlerts.push({
      id: "inv-low",
      category: "INVENTORY",
      title: `${lowStockItems.length} Products Below Minimum Reorder Level`,
      message: `Items needing procurement: ${lowStockItems.slice(0, 5).map((i) => i.product.name).join(", ")}.`,
      timestamp: now,
      actionUrl: "/procurement/requisitions",
    });
  }

  // Warnings: Delayed POs
  if (delayedPos.length > 0) {
    warningAlerts.push({
      id: "po-delayed",
      category: "PROCUREMENT",
      title: `${delayedPos.length} Purchase Orders Past Expected Delivery Date`,
      message: `POs delayed: ${delayedPos.map((p) => `${p.poNumber} (${p.supplier.name})`).join(", ")}.`,
      timestamp: now,
      actionUrl: "/procurement/orders",
    });
  }

  // Info: Pending approvals
  if (totalPendingApprovals > 0) {
    infoAlerts.push({
      id: "approvals-pending",
      category: "APPROVALS",
      title: `${totalPendingApprovals} Items Awaiting Admin Approval`,
      message: `POs: ${pendingApprovalsCount[0]}, Discounts: ${pendingApprovalsCount[1]}, Stock Variances: ${pendingApprovalsCount[2]}, Vouchers: ${pendingApprovalsCount[3]}.`,
      timestamp: now,
      actionUrl: "/admin/approvals",
    });
  }

  return NextResponse.json({
    summary: {
      critical: criticalAlerts.length,
      warning: warningAlerts.length,
      info: infoAlerts.length,
      total: criticalAlerts.length + warningAlerts.length + infoAlerts.length,
    },
    criticalAlerts,
    warningAlerts,
    infoAlerts,
  });
}
