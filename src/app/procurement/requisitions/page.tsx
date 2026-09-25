"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";
import Link from "next/link";

type Requisition = {
  id: string;
  requisitionNo: string;
  status: "PENDING" | "PO_CREATED" | "CANCELLED";
  notes: string | null;
  createdAt: string;
  warehouse: { name: string; code: string };
  requestedByUser: { name: string; staffId: string };
  items: {
    id: string;
    product: { id: string; name: string; sku: string; baseUnit: { symbol: string } };
    requiredQty: number;
    currentStock: number;
    reorderLevel: number | null;
    suggestedSupplier: { id: string; name: string; phone: string | null } | null;
    notes: string | null;
  }[];
};

export default function RequisitionsPage() {
  const { data, loading, error, reload } = useApiGet<Requisition[]>("/api/procurement/requisitions");
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);

  async function handleAutoGenerate() {
    setGenerating(true);
    setGenMessage(null);
    const res = await fetch("/api/procurement/requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoGenerateFromLowStock: true }),
    });
    setGenerating(false);

    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setGenMessage(b.error || "Failed to generate requisition");
    }

    setGenMessage("Requisition successfully created for all low stock items!");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Purchase Requisitions</h1>
          <p className="text-xs text-muted">Stock-triggered demand and manual purchase requisitions</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            disabled={generating}
            onClick={handleAutoGenerate}
          >
            {generating ? "Scanning stock…" : "⚡ Auto-Generate From Low Stock"}
          </button>
        </div>
      </div>

      {genMessage && (
        <div className={`text-xs p-2 rounded ${genMessage.includes("success") ? "bg-good/10 text-good border border-good/20" : "bg-bad/10 text-bad border border-bad/20"}`}>
          {genMessage}
        </div>
      )}

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {data && data.length === 0 && (
        <div className="card text-center py-8 text-muted text-xs">
          No purchase requisitions found. Click "Auto-Generate From Low Stock" to automatically create one for low-stock SKUs.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-4">
          {data.map((req) => (
            <div key={req.id} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-ink">{req.requisitionNo}</span>
                  <span className={`badge text-xs font-semibold ${
                    req.status === "PENDING" ? "bg-warn text-white" : req.status === "PO_CREATED" ? "bg-good text-white" : "bg-muted text-white"
                  }`}>
                    {req.status}
                  </span>
                  <span className="text-xs text-muted">· {req.warehouse.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>Requested by: <strong>{req.requestedByUser.name}</strong> ({req.requestedByUser.staffId})</span>
                  <span>{fmtTime(req.createdAt)}</span>
                  {req.status === "PENDING" && (
                    <Link
                      href={`/procurement/orders/new?reqId=${req.id}`}
                      className="btn btn-primary text-xs font-semibold"
                    >
                      Convert to PO →
                    </Link>
                  )}
                </div>
              </div>

              {req.notes && <div className="text-xs italic text-muted">{req.notes}</div>}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-1">Product SKU</th>
                      <th className="py-1">Required Qty</th>
                      <th className="py-1">Current Stock</th>
                      <th className="py-1">Reorder Level</th>
                      <th className="py-1">Suggested Supplier</th>
                      <th className="py-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {req.items.map((item) => (
                      <tr key={item.id} className="border-b border-line/50">
                        <td className="py-1.5 font-medium">
                          {item.product.name}
                          <span className="ml-1 text-muted">({item.product.sku})</span>
                        </td>
                        <td className="py-1.5 font-bold text-bad">
                          {Number(item.requiredQty)} {item.product.baseUnit.symbol}
                        </td>
                        <td className="py-1.5 text-muted">
                          {Number(item.currentStock)} {item.product.baseUnit.symbol}
                        </td>
                        <td className="py-1.5 text-muted">
                          {item.reorderLevel ? `${Number(item.reorderLevel)} ${item.product.baseUnit.symbol}` : "—"}
                        </td>
                        <td className="py-1.5 font-semibold">
                          {item.suggestedSupplier?.name || "—"}
                        </td>
                        <td className="py-1.5 text-muted">{item.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
