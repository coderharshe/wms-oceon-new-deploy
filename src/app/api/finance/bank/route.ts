import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";

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

const DEFAULT_ACCOUNTS: BankAccountConfig[] = [
  {
    id: "hdfc-current",
    name: "HDFC Current",
    bankName: "HDFC Bank",
    accountNumber: "50200088991122",
    ifsc: "HDFC0001234",
    branch: "Main Corporate Branch",
    accountType: "CURRENT",
    openingBalance: 250000,
    openingDate: "2026-04-01",
    isDefault: true,
    active: true,
  },
  {
    id: "sbi-current",
    name: "SBI Current",
    bankName: "State Bank of India",
    accountNumber: "38912345678",
    ifsc: "SBIN0004321",
    branch: "Commercial Branch",
    accountType: "CURRENT",
    openingBalance: 120000,
    openingDate: "2026-04-01",
    isDefault: false,
    active: true,
  },
  {
    id: "other-bank",
    name: "Other Bank",
    bankName: "ICICI / Axis Bank",
    accountNumber: "987654321098",
    ifsc: "ICIC0009876",
    branch: "Industrial Branch",
    accountType: "CURRENT",
    openingBalance: 50000,
    openingDate: "2026-04-01",
    isDefault: false,
    active: true,
  },
];

async function getBankAccountsConfig(): Promise<BankAccountConfig[]> {
  try {
    const raw = await getSetting("BANK_ACCOUNTS_CONFIG");
    if (!raw) {
      await setSetting("BANK_ACCOUNTS_CONFIG", JSON.stringify(DEFAULT_ACCOUNTS));
      return DEFAULT_ACCOUNTS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_ACCOUNTS;
  } catch {
    return DEFAULT_ACCOUNTS;
  }
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const accountId = req.nextUrl.searchParams.get("accountId") || "ALL";

  try {
    const db = getDb();
    const accounts = await getBankAccountsConfig();

    const where: any = {};
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    // Fetch all bank transactions
    const allBankTxs = await db.bankTransaction.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    // Also fetch cash drawer deposits and UPI settlements for reference
    const [cashDeposits, upiSettlements] = await Promise.all([
      db.cashTransaction.findMany({
        where: {
          type: "BANK_DEPOSIT",
          ...(warehouseId && warehouseId !== "all" ? { cashSession: { warehouseId } } : {}),
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
      db.uPISettlement.findMany({
        where: warehouseId && warehouseId !== "all" ? { warehouseId } : {},
        orderBy: { collectionDate: "desc" },
        take: 50,
      }),
    ]);

    // Calculate metrics for each account individually to prevent double counting
    const accountSummaries = accounts.map((acc) => {
      const accNumber = acc.accountNumber?.trim().toLowerCase();
      const accName = acc.name?.trim().toLowerCase();

      // Transactions belonging to this account
      const txs = allBankTxs.filter((t) => {
        const tAcc = t.accountNumber?.trim().toLowerCase();
        const tBank = t.bankName?.trim().toLowerCase();
        if (tAcc && accNumber && tAcc === accNumber) return true;
        if (tBank && (tBank === accName || tBank === acc.bankName?.toLowerCase())) return true;
        return false;
      });

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

    // Consolidated stats across active accounts
    const activeAccounts = accountSummaries.filter((a) => a.active);
    const totalOpeningBalance = activeAccounts.reduce((sum, a) => sum + a.openingBalance, 0);
    const totalDeposits = activeAccounts.reduce((sum, a) => sum + a.deposits, 0);
    const totalWithdrawals = activeAccounts.reduce((sum, a) => sum + a.withdrawals, 0);
    const totalTransfersIn = activeAccounts.reduce((sum, a) => sum + a.transfersIn, 0);
    const totalTransfersOut = activeAccounts.reduce((sum, a) => sum + a.transfersOut, 0);
    const totalBankCharges = activeAccounts.reduce((sum, a) => sum + a.bankCharges, 0);
    const totalCurrentBalance = totalOpeningBalance + totalDeposits + totalTransfersIn - totalWithdrawals - totalTransfersOut - totalBankCharges;
    const totalUnreconciledCount = activeAccounts.reduce((sum, a) => sum + a.unreconciledCount, 0);
    const totalUnreconciledAmount = activeAccounts.reduce((sum, a) => sum + a.unreconciledAmount, 0);

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

      const tx = await db.bankTransaction.create({
        data: {
          warehouseId,
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
