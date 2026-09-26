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
    if (warehouseId) where.warehouseId = warehouseId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Cash Sessions
    const latestCashSession = await db.cashSession.findFirst({
      where,
      orderBy: { createdAt: "desc" },
    });

    // 2. Bank Balances
    const latestBank = await db.bankBalance.findFirst({
      where,
      orderBy: { businessDate: "desc" },
    });

    // 3. Today's Collections (PaymentTransactions)
    const todayPayments = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: today },
        status: "CONFIRMED",
        payment: {
          bill: warehouseId ? { warehouseId } : undefined,
        },
      },
    });

    let todayCollection = 0;
    let todayCash = 0;
    let todayUpi = 0;
    for (const p of todayPayments) {
      const amt = Number(p.amount);
      todayCollection += amt;
      if (p.method === "CASH") todayCash += amt;
      if (p.method === "UPI") todayUpi += amt;
    }

    // 4. Today's Expenses
    const todayExpenses = await db.expense.findMany({
      where: {
        ...where,
        date: { gte: today },
      },
    });
    const totalTodayExpense = todayExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

    // 5. Total Receivables
    const unpaidBills = await db.bill.findMany({
      where: {
        ...where,
        paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PENDING"] },
      },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        payment: true,
      },
    });

    let totalReceivables = 0;
    for (const b of unpaidBills) {
      const tot = b.versions[0] ? Number(b.versions[0].total) : 0;
      const paid = b.payment ? Number(b.payment.amountPaid) : 0;
      totalReceivables += Math.max(0, tot - paid);
    }

    // 6. Total Payables
    const unpaidPurchase = await db.purchaseBill.findMany({
      where: {
        ...where,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
    });
    const totalPayables = unpaidPurchase.reduce((sum, b) => sum + Number(b.total), 0);

    return NextResponse.json({
      cashBalance: latestCashSession ? Number(latestCashSession.expectedCash || latestCashSession.openingCash) : 0,
      bankBalance: latestBank ? Number(latestBank.closingBalance) : 0,
      upiToday: todayUpi,
      todayCollection,
      todayCash,
      todayExpenses: totalTodayExpense,
      totalReceivables,
      totalPayables,
      netCashFlow: todayCollection - totalTodayExpense,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load finance overview" }, { status: 500 });
  }
}
