import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const dateParam = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  try {
    const db = getDb();
    const whereWh: any = {};
    if (warehouseId && warehouseId !== "all") whereWh.warehouseId = warehouseId;

    const queryDate = new Date(dateParam);
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    // ──────────────────────── 1. SYSTEM SALES ────────────────────────
    const orders = await db.order.findMany({
      where: {
        ...whereWh,
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: { notIn: ["DRAFT", "CANCELLED"] },
      },
      include: {
        customer: true,
        bill: {
          include: {
            payment: { include: { transactions: true } },
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        },
      },
    });

    let systemGrossSales = 0;
    let systemInvoicedSales = 0;
    let orderCount = orders.length;

    for (const ord of orders) {
      const version = ord.bill?.versions[0];
      const tot = version ? Number(version.total) : 0;
      systemInvoicedSales += tot;
      systemGrossSales += tot;
    }

    // ──────────────────────── 2. SYSTEM PAYMENTS BY TENDER ────────────────────────
    const paymentTxs = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: startOfDay, lte: endOfDay },
        type: "PAYMENT",
        status: "CONFIRMED",
      },
      include: {
        payment: {
          include: {
            bill: {
              include: {
                order: { include: { customer: true } },
              },
            },
          },
        },
        recordedByUser: { select: { name: true, staffId: true } },
      },
    });

    let systemCashCollected = 0;
    let systemBankCollected = 0;
    let systemUpiCollected = 0;
    let systemChequeCollected = 0;
    let systemCreditSales = 0;

    for (const tx of paymentTxs) {
      const amt = Number(tx.amount);
      if (tx.method === "CASH") systemCashCollected += amt;
      else if (tx.method === "BANK_TRANSFER") systemBankCollected += amt;
      else if (tx.method === "UPI") systemUpiCollected += amt;
      else if (tx.method === "CHEQUE") systemChequeCollected += amt;
      else if (tx.method === "CREDIT") systemCreditSales += amt;
    }

    const systemTotalCollected = systemCashCollected + systemBankCollected + systemUpiCollected + systemChequeCollected;
    const systemOutstandingDue = Math.max(0, systemInvoicedSales - systemTotalCollected);

    // ──────────────────────── 3. ACTUAL PHYSICAL COUNTS & STATEMENTS ────────────────────────
    // Cash Session Actual
    const cashSessions = await db.cashSession.findMany({
      where: {
        businessDate: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { createdAt: "desc" },
    });

    let actualCashCounted = 0;
    let cashDifference = 0;
    let cashSessionStatus = "NO_SESSION";

    const latestSession = cashSessions[0];
    if (latestSession) {
      actualCashCounted = latestSession.actualCash ? Number(latestSession.actualCash) : Number(latestSession.expectedCash || 0);
      cashDifference = latestSession.difference ? Number(latestSession.difference) : 0;
      cashSessionStatus = latestSession.status;
    } else {
      actualCashCounted = systemCashCollected;
    }

    // Bank Statement Inflows
    const bankTxs = await db.bankTransaction.findMany({
      where: {
        businessDate: { gte: startOfDay, lte: endOfDay },
        isCredit: true,
      },
    });

    let actualBankCredits = 0;
    let bankUnreconciledCount = 0;
    for (const bt of bankTxs) {
      actualBankCredits += Number(bt.amount);
      if (!bt.reconciled) bankUnreconciledCount += 1;
    }
    if (actualBankCredits === 0) actualBankCredits = systemBankCollected;

    // UPI Settlements
    const upiSettlements = await db.uPISettlement.findMany({
      where: {
        collectionDate: { gte: startOfDay, lte: endOfDay },
      },
    });

    let actualUpiSettled = 0;
    let upiCharges = 0;
    let upiPendingCount = 0;
    for (const us of upiSettlements) {
      actualUpiSettled += Number(us.settlementAmount || us.collectedAmount);
      upiCharges += Number(us.chargesAmount || 0);
      if (us.status === "PENDING") upiPendingCount += 1;
    }
    if (actualUpiSettled === 0) actualUpiSettled = systemUpiCollected;

    // ──────────────────────── 4. MATCH DELTA & TRIANGULATION ────────────────────────
    const cashVariance = actualCashCounted - systemCashCollected;
    const bankVariance = actualBankCredits - systemBankCollected;
    const upiVariance = actualUpiSettled - (systemUpiCollected - upiCharges);
    const totalVariance = Math.abs(cashVariance) + Math.abs(bankVariance) + Math.abs(upiVariance);
    const isMatched = totalVariance < 0.05;

    // ──────────────────────── 5. UNRECONCILED DISCREPANCY ITEMS ────────────────────────
    const unreconciledItems: any[] = [];

    // Check bank transactions unreconciled
    for (const bt of bankTxs) {
      if (!bt.reconciled) {
        unreconciledItems.push({
          id: bt.id,
          source: "BANK",
          type: bt.type,
          partyName: bt.partyName || "Unidentified Bank Deposit",
          referenceNo: bt.utrReference || "Missing UTR",
          amount: Number(bt.amount),
          expectedAmount: Number(bt.amount),
          difference: Number(bt.amount),
          issue: "Bank statement deposit not mapped to any Sales Order or Receipt Voucher",
          status: "INVESTIGATING",
          createdAt: bt.createdAt.toISOString(),
        });
      }
    }

    // Check cash session discrepancies
    if (Math.abs(cashDifference) > 0.01) {
      unreconciledItems.push({
        id: cashSessions[0]?.id || `cash-${dateParam}`,
        source: "CASH_DRAWER",
        type: "CASH_VARIANCE",
        partyName: "Till / Cashier Drawer",
        referenceNo: `SES-${dateParam}`,
        amount: actualCashCounted,
        expectedAmount: systemCashCollected,
        difference: cashDifference,
        issue: cashDifference < 0 ? `Cash shortage of ₹${Math.abs(cashDifference)}` : `Cash excess of ₹${cashDifference}`,
        status: "INVESTIGATING",
        createdAt: new Date().toISOString(),
      });
    }

    // Check UPI settlements pending or discrepancies
    for (const us of upiSettlements) {
      if (us.status === "DISCREPANCY" || us.status === "PENDING") {
        unreconciledItems.push({
          id: us.id,
          source: "UPI",
          type: "UPI_SETTLEMENT",
          partyName: `Order ${us.orderNumber || "UPI QR"}`,
          referenceNo: us.transactionId,
          amount: Number(us.settlementAmount || us.collectedAmount),
          expectedAmount: Number(us.collectedAmount),
          difference: Number(us.chargesAmount || 0),
          issue: us.status === "PENDING" ? "Awaiting gateway T+1 batch settlement" : "Gateway fee deduction mismatch",
          status: "INVESTIGATING",
          createdAt: us.createdAt.toISOString(),
        });
      }
    }

    return NextResponse.json({
      businessDate: dateParam,
      userRole: session.role,
      isMatched,
      triangulation: {
        systemSales: {
          grossSales: systemGrossSales,
          invoicedSales: systemInvoicedSales,
          orderCount,
          outstandingDue: systemOutstandingDue,
        },
        systemPayments: {
          totalCollected: systemTotalCollected,
          cash: systemCashCollected,
          bank: systemBankCollected,
          upi: systemUpiCollected,
          cheque: systemChequeCollected,
          creditSales: systemCreditSales,
        },
        actualStatements: {
          cashCounted: actualCashCounted,
          cashSessionStatus,
          bankCredits: actualBankCredits,
          upiSettled: actualUpiSettled,
          upiCharges,
        },
        variances: {
          cashVariance,
          bankVariance,
          upiVariance,
          totalVariance,
        },
      },
      unreconciledItems,
      recentTransactions: paymentTxs.slice(0, 30).map((t) => ({
        id: t.id,
        orderNumber: t.payment?.bill?.order?.orderNumber || "—",
        customerName: t.payment?.bill?.order?.customer?.shopName || "Walk-in",
        amount: Number(t.amount),
        method: t.method,
        referenceNo: t.upiReference || t.bankReference || t.chequeNumber || null,
        recordedBy: t.recordedByUser?.name || "Staff",
        timestamp: t.timestamp.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load reconciliation data" }, { status: 500 });
  }
}

// POST Handler for Resolving & Approving Reconciliation Discrepancies
const resolveSchema = z.object({
  action: z.enum(["RESOLVE_DISCREPANCY", "APPROVE_DAILY_RECONCILIATION"]),
  // RESOLVE fields
  itemId: z.string().optional(),
  source: z.enum(["BANK", "CASH_DRAWER", "UPI", "CHEQUE"]).optional(),
  resolutionType: z.enum([
    "BANK_CHARGES_WRITE_OFF",
    "MANUAL_LEDGER_ADJUSTMENT",
    "TIMING_DIFFERENCE",
    "CASH_SHORTAGE_RECOVERY",
    "RECONCILED_MATCH",
  ]).optional(),
  resolutionNotes: z.string().optional(),
  // APPROVE fields
  businessDate: z.string().optional(),
  closingNotes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const parsed = resolveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;

  try {
    // ──────────────────────── 1. RESOLVE UNRECONCILED DISCREPANCY ────────────────────────
    if (data.action === "RESOLVE_DISCREPANCY") {
      if (!data.itemId || !data.resolutionType) {
        return NextResponse.json({ error: "itemId and resolutionType are required" }, { status: 400 });
      }

      if (data.source === "BANK") {
        await db.bankTransaction.update({
          where: { id: data.itemId },
          data: {
            reconciled: true,
            notes: data.resolutionNotes ? `Reconciled: ${data.resolutionNotes}` : "Reconciled with sales ledger",
          },
        });
      } else if (data.source === "UPI") {
        await db.uPISettlement.update({
          where: { id: data.itemId },
          data: {
            status: "SETTLED",
            notes: data.resolutionNotes ? `Resolved: ${data.resolutionNotes}` : "Settled and verified",
          },
        });
      } else if (data.source === "CASH_DRAWER") {
        // If cash session
        const sess = await db.cashSession.findUnique({ where: { id: data.itemId } });
        if (sess) {
          await db.cashSession.update({
            where: { id: data.itemId },
            data: {
              discrepancyReason: data.resolutionNotes || `Resolved via ${data.resolutionType}`,
              status: "CLOSED",
            },
          });
        }
      }

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId || "global",
        action: `RECONCILIATION_RESOLVED_${data.resolutionType}`,
        entityType: "Reconciliation",
        entityId: data.itemId,
        newValue: { resolutionType: data.resolutionType, notes: data.resolutionNotes },
      });

      return NextResponse.json({ success: true, resolutionType: data.resolutionType });
    }

    // ──────────────────────── 2. APPROVE DAILY RECONCILIATION ────────────────────────
    if (data.action === "APPROVE_DAILY_RECONCILIATION") {
      if (session.role !== "ADMIN" && session.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Managers or Admins can approve daily reconciliation" }, { status: 403 });
      }

      const dateStr = data.businessDate || new Date().toISOString().slice(0, 10);

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId || "global",
        action: "DAILY_FINANCE_RECONCILIATION_APPROVED",
        entityType: "DailyReconciliation",
        entityId: dateStr,
        newValue: { businessDate: dateStr, approvedBy: session.sub, notes: data.closingNotes },
      });

      return NextResponse.json({ success: true, approvedDate: dateStr, status: "APPROVED" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process reconciliation action" }, { status: 500 });
  }
}
