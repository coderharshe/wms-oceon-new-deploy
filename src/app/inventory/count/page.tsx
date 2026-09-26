"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type ProductWithInventory = {
  id: string;
  name: string;
  sku: string;
  baseUnit?: { symbol?: string } | null;
  available?: number | null;
  inventory?: { quantityOnHand: number }[];
};

type AdjustmentRequest = {
  id: string;
  systemQty: number;
  physicalQty: number;
  varianceQty: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  product: { name: string; sku: string; baseUnit: { symbol: string } };
  requestedByUser: { name: string; staffId: string };
  approvedByUser: { name: string; staffId: string } | null;
};

export default function PhysicalCountPage() {
  const { data: products, loading: pLoading, error: pError, reload: reloadProducts } = useApiGet<ProductWithInventory[]>("/api/products");
  const { data: adjustments, loading: aLoading, reload: reloadAdjustments } = useApiGet<AdjustmentRequest[]>("/api/inventory/adjustments");

  const [countMap, setCountMap] = useState<Record<string, { physical: string; notes: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleCountChange(productId: string, val: string) {
    setCountMap({
      ...countMap,
      [productId]: {
        physical: val,
        notes: countMap[productId]?.notes || "",
      },
    });
  }

  function handleNotesChange(productId: string, notes: string) {
    setCountMap({
      ...countMap,
      [productId]: {
        physical: countMap[productId]?.physical || "",
        notes,
      },
    });
  }

  async function handleSubmitCount() {
    const countedItems = [];
    if (!products) return;

    for (const p of products) {
      const entry = countMap[p.id];
      if (entry && entry.physical !== "") {
        const physical = parseFloat(entry.physical);
        const system = Number(p.available ?? p.inventory?.[0]?.quantityOnHand ?? 0);
        countedItems.push({
          productId: p.id,
          systemQty: system,
          physicalQty: physical,
          notes: entry.notes || undefined,
        });
      }
    }

    if (countedItems.length === 0) {
      return setMessage("Please enter physical counts for at least one SKU.");
    }

    setSubmitting(true);
    setMessage(null);

    const res = await fetch("/api/inventory/count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: countedItems,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setMessage(b.error || "Failed to submit inventory count");
    }

    setMessage("Inventory count audit submitted! Any variances have been sent for Manager approval.");
    setCountMap({});
    reloadProducts();
    reloadAdjustments();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Physical Inventory Count & Variance Audit</h1>
          <p className="text-xs text-muted">Periodic inventory audits, physical count verification, and difference approval requests</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            disabled={submitting}
            onClick={handleSubmitCount}
          >
            {submitting ? "Submitting Audit…" : "✓ Submit Physical Audit & Request Approvals"}
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-2 rounded text-xs ${message.includes("submitted") ? "bg-good/10 text-good border border-good/20" : "bg-bad/10 text-bad border border-bad/20"}`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Shelf Inventory Audit Entry</h2>
          {pLoading && <SkeletonTable rows={8} cols={5} />}
          {pError && <ErrorRetry message={pError} onRetry={reloadProducts} />}

          {products && (
            <div className="card overflow-x-auto max-h-[70vh]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted sticky top-0 bg-paper">
                    <th className="py-2">Product SKU</th>
                    <th className="py-2">System Inventory</th>
                    <th className="py-2">Physical Count</th>
                    <th className="py-2">Live Variance</th>
                    <th className="py-2">Variance Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const system = Number(p.available ?? p.inventory?.[0]?.quantityOnHand ?? 0);
                    const unitSym = p.baseUnit?.symbol || "Units";
                    const physicalStr = countMap[p.id]?.physical ?? "";
                    const physical = physicalStr !== "" ? parseFloat(physicalStr) : null;
                    const variance = physical !== null ? physical - system : null;

                    return (
                      <tr key={p.id} className="border-b border-line/50">
                        <td className="py-2 font-medium">
                          <div>{p.name}</div>
                          <div className="text-[10px] text-muted">{p.sku}</div>
                        </td>
                        <td className="py-2 font-semibold">
                          {system.toFixed(2)} {unitSym}
                        </td>
                        <td className="py-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Count"
                            className="w-24 text-xs font-bold"
                            value={physicalStr}
                            onChange={(e) => handleCountChange(p.id, e.target.value)}
                          />
                        </td>
                        <td className="py-2">
                          {variance !== null ? (
                            <span className={`badge text-xs font-bold ${
                              variance === 0 ? "bg-good/10 text-good" : variance > 0 ? "bg-accent/10 text-accent" : "bg-bad text-white"
                            }`}>
                              {variance > 0 ? `+${variance.toFixed(2)}` : variance.toFixed(2)} {unitSym}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          <input
                            type="text"
                            placeholder="Reason for diff…"
                            className="w-full text-xs"
                            value={countMap[p.id]?.notes ?? ""}
                            onChange={(e) => handleNotesChange(p.id, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Adjustment Requests Status</h2>
          {adjustments && adjustments.length === 0 && (
            <div className="card text-center py-6 text-muted text-xs">
              No inventory adjustment requests logged.
            </div>
          )}

          {adjustments && adjustments.length > 0 && (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {adjustments.map((a) => {
                const diff = Number(a.varianceQty);
                return (
                  <div key={a.id} className="card space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">{a.product.name}</span>
                      <span className={`badge text-[10px] font-semibold ${
                        a.status === "PENDING" ? "bg-warn text-white" : a.status === "APPROVED" ? "bg-good text-white" : "bg-bad text-white"
                      }`}>
                        {a.status}
                      </span>
                    </div>

                    <div className="flex justify-between text-muted text-[11px]">
                      <span>System: {Number(a.systemQty).toFixed(2)}</span>
                      <span>Physical: {Number(a.physicalQty).toFixed(2)}</span>
                      <span className={`font-bold ${diff < 0 ? "text-bad" : "text-good"}`}>
                        Diff: {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} {a.product.baseUnit.symbol}
                      </span>
                    </div>

                    <div className="text-muted text-[11px] italic">"{a.reason}"</div>
                    <div className="text-muted text-[10px] pt-1">
                      {fmtTime(a.createdAt)} · By: {a.requestedByUser.name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
