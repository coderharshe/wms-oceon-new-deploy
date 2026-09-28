import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const range = req.nextUrl.searchParams.get("range") || "thisMonth";
  const categoryFilter = req.nextUrl.searchParams.get("category");

  try {
    const db = getDb();
    const whereWh: any = {};
    if (warehouseId && warehouseId !== "all") whereWh.warehouseId = warehouseId;

    const now = new Date();
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (range === "today") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else if (range === "7d") {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
    } else if (range === "thisMonth") {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "year") {
      fromDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    } else {
      // 30d default
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
    }

    const orderWhere: any = {
      ...whereWh,
      status: { in: ["BILLED", "PAYMENT_PENDING", "PAID", "READY_FOR_HANDOVER", "COMPLETED"] },
    };

    const expenseWhere: any = {
      ...whereWh,
    };

    if (fromDate) {
      orderWhere.createdAt = {
        gte: fromDate,
        ...(toDate ? { lte: toDate } : {}),
      };
      expenseWhere.date = {
        gte: fromDate,
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    // 1. Fetch Orders with Line Items & Products
    const orders = await db.order.findMany({
      where: orderWhere,
      include: {
        items: {
          include: {
            product: {
              include: {
                baseUnit: { select: { name: true, symbol: true } },
              },
            },
            unit: { select: { name: true, symbol: true } },
          },
        },
        bill: {
          include: {
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        },
      },
    });

    // 2. Fetch Operating Expenses
    const expenses = await db.expense.findMany({
      where: expenseWhere,
    });

    let totalOperatingExpenses = 0;
    const expenseCategoryBreakdown: Record<string, number> = {};

    for (const exp of expenses) {
      const amt = Number(exp.amount);
      totalOperatingExpenses += amt;
      expenseCategoryBreakdown[exp.category] = (expenseCategoryBreakdown[exp.category] || 0) + amt;
    }

    // 3. Fetch All Products from Master Catalog to show complete catalog unit economics
    const allCatalogProducts = await db.product.findMany({
      where: { active: true },
      include: {
        baseUnit: { select: { name: true, symbol: true } },
      },
      orderBy: { name: "asc" },
    });

    // 4. Product-Level Aggregations (Sales - Landed Cost/COGS = Gross Profit)
    const productMap = new Map<string, {
      productId: string;
      sku: string;
      productName: string;
      category: string;
      unit: string;
      purchasePrice: number;
      inwardFreight: number;
      landedCost: number;
      sellingPrice: number;
      retailPrice: number;
      unitGrossProfit: number;
      grossMarginPct: number;
      markupPct: number;
      unitsSold: number;
      revenue: number;
      cogs: number;
      grossProfit: number;
      orderCount: number;
    }>();

    // Populate catalog defaults
    for (const p of allCatalogProducts) {
      const purchasePrice = p.avgCost ? Number(p.avgCost) : Number(p.wholesalePrice) * 0.75;
      // Landed cost standard freight & inward handling (3% standard or difference)
      const inwardFreight = purchasePrice * 0.03;
      const landedCost = purchasePrice + inwardFreight;
      const sellingPrice = Number(p.wholesalePrice);
      const retailPrice = Number(p.retailPrice);
      const unitGrossProfit = sellingPrice - landedCost;
      const grossMarginPct = sellingPrice > 0 ? (unitGrossProfit / sellingPrice) * 100 : 0;
      const markupPct = landedCost > 0 ? (unitGrossProfit / landedCost) * 100 : 0;

      productMap.set(p.id, {
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        category: p.category || "General",
        unit: p.baseUnit.symbol || "pcs",
        purchasePrice,
        inwardFreight,
        landedCost,
        sellingPrice,
        retailPrice,
        unitGrossProfit,
        grossMarginPct,
        markupPct,
        unitsSold: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        orderCount: 0,
      });
    }

    let totalRevenue = 0;
    let totalCogs = 0;

    for (const ord of orders) {
      for (const item of ord.items) {
        const p = item.product;
        const pId = p.id;
        const lineRev = Number(item.lineTotal);
        const qty = Number(item.quantity);

        const purchasePrice = p.avgCost ? Number(p.avgCost) : Number(p.wholesalePrice) * 0.75;
        const inwardFreight = purchasePrice * 0.03;
        const landedCost = purchasePrice + inwardFreight;
        const itemCogs = qty * landedCost;

        totalRevenue += lineRev;
        totalCogs += itemCogs;

        if (!productMap.has(pId)) {
          const sellingPrice = Number(p.wholesalePrice);
          const retailPrice = Number(p.retailPrice);
          const unitGrossProfit = sellingPrice - landedCost;
          const grossMarginPct = sellingPrice > 0 ? (unitGrossProfit / sellingPrice) * 100 : 0;
          const markupPct = landedCost > 0 ? (unitGrossProfit / landedCost) * 100 : 0;

          productMap.set(pId, {
            productId: pId,
            sku: p.sku,
            productName: p.name,
            category: p.category || "General",
            unit: p.baseUnit.symbol || item.unit.symbol || "pcs",
            purchasePrice,
            inwardFreight,
            landedCost,
            sellingPrice,
            retailPrice,
            unitGrossProfit,
            grossMarginPct,
            markupPct,
            unitsSold: 0,
            revenue: 0,
            cogs: 0,
            grossProfit: 0,
            orderCount: 0,
          });
        }

        const prod = productMap.get(pId)!;
        prod.unitsSold += qty;
        prod.revenue += lineRev;
        prod.cogs += itemCogs;
        prod.orderCount += 1;
      }
    }

    const totalGrossProfit = totalRevenue - totalCogs;
    const grossMarginPct = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;
    const operatingProfit = totalGrossProfit - totalOperatingExpenses;
    const operatingMarginPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

    // Compute Product Contribution Shares
    const productList = Array.from(productMap.values()).map((p) => {
      const grossProfit = p.revenue > 0 ? p.revenue - p.cogs : p.unitGrossProfit;
      const marginPct = p.revenue > 0 ? (grossProfit / p.revenue) * 100 : p.grossMarginPct;
      const contributionPct = totalGrossProfit > 0 ? (grossProfit / totalGrossProfit) * 100 : 0;

      return {
        ...p,
        grossProfit: p.revenue > 0 ? grossProfit : 0,
        grossMarginPct: marginPct,
        contributionSharePct: contributionPct,
      };
    });

    // 5. Category-Level Aggregation
    const categoryMap = new Map<string, {
      category: string;
      revenue: number;
      cogs: number;
      grossProfit: number;
      grossMarginPct: number;
      contributionSharePct: number;
      productCount: number;
      unitsSold: number;
    }>();

    for (const p of productList) {
      const cat = p.category || "General";
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, {
          category: cat,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          grossMarginPct: 0,
          contributionSharePct: 0,
          productCount: 0,
          unitsSold: 0,
        });
      }
      const c = categoryMap.get(cat)!;
      c.revenue += p.revenue;
      c.cogs += p.cogs;
      c.grossProfit += p.grossProfit;
      c.productCount += 1;
      c.unitsSold += p.unitsSold;
    }

    const categoryList = Array.from(categoryMap.values()).map((c) => ({
      ...c,
      grossMarginPct: c.revenue > 0 ? (c.grossProfit / c.revenue) * 100 : 0,
      contributionSharePct: totalGrossProfit > 0 ? (c.grossProfit / totalGrossProfit) * 100 : 0,
    })).sort((a, b) => b.grossProfit - a.grossProfit);

    // Sort product list
    const sortedProducts = productList.sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.grossProfit - a.grossProfit;
    });

    // Apply category filter if requested
    const filteredProducts = categoryFilter && categoryFilter !== "all"
      ? sortedProducts.filter((p) => p.category.toLowerCase() === categoryFilter.toLowerCase())
      : sortedProducts;

    return NextResponse.json({
      range,
      userRole: session.role,
      dashboard: {
        revenue: totalRevenue,
        cogs: totalCogs,
        grossProfit: totalGrossProfit,
        grossMarginPct,
        operatingExpenses: totalOperatingExpenses,
        operatingProfit,
        operatingMarginPct,
        orderCount: orders.length,
        totalSkusSold: productList.filter((p) => p.unitsSold > 0).length,
        totalCatalogSkus: productList.length,
      },
      exampleBenchmark: {
        purchasePrice: 100,
        inwardFreight: 3,
        landedCost: 103,
        sellingPrice: 115,
        grossProfit: 12,
        grossMarginPct: 10.43,
        markupPct: 11.65,
      },
      expenseCategoryBreakdown,
      categoryList,
      productList: filteredProducts,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to calculate profitability" }, { status: 500 });
  }
}
