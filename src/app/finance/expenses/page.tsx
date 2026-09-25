"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type ExpenseData = {
  totalExpense: number;
  categorySummary: Record<string, number>;
  expenses: {
    id: string;
    amount: number;
    category: string;
    date: string;
    paymentMode: string;
    description: string;
    createdAt: string;
    createdByUser: { name: string; staffId: string };
  }[];
};

export default function ExpensesPage() {
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const { data, loading, error, reload } = useApiGet<ExpenseData>(`/api/finance/expenses${categoryFilter ? `?category=${categoryFilter}` : ""}`);

  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("RENT");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreateExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !description) return setFormError("Please enter amount and description");

    setSaving(true);
    setFormError(null);

    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: parseFloat(amount),
        category,
        date,
        paymentMode,
        description,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(b.error || "Failed to record expense");
    }

    setShowModal(false);
    setAmount("");
    setDescription("");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Expense Management & Vouchers</h1>
          <p className="text-xs text-muted">Category-wise business expenditure tracking (Rent, Salary, Transport, Packaging, etc.)</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            onClick={() => setShowModal(true)}
          >
            + Record Expense
          </button>
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Record Business Expense</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {formError && <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">{formError}</div>}

            <form onSubmit={handleCreateExpense} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Expense Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Expense Category *</label>
                  <select
                    className="w-full"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="RENT">Rent</option>
                    <option value="ELECTRICITY">Electricity / Utilities</option>
                    <option value="SALARY">Salary / Wages</option>
                    <option value="TRANSPORT">Transport / Freight</option>
                    <option value="PACKAGING">Packaging Materials</option>
                    <option value="MARKETING">Marketing & Ads</option>
                    <option value="SOFTWARE">Software & Cloud</option>
                    <option value="MAINTENANCE">Maintenance & Repairs</option>
                    <option value="MISCELLANEOUS">Miscellaneous</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Expense Date *</label>
                  <input
                    type="date"
                    className="w-full"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Payment Mode</label>
                  <select
                    className="w-full"
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                  >
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">Bank / UPI Transfer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold">Description / Notes *</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Warehouse monthly electricity bill for August"
                  className="w-full"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Recording…" : "✓ Save Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="card overflow-x-auto">
            <div className="flex justify-between items-center pb-2 border-b border-line text-xs font-semibold">
              <span>Logged Expenses ({data.expenses.length})</span>
              <span>Total Expenditure: <strong className="text-bad">₹{data.totalExpense.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
            </div>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Date</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Description</th>
                  <th className="py-2">Payment Mode</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Logged By</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((exp) => (
                  <tr key={exp.id} className="border-b border-line/50 hover:bg-surface-hi">
                    <td className="py-2 text-muted">{new Date(exp.date).toLocaleDateString()}</td>
                    <td className="py-2">
                      <span className="badge bg-surface-hi font-semibold text-ink">{exp.category}</span>
                    </td>
                    <td className="py-2 font-medium text-ink">{exp.description}</td>
                    <td className="py-2 text-muted">{exp.paymentMode}</td>
                    <td className="py-2 font-bold text-bad">₹{Number(exp.amount).toFixed(2)}</td>
                    <td className="py-2 text-muted">{exp.createdByUser.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
