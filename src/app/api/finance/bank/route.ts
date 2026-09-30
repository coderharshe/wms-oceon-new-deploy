import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { resolveDateRange } from "@/lib/date-filter";
import { inTransaction } from "@/lib/cash-db";
import { recordCashMovement, auditQ } from "@/lib/cash";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type BankAccountConfig = {
  id: string;
  name: string; // e.g. "HDFC Current"
  bankName: string; // e.g. "HDFC Bank"
  accountNumber: string; // e.g. "50200088991122"
  ifsc?: string;
  branch?: string;
  accountType: "CURRENT" | "SAVINGS" | "OD_CC";
  openingBalance: number;
  openingDate: string; // YYYY-MM-DD
  isDefault?: boolean;
  active: boolean;
};

async function getBankAccountsConfig(): Promise<BankAccountConfig[]> {
  try {
    const raw = await getSetting("BANK_ACCOUNTS_CONFIG");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((a: any) => a && typeof a === "object" && a.active !== false);
    }
    return [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const accountId = req.nextUrl.searchParams.get("accountId") || "ALL";

  const presetParam = req.nextUrl.searchParams.get("preset");
  const startParam = req.nextUrl.searchParams.get("startDate");
  const endParam = req.nextUrl.searchParams.get("endDate");
  const hasDateFilter = Boolean(presetParam || startParam || endParam);
  const dateRange = resolveDateRange(presetParam, startParam, endParam);

  try {
    const db = getDb();
    const accounts = await getBankAccountsConfig();

    const where: any = {};
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    if (hasDateFilter) {
      where.businessDate = {
        gte: dateRange.startDate,
        lte: dateRange.endDate,
      };
    }

    // Fetch ALL bank transactions — no take cap, required for accurate balance
    const allBankTxs = await db.bankTransaction.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    });

    // Also fetch cash drawer deposits and UPI settlements for reference
    const [cashDeposits, upiSettlements] = await Promise.all([
      db.cashTransaction.findMany({
        where: {
          type: "BANK_DEPOSIT",
          ...(hasDateFilter ? { timestamp: { gte: dateRange.startDate, lte: dateRange.endDate } } : {}),
          ...(warehouseId && warehouseId !== "all" ? { cashSession: { warehouseId } } : {}),
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
      db.uPISettlement.findMany({
        where: {
          ...(hasDateFilter ? { collectionDate: { gte: dateRange.startDate, lte: dateRange.endDate } } : {}),
          ...(warehouseId && warehouseId !== "all" ? { warehouseId } : {}),
        },
        orderBy: { collectionDate: "desc" },
        take: 50,
      }),
    ]);

    // Helper: match a transaction to a configured account
    function matchTxToAccount(t: (typeof allBankTxs)[0], acc: (typeof accounts)[0]): boolean {
      const tAcc = t.accountNumber?.trim().toLowerCase();
      const tBank = t.bankName?.trim().toLowerCase();
      const accNumber = acc.accountNumber?.trim().toLowerCase();
      const accName = acc.name?.trim().toLowerCase();
      const accBankName = acc.bankName?.trim().toLowerCase();
      // Prefer exact account number match over name match (most reliable)
      if (tAcc && accNumber && tAcc === accNumber) return true;
      // Match by configured account name or bank name — only if account number absent
      if (!tAcc && tBank && (tBank === accName || tBank === accBankName)) return true;
      return false;
    }

    // Calculate metrics for each account individually to prevent double counting
    const accountSummaries = accounts.map((acc) => {
      const txs = allBankTxs.filter((t) => matchTxToAccount(t, acc));

      let deposits = 0;
      let withdrawals = 0;
      let transfersIn = 0;
      let transfersOut = 0;
      let bankCharges = 0;
      let unreconciledCount = 0;
      let unreconciledAmount = 0;

      for (const t of txs) {
        const amt = Number(t.amount);
        if (!t.reconciled) {
          unreconciledCount++;
          unreconciledAmount += amt;
        }

        if (t.type === "BANK_CHARGES") {
          bankCharges += amt;
        } else if (t.type === "ADJUSTMENT") {
          if (t.isCredit) transfersIn += amt;
          else transfersOut += amt;
        } else if (t.isCredit) {
          deposits += amt;
        } else {
          withdrawals += amt;
        }
      }

      const openingBal = Number(acc.openingBalance) || 0;
      const currentBalance = openingBal + deposits + transfersIn - withdrawals - transfersOut - bankCharges;

      return {
        ...acc,
        openingBalance: openingBal,
        deposits,
        withdrawals,
        transfersIn,
        transfersOut,
        bankCharges,
        currentBalance,
        unreconciledCount,
        unreconciledAmount,
        transactionCount: txs.length,
      };
    });

    // ── CONSOLIDATED TOTALS ── computed as a SINGLE PASS through ALL transactions
    // This guarantees the consolidated balance = ledger running balance (no double-counting of
    // transactions that match multiple account names, no orphan exclusions).
    const activeAccounts = accountSummaries.filter((a) => a.active);
    const totalOpeningBalance = activeAccounts.reduce((sum, a) => sum + a.openingBalance, 0);

    let consDep = 0, consWit = 0, consTin = 0, consTout = 0, consChrg = 0;
    let consUnrecCount = 0, consUnrecAmt = 0;
    for (const t of allBankTxs) {
      const amt = Number(t.amount);
      if (!t.reconciled) { consUnrecCount++; consUnrecAmt += amt; }
      if (t.type === "BANK_CHARGES") consChrg += amt;
      else if (t.type === "ADJUSTMENT") { if (t.isCredit) consTin += amt; else consTout += amt; }
      else if (t.isCredit) consDep += amt;
      else consWit += amt;
    }

    // totalCurrentBalance = opening + net(all txs) — identical to ledger running balance end value
    const totalCurrentBalance = totalOpeningBalance + consDep + consTin - consWit - consTout - consChrg;
    const totalDeposits = consDep;
    const totalWithdrawals = consWit;
    const totalTransfersIn = consTin;
    const totalTransfersOut = consTout;
    const totalBankCharges = consChrg;
    const totalUnreconciledCount = consUnrecCount;
    const totalUnreconciledAmount = consUnrecAmt;

    // Filter transactions if specific account is selected
    let filteredTxs = allBankTxs;
    let selectedSummary = {
      openingBalance: totalOpeningBalance,
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      transfersIn: totalTransfersIn,
      transfersOut: totalTransfersOut,
      bankCharges: totalBankCharges,
      currentBalance: totalCurrentBalance,
      unreconciledCount: totalUnreconciledCount,
      unreconciledAmount: totalUnreconciledAmount,
    };

    if (accountId !== "ALL") {
      const matchedAcc = accountSummaries.find((a) => a.id === accountId);
      if (matchedAcc) {
        selectedSummary = {
          openingBalance: matchedAcc.openingBalance,
          deposits: matchedAcc.deposits,
          withdrawals: matchedAcc.withdrawals,
          transfersIn: matchedAcc.transfersIn,
          transfersOut: matchedAcc.transfersOut,
          bankCharges: matchedAcc.bankCharges,
          currentBalance: matchedAcc.currentBalance,
          unreconciledCount: matchedAcc.unreconciledCount,
          unreconciledAmount: matchedAcc.unreconciledAmount,
        };

        const accNumber = matchedAcc.accountNumber?.trim().toLowerCase();
        const accName = matchedAcc.name?.trim().toLowerCase();

        filteredTxs = allBankTxs.filter((t) => {
          const tAcc = t.accountNumber?.trim().toLowerCase();
          const tBank = t.bankName?.trim().toLowerCase();
          if (tAcc && accNumber && tAcc === accNumber) return true;
          if (tBank && (tBank === accName || tBank === matchedAcc.bankName?.toLowerCase())) return true;
          return false;
        });
      }
    }

    // Format transaction list with running balance
    let runningBal = selectedSummary.openingBalance;
    // Sort ascending to compute running balances correctly
    const ascending = [...filteredTxs].reverse();
    const enrichedAscending = ascending.map((t) => {
      const amt = Number(t.amount);
      if (t.isCredit) runningBal += amt;
      else runningBal -= amt;

      return {
        id: t.id,
        businessDate: t.businessDate.toISOString().split("T")[0],
        type: t.type,
        amount: amt,
        isCredit: t.isCredit,
        utrReference: t.utrReference,
        bankName: t.bankName,
        accountNumber: t.accountNumber,
        partyName: t.partyName,
        notes: t.notes,
        reconciled: t.reconciled,
        createdAt: t.createdAt.toISOString(),
        runningBalance: runningBal,
      };
    });

    const enrichedTransactions = enrichedAscending.reverse();

    return NextResponse.json({
      accounts: accountSummaries,
      selectedAccountId: accountId,
      summary: selectedSummary,
      transactions: enrichedTransactions,
      drawerDeposits: cashDeposits.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        note: c.note,
        at: c.timestamp.toISOString(),
      })),
      upiSettlements: upiSettlements.map((u) => ({
        id: u.id,
        amount: Number(u.collectedAmount),
        status: u.status,
        note: u.notes,
        at: u.collectionDate.toISOString(),
      })),
      dateRange: {
        preset: dateRange.preset,
        startDateStr: dateRange.startDateStr,
        endDateStr: dateRange.endDateStr,
        label: dateRange.label,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load bank data" }, { status: 500 });
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
    // 1. ADD NEW BANK ACCOUNT
    if (body.action === "ADD_ACCOUNT") {
      const { name, bankName, accountNumber, ifsc, branch, accountType, openingBalance, openingDate } = body;
      if (!name || !accountNumber) {
        return NextResponse.json({ error: "Account Name and Account Number are required" }, { status: 400 });
      }

      const existingAccounts = await getBankAccountsConfig();
      const newAcc: BankAccountConfig = {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString().slice(-4),
        name: name.trim(),
        bankName: bankName?.trim() || name.trim(),
        accountNumber: accountNumber.trim(),
        ifsc: ifsc?.trim(),
        branch: branch?.trim(),
        accountType: accountType || "CURRENT",
        openingBalance: Number(openingBalance) || 0,
        openingDate: openingDate || new Date().toISOString().split("T")[0],
        active: true,
      };

      const updated = [...existingAccounts, newAcc];
      await setSetting("BANK_ACCOUNTS_CONFIG", JSON.stringify(updated));
      return NextResponse.json({ success: true, account: newAcc });
    }

    // 2. UPDATE BANK ACCOUNT
    if (body.action === "UPDATE_ACCOUNT") {
      const { id, name, bankName, accountNumber, ifsc, branch, accountType, openingBalance, openingDate, active } = body;
      const existingAccounts = await getBankAccountsConfig();
      const updated = existingAccounts.map((a) =>
        a.id === id
          ? {
              ...a,
              name: name !== undefined ? name.trim() : a.name,
              bankName: bankName !== undefined ? bankName.trim() : a.bankName,
              accountNumber: accountNumber !== undefined ? accountNumber.trim() : a.accountNumber,
              ifsc: ifsc !== undefined ? ifsc.trim() : a.ifsc,
              branch: branch !== undefined ? branch.trim() : a.branch,
              accountType: accountType || a.accountType,
              openingBalance: openingBalance !== undefined ? Number(openingBalance) : a.openingBalance,
              openingDate: openingDate || a.openingDate,
              active: active !== undefined ? Boolean(active) : a.active,
            }
          : a
      );
      await setSetting("BANK_ACCOUNTS_CONFIG", JSON.stringify(updated));
      return NextResponse.json({ success: true, accounts: updated });
    }

    // 3. DELETE BANK ACCOUNT
    if (body.action === "DELETE_ACCOUNT") {
      const { id } = body;
      const existingAccounts = await getBankAccountsConfig();
      const updated = existingAccounts.filter((a) => a.id !== id);
      await setSetting("BANK_ACCOUNTS_CONFIG", JSON.stringify(updated));
      return NextResponse.json({ success: true, accounts: updated });
    }

    // 4. RECORD INDIVIDUAL BANK TRANSACTION
    if (body.action === "RECORD_TRANSACTION") {
      const { businessDate, type, amount, isCredit, utrReference, bankName, accountNumber, partyName, notes, reconciled } = body;
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: "Valid amount is required" }, { status: 400 });
      }

      let resolvedWhId = warehouseId;
      if (!resolvedWhId || resolvedWhId === "none" || resolvedWhId === "default") {
        if (session.warehouseId) {
          resolvedWhId = session.warehouseId;
        } else {
          const u = await db.user.findUnique({ where: { id: session.sub }, select: { warehouseId: true } });
          if (u?.warehouseId) {
            resolvedWhId = u.warehouseId;
          } else {
            const firstWh = await db.warehouse.findFirst({ where: { active: true } });
            resolvedWhId = firstWh?.id || "default";
          }
        }
      }

      const tx = await db.bankTransaction.create({
        data: {
          warehouseId: resolvedWhId !== "default" ? resolvedWhId : warehouseId,
          businessDate: businessDate ? new Date(businessDate) : new Date(),
          type: type || "DIRECT_DEPOSIT",
          amount: Number(amount),
          isCredit: isCredit !== undefined ? Boolean(isCredit) : true,
          utrReference: utrReference || null,
          bankName: bankName || null,
          accountNumber: accountNumber || null,
          partyName: partyName || null,
          notes: notes || null,
          reconciled: reconciled !== undefined ? Boolean(reconciled) : true,
          recordedByUserId: session.sub,
        },
      });

      // If this transaction is a CASH DEPOSIT from drawer to bank (DIRECT_DEPOSIT or CASH_DEPOSIT with isCredit=true),
      // automatically record a BANK_DEPOSIT cash movement to reduce the cash in drawer!
      if ((type === "DIRECT_DEPOSIT" || type === "CASH_DEPOSIT") && (isCredit === true || isCredit === undefined)) {
        try {
          if (resolvedWhId && resolvedWhId !== "default" && resolvedWhId !== "none") {
            await inTransaction(async (q) => {
              const depositNote = notes || `Cash deposit to ${bankName || "Bank"}${accountNumber ? ` (${accountNumber})` : ""}`;
              const cashRow = await recordCashMovement(q, {
                warehouseId: resolvedWhId,
                userId: session.sub,
                type: "BANK_DEPOSIT",
                amount: Number(amount),
                note: depositNote,
                referenceId: tx.id,
              });
              await auditQ(q, {
                userId: session.sub,
                role: session.role,
                warehouseId: resolvedWhId,
                action: "CASH_TRANSACTION_RECORDED",
                entityType: "CashTransaction",
                entityId: cashRow.id,
                newValue: { type: "BANK_DEPOSIT", amount: Number(amount), bankTransactionId: tx.id },
                reason: depositNote,
              });
            });
          }
        } catch (cashErr) {
          console.error("Failed to automatically decrease cash drawer for bank deposit:", cashErr);
        }
      }

      return NextResponse.json({ success: true, transaction: tx });
    }

    // 5. INTER-BANK ACCOUNT TRANSFER
    if (body.action === "INTER_BANK_TRANSFER") {
      const { fromAccount, toAccount, amount, transferDate, referenceNo, notes } = body;
      if (!fromAccount || !toAccount || fromAccount === toAccount) {
        return NextResponse.json({ error: "Source and destination accounts must be distinct" }, { status: 400 });
      }
      if (!amount || Number(amount) <= 0) {
        return NextResponse.json({ error: "Valid transfer amount is required" }, { status: 400 });
      }

      const accounts = await getBankAccountsConfig();
      const srcAcc = accounts.find((a) => a.id === fromAccount || a.name === fromAccount);
      const destAcc = accounts.find((a) => a.id === toAccount || a.name === toAccount);

      const bDate = transferDate ? new Date(transferDate) : new Date();

      // Create Outflow from source account
      const outTx = await db.bankTransaction.create({
        data: {
          warehouseId,
          businessDate: bDate,
          type: "ADJUSTMENT",
          amount: Number(amount),
          isCredit: false,
          utrReference: referenceNo || null,
          bankName: srcAcc?.name || fromAccount,
          accountNumber: srcAcc?.accountNumber || null,
          partyName: `Transfer to ${destAcc?.name || toAccount}`,
          notes: notes || `Inter-bank transfer to ${destAcc?.name || toAccount}`,
          reconciled: true,
          recordedByUserId: session.sub,
        },
      });

      // Create Inflow to destination account
      const inTx = await db.bankTransaction.create({
        data: {
          warehouseId,
          businessDate: bDate,
          type: "ADJUSTMENT",
          amount: Number(amount),
          isCredit: true,
          utrReference: referenceNo || null,
          bankName: destAcc?.name || toAccount,
          accountNumber: destAcc?.accountNumber || null,
          partyName: `Transfer from ${srcAcc?.name || fromAccount}`,
          notes: notes || `Inter-bank transfer from ${srcAcc?.name || fromAccount}`,
          reconciled: true,
          recordedByUserId: session.sub,
        },
      });

      return NextResponse.json({ success: true, transferOut: outTx, transferIn: inTx });
    }

    // 6. TOGGLE RECONCILE STATUS
    if (body.action === "TOGGLE_RECONCILE") {
      const { id, reconciled } = body;
      const tx = await db.bankTransaction.update({
        where: { id },
        data: { reconciled: Boolean(reconciled) },
      });
      return NextResponse.json({ success: true, transaction: tx });
    }

    // 7. STATEMENT BULK IMPORT
    if (body.action === "IMPORT_STATEMENT") {
      const { bankAccountId, items } = body;
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: "No statement items provided" }, { status: 400 });
      }

      const accounts = await getBankAccountsConfig();
      const targetAcc = accounts.find((a) => a.id === bankAccountId);

      const createdTxs = [];
      for (const it of items) {
        if (!it.amount || Number(it.amount) <= 0) continue;
        const tx = await db.bankTransaction.create({
          data: {
            warehouseId,
            businessDate: it.date ? new Date(it.date) : new Date(),
            type: it.type || (it.isCredit ? "CUSTOMER_TRANSFER" : "EXPENSE_PAYOUT"),
            amount: Number(it.amount),
            isCredit: Boolean(it.isCredit),
            utrReference: it.reference || null,
            bankName: targetAcc?.name || null,
            accountNumber: targetAcc?.accountNumber || null,
            partyName: it.partyName || null,
            notes: it.notes || it.description || "Statement Import",
            reconciled: it.reconciled !== undefined ? Boolean(it.reconciled) : true,
            recordedByUserId: session.sub,
          },
        });
        createdTxs.push(tx);
      }

      return NextResponse.json({ success: true, importedCount: createdTxs.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process bank operation" }, { status: 500 });
  }
}
