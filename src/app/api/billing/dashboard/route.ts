import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "BILLING", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || undefined;

  try {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const where: any = {
      createdAt: { gte: today, lte: endOfToday },
    };
    if (warehouseId && warehouseId !== "all") {
      where.warehouseId = warehouseId;
    }

    // 1. Fetch Today's Orders with Bill, Customer, Items and Payment
    const orders = await db.order.findMany({
      where,
      include: {
        customer: {
          select: { id: true, shopName: true, ownerName: true, mobile: true, type: true },
        },
        items: true,
        bill: {
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              include: {
                items: true,
              },
            },
            payment: {
              include: {
                transactions: true,
              },
            },
            adjustments: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 2. Fetch Payment Transactions collected today
    const paymentTxs = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: today, lte: endOfToday },
        status: "CONFIRMED",
        payment: {
          bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
        },
      },
      include: {
        payment: {
          include: {
            bill: {
              include: {
                order: {
                  include: {
                    customer: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    // 3. Fetch Adjustments / Refunds logged today
    const adjustments = await db.paymentAdjustment.findMany({
      where: {
        createdAt: { gte: today, lte: endOfToday },
        bill: warehouseId && warehouseId !== "all" ? { warehouseId } : undefined,
      },
    });

    // ── Metric Calculations ──
    let todaySales = 0;
    let totalBillsCount = 0;
    let totalItemsSold = 0;
    let pendingBillsCount = 0;
    let pendingBillsAmount = 0;
    let cancelledBillsCount = 0;
    let cancelledBillsAmount = 0;

    type RecentBillItem = {
      id: string;
      orderNumber: string;
      billNumber: string;
      customerName: string;
      customerType: string;
      sellingMode: string;
      total: number;
      itemsCount: number;
      orderStatus: string;
      paymentStatus: string;
      paidAmount: number;
      createdAt: string;
    };

    const recentBills: RecentBillItem[] = [];

    for (const o of orders) {
      const isCancelled = o.status === "CANCELLED";
      const isDraft = o.status === "DRAFT";

      const latestVersion = o.bill?.versions[0];
      const billTotal = latestVersion ? Number(latestVersion.total) : o.items.reduce((s, it) => s + Number(it.lineTotal), 0);
      const itemsCount = latestVersion?.items?.length ? latestVersion.items.length : o.items.length;
      const unitsQuantity = latestVersion?.items?.length
        ? latestVersion.items.reduce((s, it) => s + Number(it.quantity), 0)
        : o.items.reduce((s, it) => s + Number(it.quantity), 0);

      // Paid Amount from Transactions
      const paidAmt = o.bill?.payment?.transactions.reduce((s, tx) => (tx.status === "CONFIRMED" ? s + Number(tx.amount) : s), 0) || 0;

      if (isCancelled) {
        cancelledBillsCount += 1;
        cancelledBillsAmount += billTotal;
      } else if (!isDraft) {
        totalBillsCount += 1;
        todaySales += billTotal;
        totalItemsSold += unitsQuantity;

        if (o.bill?.paymentStatus !== "PAID" || o.status === "PAYMENT_PENDING" || o.status === "QC_ADJUSTMENT_REQUIRED" || o.status === "ADDITIONAL_PAYMENT_REQUIRED") {
          pendingBillsCount += 1;
          pendingBillsAmount += Math.max(0, billTotal - paidAmt);
        }
      }

      recentBills.push({
        id: o.id,
        orderNumber: o.orderNumber,
        billNumber: o.bill?.billNumber || o.orderNumber,
        customerName: o.customer?.shopName || o.customer?.ownerName || "Walk-in Customer",
        customerType: o.customer?.type || "RETAIL",
        sellingMode: o.sellingMode,
        total: Math.round(billTotal * 100) / 100,
        itemsCount: Math.round(itemsCount),
        orderStatus: o.status,
        paymentStatus: isCancelled ? "CANCELLED" : (o.bill?.paymentStatus || "UNPAID"),
        paidAmount: Math.round(paidAmt * 100) / 100,
        createdAt: o.createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });
    }

    // ── Payment Collection Calculations ──
    let totalCashCollection = 0;
    let totalUpiCollection = 0;
    let totalBankCollection = 0;
    let totalChequeCollection = 0;
    let totalCollectionAmount = 0;

    for (const tx of paymentTxs) {
      const amt = Number(tx.amount);
      totalCollectionAmount += amt;
      if (tx.method === "CASH") totalCashCollection += amt;
      else if (tx.method === "UPI") totalUpiCollection += amt;
      else if (tx.method === "BANK_TRANSFER") totalBankCollection += amt;
      else if (tx.method === "CHEQUE") totalChequeCollection += amt;
    }

    // ── Refund & Adjustment Calculations ──
    let totalRefundsCount = adjustments.length;
    let totalRefundsAmount = 0;
    for (const adj of adjustments) {
      totalRefundsAmount += Math.abs(Number(adj.difference));
    }

    const avgOrderValue = totalBillsCount > 0 ? Math.round((todaySales / totalBillsCount) * 100) / 100 : 0;

    return NextResponse.json({
      metrics: {
        todaySales: Math.round(todaySales * 100) / 100,
        totalBills: totalBillsCount,
        itemsSold: Math.round(totalItemsSold * 100) / 100,
        pendingBills: {
          count: pendingBillsCount,
          amount: Math.round(pendingBillsAmount * 100) / 100,
        },
        cancelledBills: {
          count: cancelledBillsCount,
          amount: Math.round(cancelledBillsAmount * 100) / 100,
        },
        refunds: {
          count: totalRefundsCount,
          amount: Math.round(totalRefundsAmount * 100) / 100,
        },
        paymentCollection: {
          total: Math.round(totalCollectionAmount * 100) / 100,
          cash: Math.round(totalCashCollection * 100) / 100,
          upi: Math.round(totalUpiCollection * 100) / 100,
          bank: Math.round(totalBankCollection * 100) / 100,
          cheque: Math.round(totalChequeCollection * 100) / 100,
          transactionsCount: paymentTxs.length,
        },
        avgOrderValue,
      },
      recentBills: recentBills.slice(0, 15),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load billing metrics" }, { status: 500 });
  }
}
