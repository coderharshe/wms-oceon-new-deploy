import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";

export type UpiAccountConfig = {
  id: string;
  name: string; // e.g. "PhonePe Merchant QR", "Paytm Soundbox"
  vpa: string; // e.g. "oceanhub@ybl"
  provider: "PHONEPE" | "PAYTM" | "BHARATPE" | "GOOGLEPAY" | "RAZORPAY" | "OTHER";
  linkedBankAccountId?: string; // Target Bank Account ID (e.g. "hdfc-current")
  linkedBankName?: string; // e.g. "HDFC Current"
  mdrPercent?: number; // e.g. 0% for UPI, 1.5% for cards
  active: boolean;
};

const DEFAULT_UPI_ACCOUNTS: UpiAccountConfig[] = [
  {
    id: "phonepe-qr-01",
    name: "PhonePe Smart QR",
    vpa: "oceanwms@ybl",
    provider: "PHONEPE",
    linkedBankAccountId: "hdfc-current",
    linkedBankName: "HDFC Current",
    mdrPercent: 0,
    active: true,
  },
  {
    id: "paytm-soundbox-01",
    name: "Paytm Soundbox QR",
    vpa: "oceanwms@paytm",
    provider: "PAYTM",
    linkedBankAccountId: "sbi-current",
    linkedBankName: "SBI Current",
    mdrPercent: 0,
    active: true,
  },
  {
    id: "razorpay-online-01",
    name: "Razorpay Gateway & Links",
    vpa: "rzp.oceanwms@icici",
    provider: "RAZORPAY",
    linkedBankAccountId: "hdfc-current",
    linkedBankName: "HDFC Current",
    mdrPercent: 1.5,
    active: true,
  },
];

