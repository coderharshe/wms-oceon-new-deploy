"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonCard, SkeletonTable } from "@/components/Skeleton";
import { fmtDate, fmtDateTime } from "@/lib/fmt";

type BankData = {
  summary: {
    bankBalance: number;
    totalDeposits: number;
    totalUpi: number;
    totalExpenses: number;
    unreconciledCount: number;
  };
  deposits: { id: string; amount: string; note: string | null; createdAt: string }[];
  upiSettlements: { id: string; amount: string; status: string; gatewayRef: string | null; createdAt: string }[];
  expenses: { id: string; amount: string; category: string; description: string; createdAt: string }[];
};

export default function FinanceBankReconciliationPage() {
  const { data, error, loading, reload } = useApiGet<BankData>("/api/finance/bank");
  const [tab, setTab] = useState<"all" | "deposits" | "upi" | "expenses">("all");
  const [showAddForm, setShowAddForm] = useState(false);

  // Form fields are non-mandatory per instructions
  const [form, setForm] = useState({
    type: "DEPOSIT",
    amount: "",
    accountNumber: "",
    reference: "",
    description: "",
    status: "RECONCILED",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualEntries, setManualEntries] = useState<any[]>([]);

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError("Please enter a valid amount");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Failed to add bank entry");
      }
      const created = await res.json();
      setManualEntries((prev) => [created.entry, ...prev]);
      setForm({
        type: "DEPOSIT",
        amount: "",
        accountNumber: "",
        reference: "",
        description: "",
        status: "RECONCILED",
      });
      setShowAddForm(false);
      reload();
    } catch (err: any) {
      setFormError(err?.message || "Failed to save bank entry");
    } finally {
      setSaving(false);
    }
  }

  function exportCSV() {
    if (!data) return;
    const rows = [
      ["Date", "Type", "Amount", "Reference / Note", "Category / Status"],
      ...data.deposits.map((d) => [fmtDate(d.createdAt), "CASH_DEPOSIT", d.amount, d.note || "", "RECONCILED"]),
      ...data.upiSettlements.map((u) => [fmtDate(u.createdAt), "UPI_SETTLEMENT", u.amount, u.gatewayRef || "", u.status]),
      ...data.expenses.map((e) => [fmtDate(e.createdAt), "EXPENSE", e.amount, e.description, e.category]),
      ...manualEntries.map((m) => [fmtDate(m.createdAt), m.type, String(m.amount), m.reference || m.description || "", m.status]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map((x) => `"${x}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `bank_recon_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ErrorRetry message={error} onRetry={reload} />
      </div>
    );
  }

  const summary = data?.summary ?? {
    bankBalance: 0,
    totalDeposits: 0,
    totalUpi: 0,
    totalExpenses: 0,
    unreconciledCount: 0,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Bank Statement &amp; Reconciliation</h1>
          <p className="text-xs text-muted">Track bank deposits, UPI settlements, vendor transfers and book-vs-bank reconciliation</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn text-xs font-semibold"
            onClick={exportCSV}
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs font-semibold"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? "✕ Close Form" : "+ Add Bank Entry"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-accent p-4">
          <span className="text-xs font-medium text-muted">Estimated Bank Balance</span>
          <p className="mt-1 text-2xl font-bold text-ink">₹{summary.bankBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          <span className="text-[11px] text-muted">Cash deposits + UPI - Expenses</span>
        </div>
        <div className="card p-4">
          <span className="text-xs font-medium text-muted">Cash Drawer Deposits</span>
          <p className="mt-1 text-2xl font-bold text-ink">₹{summary.totalDeposits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          <span className="text-[11px] text-muted">{data?.deposits.length || 0} deposit records</span>
        </div>
        <div className="card p-4">
          <span className="text-xs font-medium text-muted">UPI Inward Settlements</span>
          <p className="mt-1 text-2xl font-bold text-ink">₹{summary.totalUpi.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          <span className="text-[11px] text-muted">{data?.upiSettlements.length || 0} cleared QR batches</span>
        </div>
        <div className="card p-4">
          <span className="text-xs font-medium text-muted">Direct Bank Outflows</span>
          <p className="mt-1 text-2xl font-bold text-ink">₹{summary.totalExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          <span className="text-[11px] text-muted">{data?.expenses.length || 0} expenses &amp; payouts</span>
        </div>
      </div>

      {/* Optional Manual Entry Form */}
      {showAddForm && (
        <form onSubmit={handleAddEntry} className="card border-accent/40 bg-accent/5 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-sm font-bold text-ink">Record Bank Statement Entry</h2>
            <span className="text-xs text-muted">All details except amount are optional</span>
          </div>

          {formError && (
            <div className="rounded border border-bad/20 bg-bad/10 p-2 text-xs text-bad">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <div>
              <label className="mb-1 block font-semibold text-muted">Entry Type</label>
              <select
                className="w-full"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="DEPOSIT">Direct Deposit (Credit)</option>
                <option value="WITHDRAWAL">Bank Withdrawal / Cheque (Debit)</option>
                <option value="INTEREST">Bank Interest Received</option>
                <option value="CHARGES">Bank Charges / Fees</option>
                <option value="OTHER">Other Bank Adjustment</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                className="w-full font-semibold"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Bank Account (Optional)</label>
              <input
                className="w-full"
                placeholder="e.g. HDFC 50100234..."
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">UTR / Cheque / Ref No. (Optional)</label>
              <input
                className="w-full"
                placeholder="e.g. UTR12345678"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Description / Notes (Optional)</label>
              <input
                className="w-full"
                placeholder="Brief description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Reconciliation Status</label>
              <select
                className="w-full"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="RECONCILED">Reconciled (Matched)</option>
                <option value="PENDING">Pending Clearing</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn text-xs"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary text-xs font-semibold"
            >
              {saving ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </form>
      )}

      {/* Tabs & Transactions Table */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              className={`rounded px-3 py-1 font-semibold ${tab === "all" ? "bg-accent text-surface" : "bg-surface-hi text-muted"}`}
              onClick={() => setTab("all")}
            >
              All Records
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 font-semibold ${tab === "deposits" ? "bg-accent text-surface" : "bg-surface-hi text-muted"}`}
              onClick={() => setTab("deposits")}
            >
              Cash Deposits ({data?.deposits.length || 0})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 font-semibold ${tab === "upi" ? "bg-accent text-surface" : "bg-surface-hi text-muted"}`}
              onClick={() => setTab("upi")}
            >
              UPI Settlements ({data?.upiSettlements.length || 0})
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 font-semibold ${tab === "expenses" ? "bg-accent text-surface" : "bg-surface-hi text-muted"}`}
              onClick={() => setTab("expenses")}
            >
              Direct Outflows ({data?.expenses.length || 0})
            </button>
          </div>
          <span className="text-xs text-muted">Auto-refreshed from Cash, UPI &amp; Expense ledgers</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-surface-hi text-muted">
              <tr>
                <th className="py-2 px-3">Date &amp; Time</th>
                <th className="py-2 px-3">Transaction Type</th>
                <th className="py-2 px-3">Reference / Details</th>
                <th className="py-2 px-3 text-right">Inward (+)</th>
                <th className="py-2 px-3 text-right">Outward (-)</th>
                <th className="py-2 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {/* Manual added entries */}
              {manualEntries.map((m, idx) => (
                <tr key={`m-${idx}`} className="hover:bg-surface-hi">
                  <td className="py-2 px-3 text-muted">{fmtDateTime(m.createdAt)}</td>
                  <td className="py-2 px-3 font-semibold text-accent">{m.type}</td>
                  <td className="py-2 px-3">{m.reference || m.description || "Manual statement record"}</td>
                  <td className="py-2 px-3 text-right font-bold text-good">
                    {["DEPOSIT", "INTEREST"].includes(m.type) ? `+₹${Number(m.amount).toFixed(2)}` : "-"}
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-bad">
                    {!["DEPOSIT", "INTEREST"].includes(m.type) ? `-₹${Number(m.amount).toFixed(2)}` : "-"}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="badge bg-good/10 text-good border-good/30 text-[10px]">{m.status}</span>
                  </td>
                </tr>
              ))}

              {/* Cash Deposits */}
              {(tab === "all" || tab === "deposits") &&
                data?.deposits.map((d) => (
                  <tr key={`dep-${d.id}`} className="hover:bg-surface-hi">
                    <td className="py-2 px-3 text-muted">{fmtDateTime(d.createdAt)}</td>
                    <td className="py-2 px-3 font-semibold text-ink">Cash Drawer Deposit</td>
                    <td className="py-2 px-3">{d.note || "Counter cash deposit to bank"}</td>
                    <td className="py-2 px-3 text-right font-bold text-good">+₹{Number(d.amount).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-muted">-</td>
                    <td className="py-2 px-3 text-center">
                      <span className="badge bg-good/10 text-good text-[10px]">Reconciled</span>
                    </td>
                  </tr>
                ))}

              {/* UPI Settlements */}
              {(tab === "all" || tab === "upi") &&
                data?.upiSettlements.map((u) => (
                  <tr key={`upi-${u.id}`} className="hover:bg-surface-hi">
                    <td className="py-2 px-3 text-muted">{fmtDateTime(u.createdAt)}</td>
                    <td className="py-2 px-3 font-semibold text-ink">UPI Settlement Batch</td>
                    <td className="py-2 px-3 text-muted">{u.gatewayRef ? `Ref: ${u.gatewayRef}` : "QR Payment Collection"}</td>
                    <td className="py-2 px-3 text-right font-bold text-good">+₹{Number(u.amount).toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-muted">-</td>
                    <td className="py-2 px-3 text-center">
                      <span className="badge bg-accent/10 text-accent text-[10px]">{u.status}</span>
                    </td>
                  </tr>
                ))}

              {/* Expenses */}
              {(tab === "all" || tab === "expenses") &&
                data?.expenses.map((e) => (
                  <tr key={`exp-${e.id}`} className="hover:bg-surface-hi">
                    <td className="py-2 px-3 text-muted">{fmtDateTime(e.createdAt)}</td>
                    <td className="py-2 px-3 font-semibold text-ink">Expense ({e.category})</td>
                    <td className="py-2 px-3">{e.description}</td>
                    <td className="py-2 px-3 text-right text-muted">-</td>
                    <td className="py-2 px-3 text-right font-bold text-bad">-₹{Number(e.amount).toFixed(2)}</td>
                    <td className="py-2 px-3 text-center">
                      <span className="badge bg-line text-muted text-[10px]">Cleared</span>
                    </td>
                  </tr>
                ))}

              {(!data || (data.deposits.length === 0 && data.upiSettlements.length === 0 && data.expenses.length === 0 && manualEntries.length === 0)) && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    No bank transactions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
