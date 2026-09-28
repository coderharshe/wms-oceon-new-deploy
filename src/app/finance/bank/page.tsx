"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type BankAccount = {
  id: string;
  name: string;
  bankName: string;
  accountNumber: string;
  ifsc?: string;
  branch?: string;
  accountType: "CURRENT" | "SAVINGS" | "OD_CC";
  openingBalance: number;
  openingDate: string;
  deposits: number;
  withdrawals: number;
  transfersIn: number;
  transfersOut: number;
  bankCharges: number;
  currentBalance: number;
  unreconciledCount: number;
  unreconciledAmount: number;
  transactionCount: number;
  active: boolean;
};

type BankTransaction = {
  id: string;
  businessDate: string;
  type: string;
  amount: number;
  isCredit: boolean;
  utrReference: string | null;
  bankName: string | null;
  accountNumber: string | null;
  partyName: string | null;
  notes: string | null;
  reconciled: boolean;
  createdAt: string;
  runningBalance: number;
};

type BankApiResponse = {
  accounts: BankAccount[];
  selectedAccountId: string;
  summary: {
    openingBalance: number;
    deposits: number;
    withdrawals: number;
    transfersIn: number;
    transfersOut: number;
    bankCharges: number;
    currentBalance: number;
    unreconciledCount: number;
    unreconciledAmount: number;
  };
  transactions: BankTransaction[];
  drawerDeposits: { id: string; amount: number; note: string | null; at: string }[];
  upiSettlements: { id: string; amount: number; status: string; note: string | null; at: string }[];
};

