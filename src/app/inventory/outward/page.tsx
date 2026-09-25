"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type OutwardMove = {
  id: string;
  movementType: "DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT";
  movementQty: number;
  beforeQty: number;
  afterQty: number;
  referenceId: string | null;
  timestamp: string;
  product: { id: string; name: string; sku: string; baseUnit: { symbol: string } };
  user: { name: string; staffId: string };
  warehouse: { name: string; code: string };
};

type Product = { id: string; name: string; sku: string; baseUnit: { symbol: string } };

export default function OutwardStockPage() {
  const { data, loading, error, reload } = useApiGet<OutwardMove[]>("/api/inventory/outward");
  const { data: products } = useApiGet<Product[]>("/api/products");

  const [showModal, setShowModal] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<"DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT">("DAMAGE");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleIssueOutward(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !reason || parseFloat(quantity) <= 0) {
      return setFormError("Please fill product, quantity, and mandatory reason");
    }

    setSaving(true);
    setFormError(null);

    const res = await fetch("/api/inventory/outward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        quantity: parseFloat(quantity),
        movementType,
        reason,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(b.error || "Failed to process outward issue");
    }

    setShowModal(false);
    setProductId("");
    setQuantity("1");
    setReason("");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Stock Issue & Outward Log</h1>
          <p className="text-xs text-muted">Outward stock deductions with mandatory reason logging (Damage, Expiry, Returns)</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            onClick={() => setShowModal(true)}
          >
            + Record Outward Issue
          </button>
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Record Stock Outward Issue</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {formError && <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">{formError}</div>}

            <form onSubmit={handleIssueOutward} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">Select Product SKU *</label>
                <select
                  className="w-full"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  required
                >
                  <option value="">Select product…</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Outward Category *</label>
                  <select
                    className="w-full"
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as any)}
                  >
                    <option value="DAMAGE">Damaged Goods</option>
                    <option value="EXPIRY">Expired Stock</option>
                    <option value="RETURN">Supplier Return</option>
                    <option value="TRANSFER_OUT">Inter-FC Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Quantity to Deduct *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="w-full"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold">Mandatory Reason / Notes *</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Broken packaging during forklift transit in Row 4"
                  className="w-full"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Deducting stock…" : "✓ Confirm Outward Deduction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2">Date & Time</th>
                <th className="py-2">Product SKU</th>
                <th className="py-2">Reason Category</th>
                <th className="py-2">Deducted Qty</th>
                <th className="py-2">Remaining Stock</th>
                <th className="py-2">Mandatory Reason / Remarks</th>
                <th className="py-2">Issued By</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-line/50">
                  <td className="py-2 text-muted">{fmtTime(m.timestamp)}</td>
                  <td className="py-2 font-medium">{m.product.name} ({m.product.sku})</td>
                  <td className="py-2">
                    <span className={`badge text-xs font-semibold ${
                      m.movementType === "DAMAGE" ? "bg-bad text-white" :
                      m.movementType === "EXPIRY" ? "bg-warn text-white" : "bg-ink text-surface"
                    }`}>
                      {m.movementType}
                    </span>
                  </td>
                  <td className="py-2 font-bold text-bad">
                    {Math.abs(Number(m.movementQty))} {m.product.baseUnit.symbol}
                  </td>
                  <td className="py-2 font-medium">
                    {Number(m.afterQty)} {m.product.baseUnit.symbol}
                  </td>
                  <td className="py-2 italic text-ink">{m.referenceId || "—"}</td>
                  <td className="py-2 text-muted">{m.user.name} ({m.user.staffId})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