async function getUpiAccountsConfig(): Promise<UpiAccountConfig[]> {
  try {
    const raw = await getSetting("UPI_ACCOUNTS_CONFIG");
    if (!raw) {
      await setSetting("UPI_ACCOUNTS_CONFIG", JSON.stringify(DEFAULT_UPI_ACCOUNTS));
      return DEFAULT_UPI_ACCOUNTS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_UPI_ACCOUNTS;
  } catch {
    return DEFAULT_UPI_ACCOUNTS;
  }
}

import { resolveDateRange, type DateRangePreset } from "@/lib/date-filter";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const upiAccountId = req.nextUrl.searchParams.get("upiAccountId") || "ALL";

  const preset = (req.nextUrl.searchParams.get("preset") as DateRangePreset) || "today";
  const customStart = req.nextUrl.searchParams.get("startDate");
  const customEnd = req.nextUrl.searchParams.get("endDate");

  const dateRange = resolveDateRange(preset, customStart, customEnd);

  try {
    const db = getDb();
    const upiAccounts = await getUpiAccountsConfig();

    const where: any = {
      collectionDate: {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
      },
    };
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    // 1. Fetch settlements
    const settlements = await db.uPISettlement.findMany({
      where,
      orderBy: { collectionDate: "desc" },
      take: 200,
    });

    // 2. Fetch live UPI PaymentTransactions from billing
    const paymentTxs = await db.paymentTransaction.findMany({
      where: {
        method: "UPI",
        status: "CONFIRMED",
        timestamp: {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        },
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
                    customer: { select: { shopName: true, mobile: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    // Merge transactions into unified UPI digital ledger
    const settlementMap = new Map<string, typeof settlements[0]>();
    for (const s of settlements) {
      if (s.transactionId) settlementMap.set(s.transactionId, s);
      if (s.orderNumber) settlementMap.set(s.orderNumber, s);
    }

    let totalGrossCollected = 0;
    let totalGrossRefunded = 0;
    let totalSettledToBank = 0;
    let totalChargesDeducted = 0;
    let pendingCount = 0;
    let settledCount = 0;
    let discrepancyCount = 0;

    const enrichedEntries = paymentTxs.map((pt) => {
      const amt = Number(pt.amount);
      const isRefund = pt.type === "REFUND";
      const order = pt.payment?.bill?.order;
      const orderNo = order?.orderNumber || "DIRECT-UPI";
      const customerName = order?.customer?.shopName || "Counter Customer";
      const rrn = pt.upiReference || pt.id.slice(-8);

      const matchedSettlement = settlementMap.get(rrn) || settlementMap.get(orderNo) || settlementMap.get(pt.id);

      let status: "PENDING" | "SETTLED" | "DISCREPANCY" | "REFUNDED" = "PENDING";
      let settledAmount = 0;
      let chargesAmount = 0;
      let settlementDate = null;
      let settlementUtr = null;

      if (isRefund) {
        status = "REFUNDED";
        totalGrossRefunded += amt;
      } else if (matchedSettlement) {
        status = matchedSettlement.status as any;
        settledAmount = Number(matchedSettlement.settlementAmount || 0);
        chargesAmount = Number(matchedSettlement.chargesAmount || 0);
        settlementDate = matchedSettlement.settlementDate ? matchedSettlement.settlementDate.toISOString().split("T")[0] : null;
        settlementUtr = matchedSettlement.notes;

        totalGrossCollected += amt;
        totalSettledToBank += settledAmount;
        totalChargesDeducted += chargesAmount;

        if (status === "SETTLED") settledCount++;
        else if (status === "DISCREPANCY") discrepancyCount++;
        else pendingCount++;
      } else {
        totalGrossCollected += amt;
        pendingCount++;
      }

      return {
        id: pt.id,
        settlementId: matchedSettlement?.id || null,
        transactionId: rrn,
        orderNumber: orderNo,
        customerName,
        collectionDate: pt.timestamp.toISOString(),
        collectedAmount: amt,
        isRefund,
        settledAmount,
        chargesAmount,
        settlementDate,
        settlementUtr,
        status,
        upiAccount: pt.notes || "Default Counter UPI",
      };
    });

    const pendingInTransit = Math.max(0, totalGrossCollected - totalGrossRefunded - (totalSettledToBank + totalChargesDeducted));

    return NextResponse.json({
      upiAccounts,
      selectedUpiAccountId: upiAccountId,
      summary: {
        totalGrossCollected,
        totalGrossRefunded,
        totalSettledToBank,
        totalChargesDeducted,
        pendingInTransit,
        totalTransactions: enrichedEntries.length,
        pendingCount,
        settledCount,
        discrepancyCount,
      },
      entries: enrichedEntries,
      dateFilter: {
        preset: dateRange.preset,
        startDateStr: dateRange.startDateStr,
        endDateStr: dateRange.endDateStr,
        label: dateRange.label,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load UPI management data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body || !body.action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  const warehouseId = session.role === "ADMIN" ? body.warehouseId || session.warehouseId || "default" : session.warehouseId!;

  try {
    // 1. ADD / UPDATE UPI ACCOUNT
    if (body.action === "SAVE_UPI_ACCOUNT") {
      const { id, name, vpa, provider, linkedBankAccountId, linkedBankName, mdrPercent, active } = body;
      if (!name || !vpa) {
        return NextResponse.json({ error: "Account Name and UPI VPA are required" }, { status: 400 });
      }

      const existingAccounts = await getUpiAccountsConfig();
      const accId = id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString().slice(-4);

      const updated = existingAccounts.some((a) => a.id === accId)
        ? existingAccounts.map((a) =>
            a.id === accId
              ? {
                  ...a,
                  name: name.trim(),
                  vpa: vpa.trim(),
                  provider: provider || a.provider,
                  linkedBankAccountId: linkedBankAccountId || a.linkedBankAccountId,
                  linkedBankName: linkedBankName || a.linkedBankName,
                  mdrPercent: mdrPercent !== undefined ? Number(mdrPercent) : a.mdrPercent,
                  active: active !== undefined ? Boolean(active) : a.active,
                }
              : a
          )
        : [
            ...existingAccounts,
            {
              id: accId,
              name: name.trim(),
              vpa: vpa.trim(),
              provider: provider || "PHONEPE",
              linkedBankAccountId,
              linkedBankName,
              mdrPercent: Number(mdrPercent) || 0,
              active: true,
            },
          ];

      await setSetting("UPI_ACCOUNTS_CONFIG", JSON.stringify(updated));
      return NextResponse.json({ success: true, accounts: updated });
    }

    // 2. SETTLE SINGLE / BATCH UPI TRANSACTIONS INTO BANK
    if (body.action === "SETTLE_TRANSACTIONS") {
      const { items, settlementDate, settlementBankName, settlementBankAcc, batchUtr, chargesAmount, notes } = body;
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: "No transactions selected for settlement" }, { status: 400 });
      }

      const sDate = settlementDate ? new Date(settlementDate) : new Date();
      let totalCollected = 0;
      const charges = Number(chargesAmount) || 0;

      for (const it of items) {
        totalCollected += Number(it.collectedAmount);
      }

      const netSettled = Math.max(0, totalCollected - charges);

      // Create / update UPISettlement records
      for (const it of items) {
        const itemAmt = Number(it.collectedAmount);
        const itemCharge = totalCollected > 0 ? (itemAmt / totalCollected) * charges : 0;
        const itemSettled = itemAmt - itemCharge;

        if (it.settlementId) {
          await db.uPISettlement.update({
            where: { id: it.settlementId },
            data: {
              settlementDate: sDate,
              settlementAmount: itemSettled,
              chargesAmount: itemCharge,
              status: "SETTLED",
              notes: batchUtr || notes || "Settled into " + (settlementBankName || "Bank"),
            },
          });
        } else {
          await db.uPISettlement.create({
            data: {
              warehouseId,
              transactionId: it.transactionId || crypto.randomUUID(),
              orderNumber: it.orderNumber || null,
              collectionDate: it.collectionDate ? new Date(it.collectionDate) : new Date(),
              settlementDate: sDate,
              collectedAmount: itemAmt,
              settlementAmount: itemSettled,
              chargesAmount: itemCharge,
              status: "SETTLED",
              notes: batchUtr || notes || "Settled into " + (settlementBankName || "Bank"),
            },
          });
        }
      }

      // Automatically post a BankTransaction to the linked bank account so the bank ledger reflects this settlement!
      if (settlementBankName || settlementBankAcc) {
        await db.bankTransaction.create({
          data: {
            warehouseId,
            businessDate: sDate,
            type: "UPI_COLLECTION",
            amount: netSettled,
            isCredit: true,
            utrReference: batchUtr || null,
            bankName: settlementBankName || null,
            accountNumber: settlementBankAcc || null,
            partyName: `UPI Batch Settlement (${items.length} txs)`,
            notes: notes || `UPI Settlement net ₹${netSettled.toFixed(2)} (Gross ₹${totalCollected.toFixed(2)} - Charges ₹${charges.toFixed(2)})`,
            reconciled: true,
            recordedByUserId: session.sub,
          },
        });
      }

      return NextResponse.json({ success: true, settledCount: items.length, netSettled });
    }

    // 3. FLAG DISCREPANCY
    if (body.action === "FLAG_DISCREPANCY") {
      const { transactionId, orderNumber, reason, expectedAmount, actualSettled } = body;
      const discrepancy = await db.uPISettlement.create({
        data: {
          warehouseId,
          transactionId: transactionId || crypto.randomUUID(),
          orderNumber: orderNumber || null,
          collectionDate: new Date(),
          collectedAmount: Number(expectedAmount) || 0,
          settlementAmount: Number(actualSettled) || 0,
          chargesAmount: 0,
          status: "DISCREPANCY",
          notes: reason || "Discrepancy reported by Finance team",
        },
      });
      return NextResponse.json({ success: true, settlement: discrepancy });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process UPI action" }, { status: 500 });
  }
}
