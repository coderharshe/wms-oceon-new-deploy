import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, isErrorResponse } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(guard)) return guard;

  const prisma = getDb();
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "thisMonth";
  const dateParam = url.searchParams.get("date") || "";
  const monthParam = url.searchParams.get("month") || "";
  const warehouseId = guard.role === "ADMIN" ? url.searchParams.get("warehouseId") || undefined : guard.warehouseId || undefined;

  const now = new Date();
  let startDate: Date;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const parts = dateParam.split("-");
    const y = parseInt(parts[0] ?? "2026", 10);
    const m = parseInt(parts[1] ?? "1", 10) - 1;
    const d = parseInt(parts[2] ?? "1", 10);
    startDate = new Date(y, m, d, 0, 0, 0, 0);
    endDate = new Date(y, m, d, 23, 59, 59, 999);
  } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const parts = monthParam.split("-");
    const y = parseInt(parts[0] ?? "2026", 10);
    const m = parseInt(parts[1] ?? "1", 10) - 1;
    startDate = new Date(y, m, 1, 0, 0, 0, 0);
    endDate = new Date(y, m + 1, 0, 23, 59, 59, 999);
  } else {
    switch (range) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "prevMonth": {
        const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        startDate = new Date(prevM.getFullYear(), prevM.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(prevM.getFullYear(), prevM.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      }
      case "quarter": {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), currentQuarter * 3, 1, 0, 0, 0, 0);
        break;
      }
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
      case "thisMonth":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
    }
  }

  // 1. Fetch Warehouses for multi-warehouse reporting
  const warehouses = await prisma.warehouse.findMany({
    where: { active: true, ...(warehouseId ? { id: warehouseId } : {}) },
    select: { id: true, name: true, code: true },
  });

  // 2. Fetch Orders & Billed Versions
  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ["CANCELLED", "DRAFT"] },
      createdAt: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      customer: true,
      warehouse: { select: { id: true, name: true, code: true } },
      items: {
        include: {
          product: true,
          unit: true,
        },
      },
      bill: {
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: {
              items: {
                include: {
                  product: true,
                  unit: true,
                },
              },
            },
          },
          payment: {
            include: {
              transactions: true,
            },
          },
        },
      },
    },
  });

  // 3. Fetch Payments & Collections
  const paymentTransactions = await prisma.paymentTransaction.findMany({
    where: {
      timestamp: { gte: startDate, lte: endDate },
    },
    include: {
      payment: {
        include: {
          bill: {
            include: {
              order: {
                include: { customer: true },
              },
            },
          },
        },
      },
    },
  });

  // 4. Fetch Expenses
  const expenses = await prisma.expense.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
    },
  });

  // 5. Fetch Vouchers (Receipts & Payments)
  const vouchers = await prisma.voucher.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      status: { not: "CANCELLED" },
      ...(warehouseId ? { warehouseId } : {}),
    },
  });

  // 6. Fetch Purchase Bills (Inward Procurement & Payables)
  const purchaseBills = await prisma.purchaseBill.findMany({
    where: {
      billDate: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      supplier: true,
      warehouse: { select: { id: true, name: true, code: true } },
    },
  });

  // 7. Fetch All Active Customers & Receivables
  const allCustomers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
  });

  // 8. Fetch All Suppliers & Current Outstanding Payables
  const allSuppliers = await prisma.supplier.findMany({
    where: { active: true },
    include: {
      purchaseBills: {
        where: { paymentStatus: { not: "PAID" } },
      },
    },
  });

  // 9. Fetch Cash Sessions for Cash Closing
  const cashSessions = await prisma.cashSession.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      transactions: true,
    },
  });

  // 10. Fetch Bank Balances & UPI Settlements
  const bankBalances = await prisma.bankBalance.findMany({
    where: {
      businessDate: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
  });

  const upiSettlements = await prisma.uPISettlement.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
  });

  // 11. Fetch Sales Returns / Payment Adjustments
  const adjustments = await prisma.paymentAdjustment.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
  });

  // ── Compute Daily Flash Report Metrics ──
  let dailyGrossSales = 0;
  let dailyB2bSales = 0;
  let dailyB2cSales = 0;
  let dailyOrdersCount = orders.length;

  for (const order of orders) {
    const total = Number(order.bill?.versions[0]?.total ?? 0);
    dailyGrossSales += total;
    if (order.sellingMode === "WHOLESALE" || order.customer?.type === "WHOLESALE") {
      dailyB2bSales += total;
    } else {
      dailyB2cSales += total;
    }
  }

  let dailyTotalCollections = 0;
  let dailyCashCollection = 0;
  let dailyBankCollection = 0;
  let dailyUpiCollection = 0;
  let dailyChequeCollection = 0;

  for (const pt of paymentTransactions) {
    const amt = Number(pt.amount);
    dailyTotalCollections += amt;
    if (pt.method === "CASH") dailyCashCollection += amt;
    else if (pt.method === "UPI") dailyUpiCollection += amt;
    else if (pt.method === "BANK_TRANSFER") dailyBankCollection += amt;
    else if (pt.method === "CHEQUE") dailyChequeCollection += amt;
  }

  for (const v of vouchers) {
    if (v.type === "RECEIPT_VOUCHER") {
      const amt = Number(v.amount);
      dailyTotalCollections += amt;
      if (v.paymentMode === "CASH") dailyCashCollection += amt;
      else if (v.paymentMode === "UPI") dailyUpiCollection += amt;
      else if (v.paymentMode === "BANK_TRANSFER") dailyBankCollection += amt;
      else if (v.paymentMode === "CHEQUE") dailyChequeCollection += amt;
    }
  }

  let dailyExpensesTotal = 0;
  for (const exp of expenses) {
    dailyExpensesTotal += Number(exp.amount);
  }

  let dailyCashClosingExpected = 0;
  let dailyCashClosingActual = 0;
  for (const cs of cashSessions) {
    dailyCashClosingExpected += Number(cs.expectedCash ?? cs.openingCash);
    dailyCashClosingActual += Number(cs.actualCash ?? cs.openingCash);
  }

  let dailyBankCredits = 0;
  let dailyBankDebits = 0;
  for (const bb of bankBalances) {
    const adj = Number(bb.adjustment || 0);
    if (adj >= 0) dailyBankCredits += adj;
    else dailyBankDebits += Math.abs(adj);
  }

  let dailyUpiSettled = 0;
  let dailyUpiPending = 0;
  let dailyUpiCharges = 0;
  for (const upi of upiSettlements) {
    if (upi.status === "SETTLED") {
      dailyUpiSettled += Number(upi.settlementAmount ?? upi.collectedAmount);
      dailyUpiCharges += Number(upi.chargesAmount ?? 0);
    } else {
      dailyUpiPending += Number(upi.collectedAmount);
    }
  }

  const dailyReport = {
    sales: {
      totalRevenue: Math.round(dailyGrossSales * 100) / 100,
      b2bRevenue: Math.round(dailyB2bSales * 100) / 100,
      b2cRevenue: Math.round(dailyB2cSales * 100) / 100,
      ordersCount: dailyOrdersCount,
      averageOrderValue: dailyOrdersCount > 0 ? Math.round((dailyGrossSales / dailyOrdersCount) * 100) / 100 : 0,
    },
    collections: {
      total: Math.round(dailyTotalCollections * 100) / 100,
      cash: Math.round(dailyCashCollection * 100) / 100,
      upi: Math.round(dailyUpiCollection * 100) / 100,
      bank: Math.round(dailyBankCollection * 100) / 100,
      cheque: Math.round(dailyChequeCollection * 100) / 100,
    },
    expenses: {
      total: Math.round(dailyExpensesTotal * 100) / 100,
      count: expenses.length,
    },
    cashClosing: {
      expectedCash: Math.round(dailyCashClosingExpected * 100) / 100,
      actualCash: Math.round(dailyCashClosingActual * 100) / 100,
      difference: Math.round((dailyCashClosingActual - dailyCashClosingExpected) * 100) / 100,
    },
    bank: {
      totalInflow: Math.round(dailyBankCredits * 100) / 100,
      totalOutflow: Math.round(dailyBankDebits * 100) / 100,
      netFlow: Math.round((dailyBankCredits - dailyBankDebits) * 100) / 100,
    },
    upi: {
      grossUpi: Math.round(dailyUpiCollection * 100) / 100,
      settled: Math.round(dailyUpiSettled * 100) / 100,
      pending: Math.round(dailyUpiPending * 100) / 100,
      charges: Math.round(dailyUpiCharges * 100) / 100,
    },
  };

  // ── Compute Monthly P&L Statement & Balance Figures ──
  let totalReturnsAdjustments = 0;
  for (const adj of adjustments) {
    totalReturnsAdjustments += Math.abs(Number(adj.difference));
  }

  const grossRevenue = dailyGrossSales;
  const netRevenue = Math.max(0, grossRevenue - totalReturnsAdjustments);

  let totalCogs = 0;
  const productProfitMap = new Map<string, {
    sku: string;
    productName: string;
    category: string;
    unitsSold: number;
    unitSellingAvg: number;
    unitLandedAvg: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    marginPct: number;
  }>();

  const customerProfitMap = new Map<string, {
    customerId: string;
    shopName: string;
    ownerName: string;
    customerType: string;
    mobile: string;
    ordersCount: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    marginPct: number;
    outstandingDue: number;
    creditLimit: number;
  }>();

  const channelProfitMap = {
    wholesaleB2B: { channel: "Wholesale (B2B)", ordersCount: 0, revenue: 0, cogs: 0, grossProfit: 0, marginPct: 0 },
    retailB2C: { channel: "Retail / Walk-in (B2C)", ordersCount: 0, revenue: 0, cogs: 0, grossProfit: 0, marginPct: 0 },
  };

  const warehouseProfitMap = new Map<string, {
    warehouseId: string;
    name: string;
    code: string;
    ordersCount: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    localExpenses: number;
    operatingProfit: number;
    marginPct: number;
  }>();

  for (const w of warehouses) {
    warehouseProfitMap.set(w.id, {
      warehouseId: w.id,
      name: w.name,
      code: w.code,
      ordersCount: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      localExpenses: 0,
      operatingProfit: 0,
      marginPct: 0,
    });
  }

  // Aggregate Order Items
  for (const order of orders) {
    const isB2B = order.sellingMode === "WHOLESALE" || order.customer?.type === "WHOLESALE";
    const channelKey = isB2B ? "wholesaleB2B" : "retailB2C";
    channelProfitMap[channelKey].ordersCount += 1;

    const wEntry = warehouseProfitMap.get(order.warehouseId);
    if (wEntry) wEntry.ordersCount += 1;

    const cust = order.customer;
    const custEntry = customerProfitMap.get(cust.id) || {
      customerId: cust.id,
      shopName: cust.shopName || "Customer",
      ownerName: cust.ownerName || "",
      customerType: cust.type,
      mobile: cust.mobile || "",
      ordersCount: 0,
      revenue: 0,
      cogs: 0,
      grossProfit: 0,
      marginPct: 0,
      outstandingDue: Number(cust.outstandingBalance || 0),
      creditLimit: Number(cust.creditLimit || 0),
    };
    custEntry.ordersCount += 1;

    const latestVersion = order.bill?.versions[0];
    const items = latestVersion?.items?.length ? latestVersion.items : order.items;

    for (const item of items) {
      const qty = Number(item.quantity);
      const unitPrice = "unitPrice" in item ? Number((item as any).unitPrice) : Number((item as any).rate ?? 0);
      const lineRevenue = Math.round(qty * unitPrice * 100) / 100;

      // Purchase base cost + 3% freight
      const baseCost = item.product.avgCost ? Number(item.product.avgCost) : Number(item.product.wholesalePrice) * 0.9;
      const unitLandedCost = Math.round(baseCost * 1.03 * 100) / 100;
      const lineCogs = Math.round(qty * unitLandedCost * 100) / 100;
      const lineProfit = Math.round((lineRevenue - lineCogs) * 100) / 100;

      totalCogs += lineCogs;

      channelProfitMap[channelKey].revenue += lineRevenue;
      channelProfitMap[channelKey].cogs += lineCogs;
      channelProfitMap[channelKey].grossProfit += lineProfit;

      custEntry.revenue += lineRevenue;
      custEntry.cogs += lineCogs;
      custEntry.grossProfit += lineProfit;

      if (wEntry) {
        wEntry.revenue += lineRevenue;
        wEntry.cogs += lineCogs;
        wEntry.grossProfit += lineProfit;
      }

      const pEntry = productProfitMap.get(item.product.id) || {
        sku: item.product.sku,
        productName: item.product.name,
        category: item.product.category || "General",
        unitsSold: 0,
        unitSellingAvg: unitPrice,
        unitLandedAvg: unitLandedCost,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        marginPct: 0,
      };
      pEntry.unitsSold += qty;
      pEntry.revenue += lineRevenue;
      pEntry.cogs += lineCogs;
      pEntry.grossProfit += lineProfit;
      productProfitMap.set(item.product.id, pEntry);
    }

    customerProfitMap.set(cust.id, custEntry);
  }

  // Allocate Local Warehouse Expenses
  for (const exp of expenses) {
    const wEntry = warehouseProfitMap.get(exp.warehouseId);
    if (wEntry) {
      wEntry.localExpenses += Number(exp.amount);
    }
  }

  // Finalize Warehouses Margin
  for (const w of Array.from(warehouseProfitMap.values())) {
    w.operatingProfit = Math.round((w.grossProfit - w.localExpenses) * 100) / 100;
    w.marginPct = w.revenue > 0 ? Math.round((w.operatingProfit / w.revenue) * 10000) / 100 : 0;
  }

  // Finalize Channels Margin
  channelProfitMap.wholesaleB2B.marginPct = channelProfitMap.wholesaleB2B.revenue > 0
    ? Math.round((channelProfitMap.wholesaleB2B.grossProfit / channelProfitMap.wholesaleB2B.revenue) * 10000) / 100
    : 0;
  channelProfitMap.retailB2C.marginPct = channelProfitMap.retailB2C.revenue > 0
    ? Math.round((channelProfitMap.retailB2C.grossProfit / channelProfitMap.retailB2C.revenue) * 10000) / 100
    : 0;

  // Finalize Customers Margin
  for (const c of Array.from(customerProfitMap.values())) {
    c.marginPct = c.revenue > 0 ? Math.round((c.grossProfit / c.revenue) * 10000) / 100 : 0;
  }

  // Finalize Products Margin
  for (const p of Array.from(productProfitMap.values())) {
    p.marginPct = p.revenue > 0 ? Math.round((p.grossProfit / p.revenue) * 10000) / 100 : 0;
  }

  // Expense Category Breakdown
  const expenseByCategory: Record<string, number> = {};
  for (const exp of expenses) {
    expenseByCategory[exp.category] = (expenseByCategory[exp.category] || 0) + Number(exp.amount);
  }

  const grossProfit = Math.round((netRevenue - totalCogs) * 100) / 100;
  const grossMarginPct = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 10000) / 100 : 0;
  const totalExpenses = Math.round(dailyExpensesTotal * 100) / 100;
  const operatingProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;
  const operatingMarginPct = netRevenue > 0 ? Math.round((operatingProfit / netRevenue) * 10000) / 100 : 0;

  // Receivables Ageing & Balance
  let totalReceivables = 0;
  let receivablesCurrent = 0;
  let receivablesOverdue15 = 0;
  let receivablesOverdue30 = 0;
  let receivablesOverdue60 = 0;
  let receivablesOverdue90 = 0;

  for (const cust of allCustomers) {
    const bal = Number(cust.outstandingBalance || 0);
    if (bal > 0) {
      totalReceivables += bal;
      if (bal < 5000) receivablesCurrent += bal;
      else if (bal < 25000) receivablesOverdue15 += bal;
      else if (bal < 75000) receivablesOverdue30 += bal;
      else if (bal < 150000) receivablesOverdue60 += bal;
      else receivablesOverdue90 += bal;
    }
  }

  // Supplier Payables
  let totalSupplierPayables = 0;
  let payableOverdueBills = 0;
  const supplierPayableList: Array<{
    supplierId: string;
    supplierName: string;
    category: string;
    creditDays: number;
    pendingBillsCount: number;
    totalPayable: number;
    overdueAmount: number;
    status: string;
  }> = [];

  for (const s of allSuppliers) {
    let suppPending = 0;
    let suppOverdue = 0;
    for (const pb of s.purchaseBills) {
      const billTotal = Number(pb.total);
      suppPending += billTotal;
      if (pb.dueDate && new Date(pb.dueDate) < now) {
        suppOverdue += billTotal;
        payableOverdueBills += 1;
      }
    }
    totalSupplierPayables += suppPending;
    if (suppPending > 0) {
      supplierPayableList.push({
        supplierId: s.id,
        supplierName: s.name,
        category: s.category || "Supplier",
        creditDays: s.creditDays,
        pendingBillsCount: s.purchaseBills.length,
        totalPayable: Math.round(suppPending * 100) / 100,
        overdueAmount: Math.round(suppOverdue * 100) / 100,
        status: suppOverdue > 0 ? "OVERDUE" : "CURRENT",
      });
    }
  }

  // Cash Flow Statement Breakdown
  const cashFlow = {
    operatingInflows: Math.round(dailyTotalCollections * 100) / 100,
    operatingOutflows: Math.round((dailyExpensesTotal + purchaseBills.reduce((s, p) => s + (p.paymentStatus === "PAID" ? Number(p.total) : 0), 0)) * 100) / 100,
    netOperatingCashFlow: Math.round((dailyTotalCollections - dailyExpensesTotal) * 100) / 100,
  };

  return NextResponse.json({
    period: {
      range,
      dateParam,
      monthParam,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    dailyReport,
    monthlyPnL: {
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      returnsAndCreditNotes: Math.round(totalReturnsAdjustments * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      cogs: Math.round(totalCogs * 100) / 100,
      grossProfit,
      grossMarginPct,
      expenseByCategory,
      totalExpenses,
      operatingProfit,
      operatingMarginPct,
    },
    receivables: {
      total: Math.round(totalReceivables * 100) / 100,
      current: Math.round(receivablesCurrent * 100) / 100,
      overdue15: Math.round(receivablesOverdue15 * 100) / 100,
      overdue30: Math.round(receivablesOverdue30 * 100) / 100,
      overdue60: Math.round(receivablesOverdue60 * 100) / 100,
      overdue90: Math.round(receivablesOverdue90 * 100) / 100,
      debtorsCount: allCustomers.filter((c) => Number(c.outstandingBalance) > 0).length,
    },
    payables: {
      total: Math.round(totalSupplierPayables * 100) / 100,
      overdueBillsCount: payableOverdueBills,
      supplierCount: supplierPayableList.length,
      supplierList: supplierPayableList.sort((a, b) => b.totalPayable - a.totalPayable),
    },
    cashFlow,
    businessReports: {
      productProfitability: Array.from(productProfitMap.values()).sort((a, b) => b.grossProfit - a.grossProfit),
      retailerProfitability: Array.from(customerProfitMap.values()).sort((a, b) => b.revenue - a.revenue),
      channelProfitability: Object.values(channelProfitMap),
      warehouseProfitability: Array.from(warehouseProfitMap.values()).sort((a, b) => b.revenue - a.revenue),
    },
  });
}