const rs = (x: number | string) => `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BankManagementPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("ALL");
  const queryParam = selectedAccountId !== "ALL" ? `?accountId=${selectedAccountId}` : "";

  const { data, error, loading, reload } = useApiGet<BankApiResponse>(`/api/finance/bank${queryParam}`);

  // Modals state
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Filters
  const [filterType, setFilterType] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Reconciliation statement check
  const [statementBalance, setStatementBalance] = useState<string>("" );

  // Add Account Form
  const [accountForm, setAccountForm] = useState({
    name: "",
    bankName: "",
    accountNumber: "",
    ifsc: "",
    branch: "",
    accountType: "CURRENT",
    openingBalance: "",
    openingDate: new Date().toISOString().split("T")[0],
  });

  // Add Transaction Form
  const [txForm, setTxForm] = useState({
    bankAccountId: "",
    businessDate: new Date().toISOString().split("T")[0],
    type: "CUSTOMER_TRANSFER",
    amount: "",
    isCredit: true,
    utrReference: "",
    partyName: "",
    notes: "",
    reconciled: true,
  });

  // Transfer Form
  const [transferForm, setTransferForm] = useState({
    fromAccount: "",
    toAccount: "",
    amount: "",
    transferDate: new Date().toISOString().split("T")[0],
    referenceNo: "",
    notes: "",
  });

  // Import Statement Form
  const [importTargetAcc, setImportTargetAcc] = useState("");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountForm.name.trim() || !accountForm.accountNumber.trim()) {
      setFormError("Account Name and Account Number are required");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_ACCOUNT",
          ...accountForm,
          openingBalance: Number(accountForm.openingBalance) || 0,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add bank account");

      setShowAddAccountModal(false);
      setAccountForm({
        name: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
        branch: "",
        accountType: "CURRENT",
        openingBalance: "",
        openingDate: new Date().toISOString().split("T")[0],
      });
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error saving account");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setFormError("Valid amount is required");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const targetAcc = data?.accounts.find((a) => a.id === txForm.bankAccountId) || data?.accounts[0];
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RECORD_TRANSACTION",
          businessDate: txForm.businessDate,
          type: txForm.type,
          amount: Number(txForm.amount),
          isCredit: txForm.isCredit,
          utrReference: txForm.utrReference || null,
          bankName: targetAcc?.name || null,
          accountNumber: targetAcc?.accountNumber || null,
          partyName: txForm.partyName || null,
          notes: txForm.notes || null,
          reconciled: txForm.reconciled,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to record transaction");

      setShowAddTxModal(false);
      setTxForm({
        bankAccountId: "",
        businessDate: new Date().toISOString().split("T")[0],
        type: "CUSTOMER_TRANSFER",
        amount: "",
        isCredit: true,
        utrReference: "",
        partyName: "",
        notes: "",
        reconciled: true,
      });
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error saving transaction");
    } finally {
      setSaving(false);
    }
  }

  async function handleInterBankTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferForm.fromAccount || !transferForm.toAccount || transferForm.fromAccount === transferForm.toAccount) {
      setFormError("Please select two distinct accounts");
      return;
    }
    if (!transferForm.amount || Number(transferForm.amount) <= 0) {
      setFormError("Valid transfer amount is required");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "INTER_BANK_TRANSFER",
          ...transferForm,
          amount: Number(transferForm.amount),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to transfer funds");

      setShowTransferModal(false);
      setTransferForm({
        fromAccount: "",
        toAccount: "",
        amount: "",
        transferDate: new Date().toISOString().split("T")[0],
        referenceNo: "",
        notes: "",
      });
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error transferring funds");
    } finally {
      setSaving(false);
    }
  }

  async function toggleReconcile(txId: string, currentStatus: boolean) {
    try {
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TOGGLE_RECONCILE",
          id: txId,
          reconciled: !currentStatus,
        }),
      });
      if (res.ok) reload();
    } catch {}
  }

  function parseStatementText(text: string) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: any[] = [];

    for (const line of lines) {
      const parts = line.split(/[,\t|]/).map((p) => p.trim());
      if (parts.length >= 3) {
        const date = parts[0] || "";
        const desc = parts[1] || "";
        const lastPart = parts[parts.length - 1] || "";
        const rawAmt = lastPart.replace(/[^0-9.-]/g, "") || "0";
        const amt = Math.abs(parseFloat(rawAmt) || 0);

        if (amt > 0) {
          const isCredit = !line.toLowerCase().includes("dr") && !line.toLowerCase().includes("debit") && !rawAmt.startsWith("-");
          const refPart = parts[2] || "";
          parsed.push({
            date: date || new Date().toISOString().split("T")[0],
            description: desc,
            partyName: desc,
            amount: amt,
            isCredit,
            reference: refPart.length > 4 ? refPart : `IMP-${Date.now().toString().slice(-4)}`,
            reconciled: true,
          });
        }
      }
    }
    setImportPreview(parsed);
  }

  async function handleBulkImport() {
    if (!importTargetAcc || importPreview.length === 0) {
      setFormError("Select a bank account and provide valid entries");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "IMPORT_STATEMENT",
          bankAccountId: importTargetAcc,
          items: importPreview,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to import statement");

      setShowImportModal(false);
      setImportText("");
      setImportPreview([]);
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error importing statement");
    } finally {
      setSaving(false);
    }
  }

  function exportCSV() {
    if (!data) return;
    const rows = [
      ["Date", "Bank Account", "Type", "Ref/UTR", "Party / Narration", "Inflow (+)", "Outflow (-)", "Running Balance", "Reconciled"],
      ...data.transactions.map((t) => [
        t.businessDate,
        t.bankName || "Main Account",
        t.type,
        t.utrReference || "",
        t.partyName || t.notes || "",
        t.isCredit ? String(t.amount) : "0",
        !t.isCredit ? String(t.amount) : "0",
        String(t.runningBalance),
        t.reconciled ? "YES" : "NO",
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map((x) => `"${x}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `bank_ledger_${selectedAccountId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading && !data) {
    return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  }

  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const s = data.summary;
  const currentAccount = data.accounts.find((a) => a.id === selectedAccountId);

  const filteredTransactions = data.transactions.filter((tx) => {
    if (filterType === "DEPOSITS" && !tx.isCredit) return false;
    if (filterType === "WITHDRAWALS" && tx.isCredit) return false;
    if (filterType === "TRANSFERS" && tx.type !== "ADJUSTMENT") return false;
    if (filterType === "CHARGES" && tx.type !== "BANK_CHARGES") return false;
    if (filterType === "UNRECONCILED" && tx.reconciled) return false;
    if (filterType === "RECONCILED" && !tx.reconciled) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchParty = tx.partyName?.toLowerCase().includes(q);
      const matchUtr = tx.utrReference?.toLowerCase().includes(q);
      const matchNotes = tx.notes?.toLowerCase().includes(q);
      const matchBank = tx.bankName?.toLowerCase().includes(q);
      return matchParty || matchUtr || matchNotes || matchBank;
    }
    return true;
  });

  const parsedStatementBal = parseFloat(statementBalance) || 0;
  const reconDifference = statementBalance ? parsedStatementBal - s.currentBalance : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-ink">Bank Management & Reconciliation</h1>
            <span className="badge bg-primary/10 text-primary font-bold">Multi-Bank Engine</span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Individual Bank Accounts, Flow Breakdown, Inter-Bank Transfers, Statement Import & Live Reconciliation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowTransferModal(true)} className="btn text-xs font-semibold">
            ⇄ Inter-Bank Transfer
          </button>
          <button onClick={() => setShowImportModal(true)} className="btn text-xs font-semibold">
            📥 Import Statement
          </button>
          <button onClick={() => setShowAddTxModal(true)} className="btn btn-primary text-xs font-semibold">
            + Record Transaction
          </button>
          <button onClick={exportCSV} className="btn text-xs font-semibold" title="Export CSV">
            📊 Export CSV
          </button>
        </div>
      </div>

      {/* ── CUSTOM BANK ACCOUNTS SELECTOR BAR ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface p-2 rounded border border-line">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted uppercase mr-1">Bank Accounts:</span>
          <button
            onClick={() => setSelectedAccountId("ALL")}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              selectedAccountId === "ALL" ? "bg-accent text-white shadow-sm" : "bg-paper border border-line text-ink hover:bg-surface-hi"
            }`}
          >
            🏛️ All Consolidated ({rs(data.accounts.reduce((sum, a) => sum + a.currentBalance, 0))})
          </button>

          {data.accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setSelectedAccountId(acc.id)}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1.5 ${
                selectedAccountId === acc.id
                  ? "bg-accent text-white shadow-sm"
                  : "bg-paper border border-line text-ink hover:bg-surface-hi"
              }`}
            >
              <span>{acc.name}</span>
              <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${selectedAccountId === acc.id ? "bg-white/20 text-white" : "bg-surface text-muted"}`}>
                {rs(acc.currentBalance)}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowAddAccountModal(true)}
          className="btn text-xs font-bold text-accent hover:bg-accent/10 border-dashed border-accent/40"
        >
          + Add Bank Account
        </button>
      </div>

      {/* ── ACCOUNT SUMMARY & FORMULA BREAKDOWN (NO DOUBLE-COUNTING) ── */}
      <section className="card space-y-4 border-l-4 border-l-primary">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-ink uppercase tracking-tight">
                {currentAccount ? `Account Ledger: ${currentAccount.name} (${currentAccount.accountNumber})` : "Consolidated Bank Ledger Formula"}
              </h2>
              {currentAccount && (
                <span className="badge bg-surface-hi text-[10px]">{currentAccount.bankName} · {currentAccount.accountType}</span>
              )}
            </div>
            <p className="text-[11px] text-muted">
              Opening balance is anchored to opening date and not double-counted with historical transactions
            </p>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-muted block">Current Bank Ledger Balance</span>
            <span className="text-xl font-black text-primary font-mono">{rs(s.currentBalance)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-muted text-[11px] block">1. Opening Balance</span>
            <span className="text-sm font-black text-ink font-mono mt-1 block">{rs(s.openingBalance)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Baseline Anchor</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-good text-[11px] font-semibold block">+ 2. Deposits</span>
            <span className="text-sm font-black text-good font-mono mt-1 block">+{rs(s.deposits)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Cash, NEFT, UPI</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-good text-[11px] font-semibold block">+ 3. Transfers In</span>
            <span className="text-sm font-black text-good font-mono mt-1 block">+{rs(s.transfersIn)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Inter-Bank Inflow</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-bad text-[11px] font-semibold block">− 4. Withdrawals</span>
            <span className="text-sm font-black text-bad font-mono mt-1 block">−{rs(s.withdrawals)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Suppliers, Payouts</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-bad text-[11px] font-semibold block">− 5. Transfers Out</span>
            <span className="text-sm font-black text-bad font-mono mt-1 block">−{rs(s.transfersOut)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Inter-Bank Outflow</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-bad text-[11px] font-semibold block">− 6. Bank Charges</span>
            <span className="text-sm font-black text-bad font-mono mt-1 block">−{rs(s.bankCharges)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Bank Fees & Interest</span>
          </div>
        </div>

        <div className="bg-surface-hi p-2 rounded border border-line flex flex-wrap justify-between items-center text-xs font-semibold">
          <span>
            🧮 Formula: Opening ({rs(s.openingBalance)}) + Deposits ({rs(s.deposits)}) + Transfers In ({rs(s.transfersIn)}) − Withdrawals ({rs(s.withdrawals)}) − Transfers Out ({rs(s.transfersOut)}) − Charges ({rs(s.bankCharges)})
          </span>
          <span className="text-primary font-mono text-sm font-black">= {rs(s.currentBalance)}</span>
        </div>
      </section>

      {/* ── SECTION: RECONCILIATION STATEMENT MATCHING ── */}
      <section className="card space-y-3 bg-paper">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div>
            <h2 className="text-sm font-bold text-ink">⚖️ Bank Statement Reconciliation Checker</h2>
            <p className="text-[11px] text-muted">Compare bank passbook/statement closing balance with software ledger</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Enter Bank Statement Balance"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              className="text-xs font-mono font-bold px-3 py-1.5 w-60 border border-line rounded"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-muted block text-[11px]">Software Ledger Balance:</span>
            <span className="text-base font-bold text-primary font-mono mt-0.5 block">{rs(s.currentBalance)}</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-muted block text-[11px]">Unreconciled Transactions:</span>
            <span className={`text-base font-bold font-mono mt-0.5 block ${s.unreconciledCount > 0 ? "text-warn" : "text-good"}`}>
              {s.unreconciledCount} entries ({rs(s.unreconciledAmount)})
            </span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-muted block text-[11px]">Reconciliation Status:</span>
            {reconDifference !== null ? (
              <span className={`text-base font-bold font-mono mt-0.5 block ${reconDifference === 0 ? "text-good" : "text-bad"}`}>
                {reconDifference === 0 ? "✓ EXACT MATCH (BALANCED)" : `${reconDifference > 0 ? `+${rs(reconDifference)} (Passbook Higher)` : `−${rs(Math.abs(reconDifference))} (Passbook Lower)`}`}
              </span>
            ) : (
              <span className="text-muted text-xs block mt-1">Enter statement balance to verify</span>
            )}
          </div>
        </div>
      </section>

      {/* ── SECTION: INTERACTIVE BANK TRANSACTION LEDGER ── */}
      <section className="card space-y-3">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-ink">📜 Bank Transaction Ledger ({filteredTransactions.length} entries)</h2>
            <span className="badge bg-surface-hi text-[10px]">Real-time Flow</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-surface rounded border border-line p-0.5 text-xs">
              {[
                { id: "ALL", label: "All" },
                { id: "DEPOSITS", label: "Deposits" },
                { id: "WITHDRAWALS", label: "Withdrawals" },
                { id: "TRANSFERS", label: "Transfers" },
                { id: "CHARGES", label: "Charges" },
                { id: "UNRECONCILED", label: "Unreconciled" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFilterType(t.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    filterType === t.id ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <input
              type="search"
              placeholder="Search UTR, party, notes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs px-2.5 py-1 w-44"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2">Date</th>
                <th className="py-2">Account / Bank</th>
                <th className="py-2">Type</th>
                <th className="py-2">Ref / UTR #</th>
                <th className="py-2">Party / Narration</th>
                <th className="py-2 text-right">Inflow (+)</th>
                <th className="py-2 text-right">Outflow (−)</th>
                <th className="py-2 text-right font-bold">Running Balance</th>
                <th className="py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-line hover:bg-surface-hi">
                    <td className="py-2 font-mono text-[11px] text-muted">{tx.businessDate}</td>
                    <td className="py-2 font-medium">{tx.bankName || "Main"}</td>
                    <td className="py-2">
                      <span
                        className={`badge text-[10px] font-semibold ${
                          tx.type === "DIRECT_DEPOSIT" || tx.type === "CUSTOMER_TRANSFER" || tx.type === "UPI_COLLECTION"
                            ? "bg-good/15 text-good"
                            : tx.type === "ADJUSTMENT"
                            ? "bg-primary/15 text-primary"
                            : tx.type === "BANK_CHARGES"
                            ? "bg-bad/15 text-bad"
                            : "bg-ink/10 text-ink"
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-[11px]">{tx.utrReference || "—"}</td>
                    <td className="py-2 font-medium text-ink">{tx.partyName || tx.notes || "Bank Transaction"}</td>
                    <td className="py-2 text-right font-mono font-semibold text-good">
                      {tx.isCredit ? `+${rs(tx.amount)}` : "—"}
                    </td>
                    <td className="py-2 text-right font-mono font-semibold text-bad">
                      {!tx.isCredit ? `−${rs(tx.amount)}` : "—"}
                    </td>
                    <td className="py-2 text-right font-mono font-bold text-ink">{rs(tx.runningBalance)}</td>
                    <td className="py-2 text-center">
                      <button
                        onClick={() => toggleReconcile(tx.id, tx.reconciled)}
                        className={`badge text-[10px] font-bold cursor-pointer transition-colors ${
                          tx.reconciled ? "bg-good/15 text-good hover:bg-good/25" : "bg-warn/15 text-warn hover:bg-warn/25"
                        }`}
                        title="Click to toggle reconcile status"
                      >
                        {tx.reconciled ? "✓ Reconciled" : "⚠️ Unreconciled"}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted text-xs">
                    No bank transactions found. Record one or import statement to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MODAL 1: ADD BANK ACCOUNT ── */}
      {showAddAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <h3 className="font-bold text-sm text-ink">🏛️ Add New Bank Account</h3>
              <button onClick={() => setShowAddAccountModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddAccount} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Account Display Name *</label>
                <input
                  required
                  placeholder="e.g. HDFC Current, SBI Main, Axis Escrow"
                  className="w-full"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-muted mb-1">Bank Name</label>
                <input
                  placeholder="e.g. HDFC Bank, State Bank of India"
                  className="w-full"
                  value={accountForm.bankName}
                  onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Account Number *</label>
                  <input
                    required
                    placeholder="e.g. 50200088991122"
                    className="w-full font-mono"
                    value={accountForm.accountNumber}
                    onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">IFSC Code</label>
                  <input
                    placeholder="e.g. HDFC0001234"
                    className="w-full font-mono uppercase"
                    value={accountForm.ifsc}
                    onChange={(e) => setAccountForm({ ...accountForm, ifsc: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Account Type</label>
                  <select
                    className="w-full"
                    value={accountForm.accountType}
                    onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value as any })}
                  >
                    <option value="CURRENT">Current Account</option>
                    <option value="SAVINGS">Savings Account</option>
                    <option value="OD_CC">Overdraft (OD/CC)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-muted mb-1">Branch Name</label>
                  <input
                    placeholder="e.g. Main Branch"
                    className="w-full"
                    value={accountForm.branch}
                    onChange={(e) => setAccountForm({ ...accountForm, branch: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Opening Balance (₹)</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full font-mono font-bold"
                    value={accountForm.openingBalance}
                    onChange={(e) => setAccountForm({ ...accountForm, openingBalance: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Opening Date</label>
                  <input
                    type="date"
                    className="w-full font-mono"
                    value={accountForm.openingDate}
                    onChange={(e) => setAccountForm({ ...accountForm, openingDate: e.target.value })}
                  />
                </div>
              </div>

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowAddAccountModal(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary font-bold">
                  {saving ? "Saving..." : "Save Bank Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: RECORD TRANSACTION ── */}
      {showAddTxModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <h3 className="font-bold text-sm text-ink">+ Record Bank Transaction</h3>
              <button onClick={() => setShowAddTxModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Target Bank Account</label>
                <select
                  className="w-full"
                  value={txForm.bankAccountId}
                  onChange={(e) => setTxForm({ ...txForm, bankAccountId: e.target.value })}
                >
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.accountNumber}) - Bal: {rs(a.currentBalance)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Transaction Type</label>
                  <select
                    className="w-full"
                    value={txForm.type}
                    onChange={(e) => {
                      const val = e.target.value;
                      const isCredit = val === "CUSTOMER_TRANSFER" || val === "DIRECT_DEPOSIT" || val === "UPI_COLLECTION" || val === "CHEQUE_CLEARANCE";
                      setTxForm({ ...txForm, type: val, isCredit });
                    }}
                  >
                    <option value="CUSTOMER_TRANSFER">Customer Transfer (NEFT/RTGS/IMPS)</option>
                    <option value="DIRECT_DEPOSIT">Cash Drawer Deposit</option>
                    <option value="UPI_COLLECTION">UPI Settlement</option>
                    <option value="CHEQUE_CLEARANCE">Cheque Clearance</option>
                    <option value="SUPPLIER_PAYMENT">Supplier Payout</option>
                    <option value="EXPENSE_PAYOUT">Expense Payout</option>
                    <option value="BANK_CHARGES">Bank Charges / Fees</option>
                    <option value="ADJUSTMENT">Manual Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="block text-muted mb-1">Flow Direction</label>
                  <select
                    className="w-full font-bold"
                    value={txForm.isCredit ? "INFLOW" : "OUTFLOW"}
                    onChange={(e) => setTxForm({ ...txForm, isCredit: e.target.value === "INFLOW" })}
                  >
                    <option value="INFLOW" className="text-good">Inflow (+) Deposit</option>
                    <option value="OUTFLOW" className="text-bad">Outflow (−) Withdrawal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Amount (₹) *</label>
                  <input
                    required
                    type="number"
                    min={0.01}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full font-mono font-bold"
                    value={txForm.amount}
                    onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full font-mono"
                    value={txForm.businessDate}
                    onChange={(e) => setTxForm({ ...txForm, businessDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Party / Payee Name</label>
                  <input
                    placeholder="Customer / Vendor / Self"
                    className="w-full"
                    value={txForm.partyName}
                    onChange={(e) => setTxForm({ ...txForm, partyName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Ref / UTR / Cheque #</label>
                  <input
                    placeholder="UTR / Cheque No"
                    className="w-full font-mono"
                    value={txForm.utrReference}
                    onChange={(e) => setTxForm({ ...txForm, utrReference: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted mb-1">Narration / Notes</label>
                <input
                  placeholder="Notes for ledger"
                  className="w-full"
                  value={txForm.notes}
                  onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })}
                />
              </div>

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowAddTxModal(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary font-bold">
                  {saving ? "Recording..." : "Record Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 3: INTER-BANK TRANSFER ── */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <h3 className="font-bold text-sm text-ink">⇄ Inter-Bank Account Transfer</h3>
              <button onClick={() => setShowTransferModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleInterBankTransfer} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">From Account (Source Outflow −)</label>
                <select
                  required
                  className="w-full"
                  value={transferForm.fromAccount}
                  onChange={(e) => setTransferForm({ ...transferForm, fromAccount: e.target.value })}
                >
                  <option value="">Select source account</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.accountNumber}) - Bal: {rs(a.currentBalance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted mb-1">To Account (Destination Inflow +)</label>
                <select
                  required
                  className="w-full"
                  value={transferForm.toAccount}
                  onChange={(e) => setTransferForm({ ...transferForm, toAccount: e.target.value })}
                >
                  <option value="">Select destination account</option>
                  {data.accounts
                    .filter((a) => a.id !== transferForm.fromAccount)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.accountNumber}) - Bal: {rs(a.currentBalance)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Transfer Amount (₹) *</label>
                  <input
                    required
                    type="number"
                    min={0.01}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full font-mono font-bold text-sm"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full font-mono"
                    value={transferForm.transferDate}
                    onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted mb-1">UTR / Transfer Reference #</label>
                <input
                  placeholder="e.g. UTR / IMPS Ref"
                  className="w-full font-mono"
                  value={transferForm.referenceNo}
                  onChange={(e) => setTransferForm({ ...transferForm, referenceNo: e.target.value })}
                />
              </div>

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowTransferModal(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary font-bold">
                  {saving ? "Transferring..." : "Execute Transfer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 4: STATEMENT IMPORT ── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <h3 className="font-bold text-sm text-ink">📥 Bank Statement Import</h3>
              <button onClick={() => setShowImportModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Select Bank Account to Import Into *</label>
                <select
                  required
                  className="w-full font-bold"
                  value={importTargetAcc}
                  onChange={(e) => setImportTargetAcc(e.target.value)}
                >
                  <option value="">Select account</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.accountNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted mb-1">
                  Paste NetBanking Statement Lines / CSV Text (Date, Description, Ref, Amount):
                </label>
                <textarea
                  rows={4}
                  placeholder={`2026-04-10, NEFT Customer Payment, UTR998811, 45000\n2026-04-11, Electricity Bill Debit, REF123, -3200`}
                  className="w-full font-mono text-xs"
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    parseStatementText(e.target.value);
                  }}
                />
              </div>

              {importPreview.length > 0 && (
                <div className="space-y-2">
                  <span className="font-bold text-good block text-xs">
                    ✓ Parsed {importPreview.length} Transactions for Import Preview:
                  </span>
                  <div className="max-h-48 overflow-y-auto border border-line rounded">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="bg-surface border-b border-line text-muted">
                          <th className="py-1 px-2">Date</th>
                          <th className="py-1 px-2">Description</th>
                          <th className="py-1 px-2">Ref</th>
                          <th className="py-1 px-2 text-right">Amount</th>
                          <th className="py-1 px-2">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((item, idx) => (
                          <tr key={idx} className="border-b border-line">
                            <td className="py-1 px-2 font-mono">{item.date}</td>
                            <td className="py-1 px-2 truncate max-w-xs">{item.description}</td>
                            <td className="py-1 px-2 font-mono">{item.reference}</td>
                            <td className={`py-1 px-2 text-right font-mono font-bold ${item.isCredit ? "text-good" : "text-bad"}`}>
                              {item.isCredit ? `+${rs(item.amount)}` : `−${rs(item.amount)}`}
                            </td>
                            <td className="py-1 px-2">{item.isCredit ? "Deposit" : "Withdrawal"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowImportModal(false)} className="btn">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !importTargetAcc || importPreview.length === 0}
                  onClick={handleBulkImport}
                  className="btn btn-primary font-bold"
                >
                  {saving ? "Importing..." : `Import ${importPreview.length} Transactions`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
