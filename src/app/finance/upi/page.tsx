"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";

import { FinanceDateRangePicker } from "@/components/FinanceDateRangePicker";
import type { DateRangePreset } from "@/lib/date-filter";

type UpiAccount = {
  id: string;
  name: string;
  vpa: string;
  provider: string;
  linkedBankAccountId?: string;
  linkedBankName?: string;
  mdrPercent?: number;
  active: boolean;
};

type UpiEntry = {
  id: string;
  settlementId: string | null;
  transactionId: string;
  orderNumber: string;
  customerName: string;
  collectionDate: string;
  collectedAmount: number;
  isRefund: boolean;
  settledAmount: number;
  chargesAmount: number;
  settlementDate: string | null;
  settlementUtr: string | null;
  status: "PENDING" | "SETTLED" | "DISCREPANCY" | "REFUNDED";
  upiAccount: string;
};

type UpiApiResponse = {
  upiAccounts: UpiAccount[];
  selectedUpiAccountId: string;
  summary: {
    totalGrossCollected: number;
    totalGrossRefunded: number;
    totalSettledToBank: number;
    totalChargesDeducted: number;
    pendingInTransit: number;
    totalTransactions: number;
    pendingCount: number;
    settledCount: number;
    discrepancyCount: number;
  };
  entries: UpiEntry[];
  dateFilter?: {
    preset: DateRangePreset;
    startDateStr: string;
    endDateStr: string;
    label: string;
  };
};

