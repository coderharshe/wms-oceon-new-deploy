"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";

type ExpenseItem = {
  id: string;
  amount: number;
  category: string;
  displayCategory: string;
  date: string;
  paymentMode: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
  account: string;
  vendor: string;
  invoiceProof: string;
  description: string;
  notes: string;
  attachmentKey: string | null;
  isApproved: boolean;
  createdByUser: { name: string; staffId: string } | null;
  approvedByUser: { name: string; staffId: string } | null;
  warehouse: string;
};

type ExpenseApiResponse = {
  userRole: "ADMIN" | "MANAGER" | "FINANCE" | string;
  userId: string;
  totalExpense: number;
  pendingApprovalCount: number;
  pendingApprovalAmount: number;
  categorySummary: Record<string, number>;
  paymentModeSummary: Record<string, number>;
  expenses: ExpenseItem[];
};

const CATEGORIES = [
  { key: "RENT", label: "🏢 Rent", color: "bg-indigo-500/10 text-indigo-700 border-indigo-500/30" },
  { key: "ELECTRICITY", label: "💡 Electricity", color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { key: "SALARY", label: "👥 Salary", color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  { key: "DELIVERY", label: "🚚 Delivery", color: "bg-cyan-500/10 text-cyan-700 border-cyan-500/30" },
  { key: "PACKAGING", label: "📦 Packaging", color: "bg-orange-500/10 text-orange-700 border-orange-500/30" },
  { key: "MARKETING", label: "📢 Marketing", color: "bg-pink-500/10 text-pink-700 border-pink-500/30" },
  { key: "SOFTWARE", label: "💻 Software", color: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { key: "REPAIRS", label: "🔧 Repairs", color: "bg-rose-500/10 text-rose-700 border-rose-500/30" },
  { key: "TRANSPORT", label: "🚛 Transport", color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { key: "MISCELLANEOUS", label: "📋 Miscellaneous", color: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  { key: "OTHERS", label: "📌 Others", color: "bg-zinc-500/10 text-zinc-700 border-zinc-500/30" },
];

export default function ExpensesPage() {
  const [range, setRange] = useState<"today" | "7d" | "thisMonth" | "all">("thisMonth");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [q, setQ] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("RENT");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState("");
  const [invoiceProof, setInvoiceProof] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE">("BANK_TRANSFER");
  const [account, setAccount] = useState("HDFC Current");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApiGet<ExpenseApiResponse>(
    `/api/finance/expenses?range=${range}${selectedCategory !== "all" ? `&category=${selectedCategory}` : ""}`
  );

  if (loading) return <SkeletonTable rows={6} cols={6} />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { totalExpense, categorySummary, paymentModeSummary, expenses, userRole } = data;
  const canApprove = userRole === "ADMIN" || userRole === "MANAGER";

  // Filtered Expenses
  const filteredExpenses = expenses.filter((exp) => {
    const matchesSearch =
      exp.vendor.toLowerCase().includes(q.toLowerCase()) ||
      exp.description.toLowerCase().includes(q.toLowerCase()) ||
      exp.invoiceProof.toLowerCase().includes(q.toLowerCase()) ||
      (exp.createdByUser && exp.createdByUser.name.toLowerCase().includes(q.toLowerCase())) ||
      exp.account.toLowerCase().includes(q.toLowerCase());

    return matchesSearch;
  });

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setFormError("Please enter a valid expense amount");
      return;
    }

    if (!vendor) {
      setFormError("Please enter the vendor / recipient name");
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RECORD",
          amount: amt,
          category,
          date,
          vendor,
          invoiceProof,
          paymentMode,
          account: paymentMode === "CASH" ? "Cash Drawer" : account,
          notes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to record expense");

      setShowModal(false);
      setAmount("");
      setVendor("");
      setInvoiceProof("");
      setNotes("");
      reload();
    } catch (err: any) {
      setFormError(err.message || "Failed to save expense");
    } finally {
      setSaving(false);
    }
  };

  const handleApproveExpense = async (expenseId: string) => {
    try {
      const res = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE",
          expenseId,
        }),
      });

      if (!res.ok) throw new Error("Approval failed");
      reload();
    } catch (err: any) {
      alert(err.message || "Approval failed");
    }
  };

  const parsedAmt = parseFloat(amount);
  const exceedsApprovalLimit = !isNaN(parsedAmt) && parsedAmt > 10000;

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🧾</span>
            <h1 className="text-xl font-black text-ink">Business Expense Management</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Track operational spending across all 11 categories (Rent, Electricity, Salary, Delivery, Packaging, Marketing, Software, Repairs, Transport, Miscellaneous, Others)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex bg-surface p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setRange("today")}
              className={`px-3 py-1 rounded transition-colors ${
                range === "today" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setRange("7d")}
              className={`px-3 py-1 rounded transition-colors ${
                range === "7d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setRange("thisMonth")}
              className={`px-3 py-1 rounded transition-colors ${
                range === "thisMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setRange("all")}
              className={`px-3 py-1 rounded transition-colors ${
                range === "all" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              All Time
            </button>
          </div>

          <button
            onClick={() => {
              setAmount("");
              setVendor("");
              setInvoiceProof("");
              setNotes("");
              setShowModal(true);
              setFormError(null);
            }}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-accent text-white hover:bg-accent/90 shadow-md flex items-center gap-1.5 transition-all"
          >
            + Record Expense
          </button>
        </div>
      </div>

      {/* KPI & Tender Spend Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card bg-bad/5 border-bad/30 p-3 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold text-bad">Total Expenditure</div>
          <div className="text-lg font-black text-bad mt-0.5">
            ₹{totalExpense.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{expenses.length} entries recorded</div>
        </div>

        <div className="card p-3 border-l-4 border-l-emerald-500">
          <div className="text-[11px] font-semibold text-emerald-600">💵 Cash Paid</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{(paymentModeSummary["CASH"] || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">From Cash Drawer</div>
        </div>

        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-600">🏦 Bank Transfer</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{(paymentModeSummary["BANK_TRANSFER"] || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">NEFT / RTGS</div>
        </div>

        <div className="card p-3 border-l-4 border-l-purple-500">
          <div className="text-[11px] font-semibold text-purple-600">📱 UPI Transfer</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{(paymentModeSummary["UPI"] || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Digital QR / UPI</div>
        </div>

        <div className="card p-3 border-l-4 border-l-amber-500">
          <div className="text-[11px] font-semibold text-amber-600">🧾 Cheque Paid</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{(paymentModeSummary["CHEQUE"] || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Issued Cheques</div>
        </div>

        <div className={`card p-3 border-l-4 ${
          data.pendingApprovalCount > 0 ? "border-l-warn bg-warn/5" : "border-l-line"
        }`}>
          <div className="text-[11px] font-semibold text-warn">Pending Approval</div>
          <div className="text-base font-bold text-warn mt-0.5">
            ₹{data.pendingApprovalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{data.pendingApprovalCount} high-value expenses</div>
        </div>
      </div>

      {/* Category Pills Breakdown */}
      <div className="bg-surface p-3 rounded-lg border border-line space-y-2">
        <div className="flex justify-between items-center text-xs font-semibold text-muted">
          <span>Categories ({CATEGORIES.length})</span>
          <span>Click any category to filter</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              selectedCategory === "all"
                ? "bg-accent text-white border-accent shadow-sm"
                : "bg-surface-hi text-muted border-line hover:text-ink"
            }`}
          >
            All Categories (₹{totalExpense.toLocaleString("en-IN", { maximumFractionDigits: 0 })})
          </button>

          {CATEGORIES.map((cat) => {
            const catTotal = categorySummary[cat.key] || 0;
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(isSelected ? "all" : cat.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-accent text-white border-accent shadow-sm"
                    : `${cat.color} hover:shadow-xs`
                }`}
              >
                <span>{cat.label}</span>
                <span className="font-bold">₹{catTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search and Table */}
      <div className="card overflow-x-auto p-0 border border-line">
        <div className="p-4 border-b border-line bg-surface-hi/50 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Expense Vouchers Ledger</h2>
            <p className="text-[11px] text-muted">Showing {filteredExpenses.length} expense entries</p>
          </div>

          <div className="w-full sm:w-72">
            <input
              type="search"
              placeholder="Search vendor, invoice #, account, notes..."
              className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface focus:outline-none focus:border-accent"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
              <th className="py-3 px-4">Date</th>
              <th className="py-3 px-3">Category</th>
              <th className="py-3 px-3">Vendor / Recipient</th>
              <th className="py-3 px-3">Invoice / Proof</th>
              <th className="py-3 px-3">Account</th>
              <th className="py-3 px-3">Payment Mode</th>
              <th className="py-3 px-3 text-right">Amount (₹)</th>
              <th className="py-3 px-3">Created By</th>
              <th className="py-3 px-4 text-center">Approved By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  No expense records matching criteria.
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp) => {
                const catObj = CATEGORIES.find((c) => c.key === exp.displayCategory) ?? {
                  key: "MISCELLANEOUS",
                  label: "📋 Miscellaneous",
                  color: "bg-slate-500/10 text-slate-700 border-slate-500/30",
                };
                return (
                  <tr key={exp.id} className="hover:bg-surface-hi/80 transition-colors">
                    {/* Date */}
                    <td className="py-3 px-4 font-mono text-[11px] text-muted">{exp.date}</td>

                    {/* Category */}
                    <td className="py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${catObj.color}`}>
                        {catObj.label}
                      </span>
                    </td>

                    {/* Vendor */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-ink">{exp.vendor}</div>
                      {exp.notes && (
                        <div className="text-[10px] text-muted truncate max-w-xs">{exp.notes}</div>
                      )}
                    </td>

                    {/* Invoice / Proof */}
                    <td className="py-3 px-3 font-mono text-[11px] text-muted">
                      {exp.invoiceProof !== "—" ? (
                        <span className="bg-surface-hi px-1.5 py-0.5 rounded border border-line font-semibold text-ink">
                          {exp.invoiceProof}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Account */}
                    <td className="py-3 px-3 font-semibold text-ink">{exp.account}</td>

                    {/* Payment Mode */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          exp.paymentMode === "CASH"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : exp.paymentMode === "BANK_TRANSFER"
                            ? "bg-sky-500/15 text-sky-600"
                            : exp.paymentMode === "UPI"
                            ? "bg-purple-500/15 text-purple-600"
                            : "bg-amber-500/15 text-amber-600"
                        }`}
                      >
                        {exp.paymentMode === "BANK_TRANSFER" ? "NEFT / RTGS" : exp.paymentMode}
                      </span>
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-3 text-right font-black text-bad text-sm">
                      ₹{exp.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Created By */}
                    <td className="py-3 px-3">
                      <div className="font-medium text-ink">{exp.createdByUser?.name || "Staff"}</div>
                      <div className="text-[10px] text-muted font-mono">{exp.createdByUser?.staffId}</div>
                    </td>

                    {/* Approved By */}
                    <td className="py-3 px-4 text-center">
                      {exp.isApproved ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="text-[10px] font-bold text-good bg-good/15 px-2 py-0.5 rounded-full">
                            ✓ Approved
                          </span>
                          <span className="text-[9px] text-muted mt-0.5">
                            {exp.approvedByUser?.name || "Manager"}
                          </span>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center gap-1">
                          <span className="text-[10px] font-bold text-warn bg-warn/15 px-2 py-0.5 rounded-full">
                            ⏳ Pending
                          </span>
                          {canApprove && (
                            <button
                              onClick={() => handleApproveExpense(exp.id)}
                              className="px-2 py-0.5 text-[10px] font-bold rounded bg-good text-white hover:bg-good/90 shadow-xs"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* RECORD EXPENSE MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Record Business Expense</h3>
                <p className="text-xs text-muted">Log operational expenditure with vendor, account, and proof details</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-bad/15 text-bad border border-bad/30 text-xs font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateExpense} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">Expense Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 15000"
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi font-bold text-ink text-sm"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Category *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {exceedsApprovalLimit && (
                <div className="bg-purple-500/10 border border-purple-500/30 p-2.5 rounded-lg text-purple-700 text-[11px] font-semibold flex items-center gap-2">
                  <span>🛡️</span>
                  <span>Amount exceeds ₹10,000 threshold &mdash; will route to Manager / Admin for sign-off.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">Expense Date *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Vendor / Payee Name *</label>
                  <input
                    type="text"
                    required
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="e.g. Tata Power / Landlord Ramesh"
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">Payment Mode *</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as any)}
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS)</option>
                    <option value="UPI">UPI Transfer</option>
                    <option value="CASH">Cash Drawer</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Debited Account *</label>
                  {paymentMode === "CASH" ? (
                    <input
                      type="text"
                      disabled
                      value="Cash Drawer (Daily Till)"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi/50 text-muted"
                    />
                  ) : (
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                    >
                      <option value="HDFC Current">HDFC Current (9482)</option>
                      <option value="SBI Current">SBI Current (1102)</option>
                      <option value="ICICI Current">ICICI Current</option>
                      <option value="Axis Bank">Axis Bank</option>
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Invoice / Receipt Proof Reference #</label>
                <input
                  type="text"
                  value={invoiceProof}
                  onChange={(e) => setInvoiceProof(e.target.value)}
                  placeholder="e.g. BILL-9481 / INV-2026-08"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Description / Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Monthly warehouse rent payment for September"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {saving ? "Recording..." : "✓ Save & Post Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
