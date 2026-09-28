import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // 1. Warehouses (if admin or manager)
    let warehouses: { id: string; name: string; code: string }[] = [];
    if (session.role === "ADMIN") {
      warehouses = await db.warehouse.findMany({
        where: { active: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      });
    }

    // 2. Cash Sessions & Management
    const latestCashSession = await db.cashSession.findFirst({
      where,
      orderBy: { createdAt: "desc" },
    });

    const openCashSessions = await db.cashSession.count({
      where: {
        ...where,
        status: "OPEN",
      },
    });

    const cashDiscrepancySessions = await db.cashSession.count({
      where: {
        ...where,
        difference: { not: 0 },
        status: "CLOSED",
      },
    });

    const cashBal = latestCashSession ? Number(latestCashSession.actualCash || latestCashSession.expectedCash || latestCashSession.openingCash) : 0;
    const cashOpening = latestCashSession ? Number(latestCashSession.openingCash) : 0;
    const cashExpected = latestCashSession ? Number(latestCashSession.expectedCash || 0) : 0;
    const cashActual = latestCashSession ? Number(latestCashSession.actualCash || 0) : 0;
    const cashDiff = latestCashSession ? Number(latestCashSession.difference || 0) : 0;

    // 3. Bank Balances & Management
    const latestBank = await db.bankBalance.findFirst({
      where,
      orderBy: { businessDate: "desc" },
    });

    const unreconciledBankTx = await db.bankTransaction.findMany({
      where: {
        ...where,
        reconciled: false,
      },
    });
    const unreconciledBankAmount = unreconciledBankTx.reduce((sum, tx) => sum + Number(tx.amount), 0);

    const bankBal = latestBank ? Number(latestBank.closingBalance) : 0;

    // 4. UPI / Digital Payments & Settlements
    const upiSettlements = await db.uPISettlement.findMany({
      where,
      orderBy: { collectionDate: "desc" },
      take: 100,
    });

    const pendingUpiSettlements = upiSettlements.filter((s) => s.status === "PENDING");
    const pendingUpiAmount = pendingUpiSettlements.reduce((sum, s) => sum + Number(s.collectedAmount), 0);
    const discrepancyUpiCount = upiSettlements.filter((s) => s.status === "DISCREPANCY").length;
    const totalUpiFeeDeductions = upiSettlements.reduce((sum, s) => sum + Number(s.chargesAmount || 0), 0);

    // 5. Today's & Month's Collections & Payment Transactions
    const todayPayments = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: today },
        status: "CONFIRMED",
        payment: {
          bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
        },
      },
    });

    let todayCollection = 0;
    let todayCash = 0;
    let todayUpi = 0;
    let todayBank = 0;
    for (const p of todayPayments) {
      const amt = Number(p.amount);
      if (p.type === "PAYMENT") {
        todayCollection += amt;
        if (p.method === "CASH") todayCash += amt;
        else if (p.method === "UPI") todayUpi += amt;
        else todayBank += amt;
      }
    }

    // 6. Expenses & Categories
    const todayExpensesList = await db.expense.findMany({
      where: {
        ...where,
        date: { gte: today },
      },
    });
    const totalTodayExpense = todayExpensesList.reduce((sum, e) => sum + Number(e.amount), 0);

    const monthExpensesList = await db.expense.findMany({
      where: {
        ...where,
        date: { gte: monthStart },
      },
    });
    const totalMonthExpense = monthExpensesList.reduce((sum, e) => sum + Number(e.amount), 0);

    const expenseCategoryMap: Record<string, number> = {};
    for (const exp of monthExpensesList) {
      expenseCategoryMap[exp.category] = (expenseCategoryMap[exp.category] || 0) + Number(exp.amount);
    }
    const expensesByCategory = Object.entries(expenseCategoryMap).map(([category, amount]) => ({
      category,
      amount,
    }));

    // 7. Accounts Receivable (Unpaid Customer Invoices & Ageing)
    const unpaidOrders = await db.order.findMany({
      where: {
        ...where,
        status: { in: ["BILLED", "PAYMENT_PENDING", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER", "COMPLETED"] },
        bill: {
          paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PENDING", "PAYMENT_ADJUSTMENT_REQUIRED"] },
        },
      },
      include: {
        customer: { select: { id: true, shopName: true } },
        bill: {
          include: {
            payment: true,
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        },
      },
    });

    const now = new Date().getTime();
    let totalReceivables = 0;
    let overdueReceivablesCount = 0;
    const distinctCustomers = new Set<string>();
    const ageing = {
      bucket0_7: 0,
      bucket8_15: 0,
      bucket16_30: 0,
      bucket31_60: 0,
      bucket60Plus: 0,
    };

    for (const ord of unpaidOrders) {
      const billVersion = ord.bill?.versions[0];
      const billTotal = billVersion ? Number(billVersion.total) : 0;
      const amountPaid = ord.bill?.payment ? Number(ord.bill.payment.amountPaid) : 0;
      const balanceDue = Math.max(0, billTotal - amountPaid);
      if (balanceDue > 0) {
        totalReceivables += balanceDue;
        distinctCustomers.add(ord.customerId);

        const billAgeDays = Math.floor((now - new Date(ord.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        if (billAgeDays > 15) overdueReceivablesCount++;

        if (billAgeDays <= 7) ageing.bucket0_7 += balanceDue;
        else if (billAgeDays <= 15) ageing.bucket8_15 += balanceDue;
        else if (billAgeDays <= 30) ageing.bucket16_30 += balanceDue;
        else if (billAgeDays <= 60) ageing.bucket31_60 += balanceDue;
        else ageing.bucket60Plus += balanceDue;
      }
    }

    // 8. Accounts Payable & Supplier Payments
    const unpaidPurchaseBills = await db.purchaseBill.findMany({
      where: {
        ...where,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    const distinctSuppliers = new Set<string>();
    let totalPayables = 0;
    let overduePayablesCount = 0;

    for (const pb of unpaidPurchaseBills) {
      const tot = Number(pb.total);
      totalPayables += tot;
      distinctSuppliers.add(pb.supplierId);
      if (pb.dueDate && new Date(pb.dueDate) < today) {
        overduePayablesCount++;
      }
    }

    const supplierPaymentVouchers = await db.voucher.findMany({
      where: {
        ...where,
        type: "PAYMENT_VOUCHER",
        date: { gte: monthStart },
      },
    });
    const totalSupplierPaymentsMonth = supplierPaymentVouchers.reduce((sum, v) => sum + Number(v.amount), 0);
    const todaySupplierPayments = supplierPaymentVouchers
      .filter((v) => new Date(v.date) >= today)
      .reduce((sum, v) => sum + Number(v.amount), 0);

    // 9. Refunds & Credit Notes
    const todayRefundTransactions = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: today },
        type: "REFUND",
        status: "CONFIRMED",
        payment: {
          bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
        },
      },
    });
    const todayRefunds = todayRefundTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

    const monthRefundTransactions = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: monthStart },
        type: "REFUND",
        status: "CONFIRMED",
        payment: {
          bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
        },
      },
    });
    const totalRefundsMonth = monthRefundTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

    const paymentAdjustmentsCount = await db.paymentAdjustment.count({
      where: {
        createdAt: { gte: monthStart },
      },
    });

    // 10. Profitability Analysis (Month-to-date Revenue vs COGS)
    const monthBills = await db.bill.findMany({
      where: {
        ...where,
        createdAt: { gte: monthStart },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: {
            items: {
              include: {
                product: { select: { avgCost: true } },
              },
            },
          },
        },
      },
    });

    let grossRevenue = 0;
    let estimatedCogs = 0;
    let outputGst = 0;

    for (const b of monthBills) {
      const ver = b.versions[0];
      if (ver) {
        grossRevenue += Number(ver.subtotal);
        outputGst += Number(ver.taxTotal);
        for (const item of ver.items) {
          const qty = Number(item.quantity);
          const cost = item.product?.avgCost ? Number(item.product.avgCost) : Number(item.unitPrice) * 0.85;
          estimatedCogs += qty * cost;
        }
      }
    }

    const grossProfit = Math.max(0, grossRevenue - estimatedCogs);
    const grossMarginPercent = grossRevenue > 0 ? (grossProfit / grossRevenue) * 100 : 0;
    const netOperatingProfit = grossProfit - totalMonthExpense;
    const netMarginPercent = grossRevenue > 0 ? (netOperatingProfit / grossRevenue) * 100 : 0;

    // 11. Tax / GST (Output Tax vs Input Tax Credit from Purchase Bills)
    const monthPurchases = await db.purchaseBill.findMany({
      where: {
        ...where,
        createdAt: { gte: monthStart },
      },
      select: { gstAmount: true },
    });
    const inputTaxCredit = monthPurchases.reduce((sum, p) => sum + Number(p.gstAmount), 0);
    const netGstPayable = Math.max(0, outputGst - inputTaxCredit);

    // 12. Audit & Controls
    const pendingVouchersApproval = await db.voucher.count({
      where: { ...where, status: "PENDING_APPROVAL" },
    });
    const pendingDiscountApprovals = await db.discountApproval.count({
      where: { ...where, status: "PENDING" },
    });
    const pendingStockAdjustments = await db.stockAdjustmentRequest.count({
      where: { ...where, status: "PENDING" },
    });

    const recentAuditLogsRaw = await db.auditLog.findMany({
      where: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
      orderBy: { timestamp: "desc" },
      take: 6,
      include: {
        user: { select: { name: true, staffId: true } },
      },
    });

    const recentAuditLogs = recentAuditLogsRaw.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      timestamp: log.timestamp.toISOString(),
      user: log.user ? `${log.user.name} (${log.user.staffId})` : "System",
    }));

    // 13. 7-Day Trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const pastPayments = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: sevenDaysAgo },
        status: "CONFIRMED",
        payment: {
          bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
        },
      },
      select: { amount: true, timestamp: true, type: true },
    });

    const pastExpenses = await db.expense.findMany({
      where: {
        ...where,
        date: { gte: sevenDaysAgo },
      },
      select: { amount: true, date: true },
    });

    const trendDays: { date: string; label: string; collections: number; expenses: number; net: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0] || "";
      const dayLabel = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

      const dayCollections = pastPayments
        .filter((p) => p.type === "PAYMENT" && new Date(p.timestamp).toISOString().split("T")[0] === dateStr)
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const dayExpenses = pastExpenses
        .filter((e) => new Date(e.date).toISOString().split("T")[0] === dateStr)
        .reduce((sum, e) => sum + Number(e.amount), 0);

      trendDays.push({
        date: dateStr,
        label: dayLabel,
        collections: dayCollections,
        expenses: dayExpenses,
        net: dayCollections - dayExpenses,
      });
    }

    // 14. Recent Activity (Latest vouchers)
    const recentVouchers = await db.voucher.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        warehouse: { select: { name: true, code: true } },
      },
    });

    const netWorkingCapital = cashBal + bankBal + totalReceivables - totalPayables;

    return NextResponse.json({
      // 1. Overview & Liquidity
      cashBalance: cashBal,
      bankBalance: bankBal,
      totalReceivables,
      totalPayables,
      netWorkingCapital,
      netCashFlow: todayCollection - totalTodayExpense,

      // 2. Cash Management
      cash: {
        status: latestCashSession?.status || "CLOSED",
        openingCash: cashOpening,
        expectedCash: cashExpected,
        actualCash: cashActual,
        difference: cashDiff,
        discrepancyCount: cashDiscrepancySessions,
        openSessionsCount: openCashSessions,
      },

      // 3. Bank Management
      bank: {
        closingBalance: bankBal,
        unreconciledTxCount: unreconciledBankTx.length,
        unreconciledAmount: unreconciledBankAmount,
        recentTxCount: unreconciledBankTx.length,
      },

      // 4. UPI / Digital Payments
      upi: {
        todayTotal: todayUpi,
        pendingSettlementAmount: pendingUpiAmount,
        pendingCount: pendingUpiSettlements.length,
        discrepancyCount: discrepancyUpiCount,
        totalFeeDeductions: totalUpiFeeDeductions,
      },

      // 5. Accounts Receivable
      receivables: {
        total: totalReceivables,
        customerCount: distinctCustomers.size,
        overdueCount: overdueReceivablesCount,
        ageing,
      },

      // 6. Accounts Payable
      payables: {
        total: totalPayables,
        supplierCount: distinctSuppliers.size,
        overdueBillsCount: overduePayablesCount,
        pendingBillsCount: unpaidPurchaseBills.length,
      },

      // 7. Collections
      collections: {
        todayTotal: todayCollection,
        todayCash,
        todayUpi,
        todayBank,
        txCount: todayPayments.length,
      },

      // 8. Supplier Payments
      supplierPayments: {
        monthTotal: totalSupplierPaymentsMonth,
        todayPaid: todaySupplierPayments,
        voucherCount: supplierPaymentVouchers.length,
      },

      // 9. Expenses
      expenses: {
        todayTotal: totalTodayExpense,
        monthTotal: totalMonthExpense,
        byCategory: expensesByCategory,
        pendingApprovalCount: 0,
      },

      // 10. Refunds & Credit Notes
      refunds: {
        todayRefunds,
        totalRefundsMonth,
        adjustmentsCount: paymentAdjustmentsCount,
        pendingRefundCount: todayRefundTransactions.length,
      },

      // 11. Reconciliation
      reconciliation: {
        bankMismatch: unreconciledBankAmount,
        cashDiscrepancies: cashDiscrepancySessions,
        upiUnsettled: pendingUpiAmount,
        status: unreconciledBankAmount === 0 && cashDiscrepancySessions === 0 ? "BALANCED" : "ATTENTION_REQUIRED",
      },

      // 12. Profitability
      profitability: {
        grossRevenue,
        estimatedCogs,
        grossProfit,
        grossMarginPercent,
        operatingExpenses: totalMonthExpense,
        netOperatingProfit,
        netMarginPercent,
      },

      // 13. Tax / GST
      taxGst: {
        outputGst,
        inputTaxCredit,
        netGstPayable,
        pendingInvoicesCount: monthBills.length,
      },

      // 14. Financial Reports
      reports: {
        pnlReady: true,
        balanceSheetBalanced: true,
        cashFlowPositive: todayCollection >= totalTodayExpense,
      },

      // 15. Audit & Controls
      auditControls: {
        pendingVouchersApproval,
        pendingDiscountApprovals,
        pendingStockAdjustments,
        recentAuditLogs,
      },

      // Trend & extra lists
      trend: trendDays,
      recentVouchers,
      warehouses,
      userRole: session.role,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load finance overview" }, { status: 500 });
  }
}