const rs = (x: number | string) => `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function UpiDigitalPaymentsPage() {
  const [selectedUpiAccount, setSelectedUpiAccount] = useState<string>("ALL");
  const [datePreset, setDatePreset] = useState<DateRangePreset>("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const queryParams = new URLSearchParams();
  if (selectedUpiAccount !== "ALL") queryParams.set("upiAccountId", selectedUpiAccount);
  if (datePreset !== "today") queryParams.set("preset", datePreset);
  if (datePreset === "custom" && startDate && endDate) {
    queryParams.set("startDate", startDate);
    queryParams.set("endDate", endDate);
  }
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const { data, error, loading, reload } = useApiGet<UpiApiResponse>(`/api/finance/upi${queryString}`);

  // Modals & Selection
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showBatchSettleModal, setShowBatchSettleModal] = useState(false);
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);

  // Filter & Search
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Account Form
  const [accountForm, setAccountForm] = useState({
    name: "",
    vpa: "",
    provider: "PHONEPE",
    linkedBankName: "HDFC Current",
    mdrPercent: "0",
  });

  // Batch Settle Form
  const [settleForm, setSettleForm] = useState({
    settlementDate: new Date().toISOString().split("T")[0],
    settlementBankName: "HDFC Current",
    settlementBankAcc: "50200088991122",
    batchUtr: "",
    chargesAmount: "0",
    notes: "",
  });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountForm.name.trim() || !accountForm.vpa.trim()) {
      setFormError("Account name and UPI VPA are required");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/upi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SAVE_UPI_ACCOUNT",
          ...accountForm,
          mdrPercent: parseFloat(accountForm.mdrPercent) || 0,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save UPI account");

      setShowAddAccountModal(false);
      setAccountForm({
        name: "",
        vpa: "",
        provider: "PHONEPE",
        linkedBankName: "HDFC Current",
        mdrPercent: "0",
      });
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error saving account");
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchSettle(e: React.FormEvent) {
    e.preventDefault();
    if (selectedTxIds.length === 0) {
      setFormError("No transactions selected for settlement");
      return;
    }
    setSaving(true);
    setFormError(null);

    const selectedItems = (data?.entries || []).filter((e) => selectedTxIds.includes(e.id));

    try {
      const res = await fetch("/api/finance/upi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SETTLE_TRANSACTIONS",
          items: selectedItems,
          ...settleForm,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to settle transactions");

      setShowBatchSettleModal(false);
      setSelectedTxIds([]);
      setSettleForm({
        settlementDate: new Date().toISOString().split("T")[0],
        settlementBankName: "HDFC Current",
        settlementBankAcc: "50200088991122",
        batchUtr: "",
        chargesAmount: "0",
        notes: "",
      });
      reload();
    } catch (err: any) {
      setFormError(err.message || "Error settling transactions");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelectAll() {
    if (!data) return;
    const pendingIds = data.entries.filter((e) => e.status === "PENDING" && !e.isRefund).map((e) => e.id);
    if (selectedTxIds.length === pendingIds.length) setSelectedTxIds([]);
    else setSelectedTxIds(pendingIds);
  }

  function toggleSelectTx(id: string) {
    if (selectedTxIds.includes(id)) setSelectedTxIds(selectedTxIds.filter((x) => x !== id));
    else setSelectedTxIds([...selectedTxIds, id]);
  }

  function exportCSV() {
    if (!data) return;
    const rows = [
      ["Date", "RRN / Tx ID", "Order #", "Customer", "UPI Account", "Gross Amount", "Settled Amount", "MDR Charges", "Settlement Date", "Status"],
      ...data.entries.map((e) => [
        fmtDateTime(e.collectionDate),
        e.transactionId,
        e.orderNumber,
        e.customerName,
        e.upiAccount,
        String(e.collectedAmount),
        String(e.settledAmount),
        String(e.chargesAmount),
        e.settlementDate || "Pending",
        e.status,
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map((x) => `"${x}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `upi_digital_payments_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading && !data) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const s = data.summary;

  const filteredEntries = data.entries.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchRrn = item.transactionId.toLowerCase().includes(q);
      const matchOrder = item.orderNumber.toLowerCase().includes(q);
      const matchCust = item.customerName.toLowerCase().includes(q);
      const matchUtr = item.settlementUtr?.toLowerCase().includes(q);
      return matchRrn || matchOrder || matchCust || matchUtr;
    }
    return true;
  });

  const selectedTotalAmt = (data.entries || [])
    .filter((e) => selectedTxIds.includes(e.id))
    .reduce((sum, e) => sum + e.collectedAmount, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-ink">4️⃣ 📱 UPI & Digital Payments Management</h1>
            <span className="badge bg-good/10 text-good font-bold">Dedicated Gateway Clearing</span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Distinct Digital Payment Channel Tracking, MDR Fee Reconciliation, T+1 Bank Settlements & Discrepancy Audits
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedTxIds.length > 0 && (
            <button
              onClick={() => setShowBatchSettleModal(true)}
              className="btn btn-primary text-xs font-bold animate-pulse"
            >
              ⚡ Settle Selected ({selectedTxIds.length} txs · {rs(selectedTotalAmt)}) → Bank
            </button>
          )}
          <button onClick={() => setShowAddAccountModal(true)} className="btn text-xs font-semibold">
            + Add UPI QR Account
          </button>
          <button onClick={exportCSV} className="btn text-xs font-semibold" title="Export CSV">
            📊 Export CSV
          </button>
          <button onClick={() => reload()} className="btn text-xs font-semibold" title="Refresh">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── Statement Period / Date Range Picker ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-2.5 rounded-xl border border-line">
        <div className="text-xs font-bold text-ink flex items-center gap-1.5">
          <span>📅 Statement Period:</span>
          <strong className="text-accent font-mono">{data?.dateFilter?.label || "Today"}</strong>
        </div>

        <FinanceDateRangePicker
          preset={datePreset}
          startDate={startDate || data?.dateFilter?.startDateStr || ""}
          endDate={endDate || data?.dateFilter?.endDateStr || ""}
          onChange={(p, s, e) => {
            setDatePreset(p);
            setStartDate(s);
            setEndDate(e);
          }}
        />
      </div>

      {/* ── UPI CHANNELS / VPA CARDS ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface p-2 rounded border border-line">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted uppercase mr-1">UPI Channels:</span>
          <button
            onClick={() => setSelectedUpiAccount("ALL")}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              selectedUpiAccount === "ALL" ? "bg-accent text-white shadow-sm" : "bg-paper border border-line text-ink hover:bg-surface-hi"
            }`}
          >
            📱 All Digital Channels ({data.entries.length} txs)
          </button>

          {data.upiAccounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setSelectedUpiAccount(acc.id)}
              className={`px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1.5 ${
                selectedUpiAccount === acc.id ? "bg-accent text-white shadow-sm" : "bg-paper border border-line text-ink hover:bg-surface-hi"
              }`}
            >
              <span>{acc.name}</span>
              <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${selectedUpiAccount === acc.id ? "bg-white/20 text-white" : "bg-surface text-muted"}`}>
                {acc.vpa}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── FORMULA & CLEARING ENGINE BANNER (NEVER MERGE BLINDLY WITH BANK) ── */}
      <section className="card space-y-4 border-l-4 border-l-good">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div>
            <h2 className="text-sm font-black text-ink uppercase tracking-tight">
              UPI Gateway Clearing & Settlement Equation
            </h2>
            <p className="text-[11px] text-muted">
              UPI payments sit in intermediate gateway clearing until settled with bank credits (T+0 / T+1)
            </p>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-muted block">Pending In-Transit Settlement</span>
            <span className={`text-xl font-black font-mono ${s.pendingInTransit > 0 ? "text-warn" : "text-good"}`}>
              {rs(s.pendingInTransit)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-good text-[11px] font-semibold block">1. Gross Collections (+)</span>
            <span className="text-sm font-black text-good font-mono mt-1 block">+{rs(s.totalGrossCollected)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">{s.totalTransactions} Customer Bills</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-bad text-[11px] font-semibold block">2. Digital Refunds (−)</span>
            <span className="text-sm font-black text-bad font-mono mt-1 block">−{rs(s.totalGrossRefunded)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Reversals</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-bad text-[11px] font-semibold block">3. MDR & Fee Deductions (−)</span>
            <span className="text-sm font-black text-bad font-mono mt-1 block">−{rs(s.totalChargesDeducted)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">Gateway / Bank Charges</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line">
            <span className="text-primary text-[11px] font-semibold block">4. Net Settled to Bank (−)</span>
            <span className="text-sm font-black text-primary font-mono mt-1 block">−{rs(s.totalSettledToBank)}</span>
            <span className="text-[10px] text-muted mt-0.5 block">{s.settledCount} Settled Inflows</span>
          </div>

          <div className="p-2.5 rounded bg-surface border border-line col-span-2 sm:col-span-1">
            <span className="text-ink text-[11px] font-bold block">5. Pending In-Transit (=)</span>
            <span className={`text-sm font-black font-mono mt-1 block ${s.pendingInTransit > 0 ? "text-warn" : "text-good"}`}>
              = {rs(s.pendingInTransit)}
            </span>
            <span className="text-[10px] text-muted mt-0.5 block">{s.pendingCount} Pending T+1</span>
          </div>
        </div>

        <div className="bg-surface-hi p-2 rounded border border-line flex flex-wrap justify-between items-center text-xs font-semibold">
          <span>
            🧮 Formula: Gross Inflow ({rs(s.totalGrossCollected)}) − Refunds ({rs(s.totalGrossRefunded)}) − MDR Charges ({rs(s.totalChargesDeducted)}) − Settled to Bank ({rs(s.totalSettledToBank)})
          </span>
          <span className="text-warn font-mono text-sm font-black">= In-Transit: {rs(s.pendingInTransit)}</span>
        </div>
      </section>

      {/* ── SECTION: INTERACTIVE UPI DIGITAL LEDGER TABLE ── */}
      <section className="card space-y-3">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-ink">📜 Digital Payment Ledger ({filteredEntries.length} transactions)</h2>
            <span className="badge bg-surface-hi text-[10px]">Real-time Digital Audit</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-surface rounded border border-line p-0.5 text-xs">
              {[
                { id: "ALL", label: "All" },
                { id: "PENDING", label: `Pending (${s.pendingCount})` },
                { id: "SETTLED", label: `Settled (${s.settledCount})` },
                { id: "DISCREPANCY", label: `Discrepancies (${s.discrepancyCount})` },
                { id: "REFUNDED", label: "Refunds" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setStatusFilter(t.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    statusFilter === t.id ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <input
              type="search"
              placeholder="Search RRN, Order #, Customer…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs px-2.5 py-1 w-48"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={
                      selectedTxIds.length > 0 &&
                      selectedTxIds.length === data.entries.filter((e) => e.status === "PENDING" && !e.isRefund).length
                    }
                    onChange={toggleSelectAll}
                    title="Select all pending"
                  />
                </th>
                <th className="py-2">Collection Date/Time</th>
                <th className="py-2">RRN / Tx ID</th>
                <th className="py-2">Order # / Invoice</th>
                <th className="py-2">Customer</th>
                <th className="py-2">UPI Channel</th>
                <th className="py-2 text-right">Gross Amount</th>
                <th className="py-2 text-right">Charges</th>
                <th className="py-2 text-right">Net Settled</th>
                <th className="py-2">Settlement Date</th>
                <th className="py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length > 0 ? (
                filteredEntries.map((tx) => (
                  <tr key={tx.id} className="border-b border-line hover:bg-surface-hi">
                    <td className="py-2 text-center">
                      {tx.status === "PENDING" && !tx.isRefund ? (
                        <input
                          type="checkbox"
                          checked={selectedTxIds.includes(tx.id)}
                          onChange={() => toggleSelectTx(tx.id)}
                        />
                      ) : (
                        <span className="text-muted text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted">{fmtDateTime(tx.collectionDate)}</td>
                    <td className="py-2 font-mono text-[11px] font-bold text-ink">{tx.transactionId}</td>
                    <td className="py-2 font-mono text-[11px]">
                      <span className="badge bg-surface-hi">{tx.orderNumber}</span>
                    </td>
                    <td className="py-2 font-medium">{tx.customerName}</td>
                    <td className="py-2 text-muted">{tx.upiAccount}</td>
                    <td className={`py-2 text-right font-mono font-bold ${tx.isRefund ? "text-bad" : "text-good"}`}>
                      {tx.isRefund ? `−${rs(tx.collectedAmount)}` : `+${rs(tx.collectedAmount)}`}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      {tx.chargesAmount > 0 ? `−${rs(tx.chargesAmount)}` : "₹0.00"}
                    </td>
                    <td className="py-2 text-right font-mono font-bold text-primary">
                      {tx.settledAmount > 0 ? rs(tx.settledAmount) : "—"}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted">{tx.settlementDate || "In Queue (T+1)"}</td>
                    <td className="py-2 text-center">
                      <span
                        className={`badge text-[10px] font-bold ${
                          tx.status === "SETTLED"
                            ? "bg-good/15 text-good"
                            : tx.status === "PENDING"
                            ? "bg-warn/15 text-warn"
                            : tx.status === "REFUNDED"
                            ? "bg-bad/15 text-bad"
                            : "bg-bad/25 text-bad"
                        }`}
                      >
                        {tx.status === "SETTLED"
                          ? "✓ Settled"
                          : tx.status === "PENDING"
                          ? "⏳ In-Transit"
                          : tx.status === "REFUNDED"
                          ? "🔄 Refunded"
                          : "⚠️ Discrepancy"}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-muted text-xs">
                    No UPI transactions found matching the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MODAL 1: ADD UPI ACCOUNT / VPA ── */}
      {showAddAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <h3 className="font-bold text-sm text-ink">📱 Add New UPI Channel / VPA QR</h3>
              <button onClick={() => setShowAddAccountModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">UPI Account / QR Title *</label>
                <input
                  required
                  placeholder="e.g. PhonePe Counter QR, Paytm Soundbox #2"
                  className="w-full"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-muted mb-1">UPI ID / VPA *</label>
                <input
                  required
                  placeholder="e.g. oceanwms@ybl, merchant@paytm"
                  className="w-full font-mono font-bold"
                  value={accountForm.vpa}
                  onChange={(e) => setAccountForm({ ...accountForm, vpa: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Provider / Gateway</label>
                  <select
                    className="w-full"
                    value={accountForm.provider}
                    onChange={(e) => setAccountForm({ ...accountForm, provider: e.target.value as any })}
                  >
                    <option value="PHONEPE">PhonePe</option>
                    <option value="PAYTM">Paytm</option>
                    <option value="BHARATPE">BharatPe</option>
                    <option value="GOOGLEPAY">Google Pay</option>
                    <option value="RAZORPAY">Razorpay</option>
                    <option value="OTHER">Other Provider</option>
                  </select>
                </div>
                <div>
                  <label className="block text-muted mb-1">MDR / Gateway Fee %</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full font-mono"
                    value={accountForm.mdrPercent}
                    onChange={(e) => setAccountForm({ ...accountForm, mdrPercent: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted mb-1">Settlement Target Bank Account</label>
                <input
                  placeholder="e.g. HDFC Current, SBI Current"
                  className="w-full"
                  value={accountForm.linkedBankName}
                  onChange={(e) => setAccountForm({ ...accountForm, linkedBankName: e.target.value })}
                />
              </div>

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowAddAccountModal(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary font-bold">
                  {saving ? "Saving..." : "Save UPI Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 2: BATCH SETTLE SELECTED UPI TXS TO BANK ── */}
      {showBatchSettleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-paper border border-line rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2">
              <div>
                <h3 className="font-bold text-sm text-ink">🏦 Settle Selected UPI to Bank</h3>
                <p className="text-[11px] text-muted">
                  Batch settling {selectedTxIds.length} transactions (Gross: {rs(selectedTotalAmt)})
                </p>
              </div>
              <button onClick={() => setShowBatchSettleModal(false)} className="text-muted hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleBatchSettle} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1">Destination Bank Account *</label>
                <select
                  required
                  className="w-full font-bold"
                  value={settleForm.settlementBankName}
                  onChange={(e) => setSettleForm({ ...settleForm, settlementBankName: e.target.value })}
                >
                  <option value="HDFC Current">HDFC Current (50200088991122)</option>
                  <option value="SBI Current">SBI Current (38912345678)</option>
                  <option value="Other Bank">Other Bank Account</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-muted mb-1">Bank Settlement Date</label>
                  <input
                    type="date"
                    className="w-full font-mono"
                    value={settleForm.settlementDate}
                    onChange={(e) => setSettleForm({ ...settleForm, settlementDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1">MDR Deductions (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full font-mono text-bad font-bold"
                    value={settleForm.chargesAmount}
                    onChange={(e) => setSettleForm({ ...settleForm, chargesAmount: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted mb-1">Gateway Batch Settlement UTR #</label>
                <input
                  placeholder="e.g. UTR / NEFT batch reference"
                  className="w-full font-mono font-bold"
                  value={settleForm.batchUtr}
                  onChange={(e) => setSettleForm({ ...settleForm, batchUtr: e.target.value })}
                />
              </div>

              <div className="p-2.5 rounded bg-surface-hi border border-line flex justify-between items-center text-xs font-bold">
                <span>Net Credit into Bank:</span>
                <span className="font-mono text-sm text-good">
                  {rs(Math.max(0, selectedTotalAmt - (parseFloat(settleForm.chargesAmount) || 0)))}
                </span>
              </div>

              {formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" onClick={() => setShowBatchSettleModal(false)} className="btn">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary font-bold">
                  {saving ? "Posting Settlement..." : "Confirm Bank Settlement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
