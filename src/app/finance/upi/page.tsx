"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type UPIData = {
  totalCollected: number;
  totalSettled: number;
  totalCharges: number;
  pendingSettlement: number;
  settlements: {
    id: string;
    transactionId: string;
    orderNumber: string | null;
    collectionDate: string;
    settlementDate: string | null;
    collectedAmount: number;
    settlementAmount: number | null;
    chargesAmount: number | null;
    status: "PENDING" | "SETTLED" | "DISCREPANCY";
    notes: string | null;
  }[];
};

export default function UpiSettlementPage() {
  const { data, loading, error, reload } = useApiGet<UPIData>("/api/finance/upi");

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [chargesAmount, setChargesAmount] = useState("0");
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSettle(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItem || !settlementAmount) return;

    setSaving(true);
    const res = await fetch("/api/finance/upi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedItem.id,
        settlementDate,
        settlementAmount: parseFloat(settlementAmount),
        chargesAmount: parseFloat(chargesAmount) || 0,
        notes: notes || undefined,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setSelectedItem(null);
      reload();
    }
  }

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">UPI Payments & Bank Settlement Reconciliation</h1>
          <p className="text-xs text-muted">UPI QR collections, gateway fee reconciliation, and bank settlement tracking</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Total UPI Collected</div>
          <div className="text-2xl font-bold text-good">
            ₹{data.totalCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Bank Credited / Settled</div>
          <div className="text-2xl font-bold text-primary">
            ₹{data.totalSettled.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Gateway / Bank Charges</div>
          <div className="text-2xl font-bold text-muted">
            ₹{data.totalCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Pending Settlement</div>
          <div className={`text-2xl font-bold ${data.pendingSettlement > 0 ? "text-warn" : "text-good"}`}>
            ₹{data.pendingSettlement.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Reconcile UPI Settlement</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setSelectedItem(null)}>✕</button>
            </div>

            <form onSubmit={handleSettle} className="space-y-3 text-xs">
              <div className="text-xs space-y-1 bg-surface-hi p-2 rounded">
                <div>Txn ID: <strong>{selectedItem.transactionId}</strong></div>
                <div>Collected: <strong className="text-good">₹{Number(selectedItem.collectedAmount).toFixed(2)}</strong></div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Bank Credited Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full font-bold"
                    value={settlementAmount}
                    onChange={(e) => setSettlementAmount(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">MDR / Gateway Fee (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full"
                    value={chargesAmount}
                    onChange={(e) => setChargesAmount(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold">Bank Credit Date *</label>
                <input
                  type="date"
                  className="w-full"
                  value={settlementDate}
                  onChange={(e) => setSettlementDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold">Notes / Discrepancy Reason</label>
                <input
                  type="text"
                  placeholder="e.g. 1.8% gateway charges auto-deducted"
                  className="w-full"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setSelectedItem(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary font-semibold" disabled={saving}>
                  {saving ? "Reconciling…" : "✓ Confirm Settlement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2">Transaction ID</th>
              <th className="py-2">Order Ref</th>
              <th className="py-2">Collected Amount</th>
              <th className="py-2">Bank Credited</th>
              <th className="py-2">Gateway Charges</th>
              <th className="py-2">Status</th>
              <th className="py-2">Collection Date</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.settlements.map((s) => (
              <tr key={s.id} className="border-b border-line/50 hover:bg-surface-hi">
                <td className="py-2 font-mono font-medium">{s.transactionId}</td>
                <td className="py-2 font-semibold text-ink">{s.orderNumber || "—"}</td>
                <td className="py-2 font-bold text-good">₹{Number(s.collectedAmount).toFixed(2)}</td>
                <td className="py-2 font-medium">
                  {s.settlementAmount ? `₹${Number(s.settlementAmount).toFixed(2)}` : "—"}
                </td>
                <td className="py-2 text-muted">
                  {s.chargesAmount ? `₹${Number(s.chargesAmount).toFixed(2)}` : "—"}
                </td>
                <td className="py-2">
                  <span className={`badge text-xs font-semibold ${
                    s.status === "SETTLED" ? "bg-good text-white" : s.status === "PENDING" ? "bg-warn text-white" : "bg-bad text-white"
                  }`}>
                    {s.status}
                  </span>
                </td>
                <td className="py-2 text-muted">{fmtTime(s.collectionDate)}</td>
                <td className="py-2 text-right">
                  {s.status !== "SETTLED" && (
                    <button
                      className="btn text-xs font-semibold"
                      onClick={() => {
                        setSelectedItem(s);
                        setSettlementAmount(String(s.collectedAmount));
                      }}
                    >
                      Reconcile
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
