"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type InventoryReport = {
  summary: {
    totalSkus: number;
    totalItems: number;
    totalValuation: number;
    lowStockCount: number;
    oosCount: number;
  };
  lowStockList: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    quantity: number;
    minStock: number;
    shortage: number;
  }[];
  oosList: {
    id: string;
    name: string;
    sku: string;
    unit: string;
    quantity: number;
    minStock: number;
  }[];
  recentMovements: {
    id: string;
    productName: string;
    sku: string;
    movementType: string;
    movementQty: number;
    beforeQty: number;
    afterQty: number;
    reference: string;
    staff: string;
    timestamp: string;
  }[];
};

export default function InventoryReportsPage() {
  const [activeTab, setActiveTab] = useState<"alerts" | "movements">("alerts");
  const { data, loading, error, reload } = useApiGet<InventoryReport>("/api/inventory/reports");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Inventory Reports & Critical Health Alerts</h1>
          <p className="text-xs text-muted">Real-time stock valuation, low-stock alerts, out-of-stock monitoring, and audit log</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Total Stock Valuation</div>
          <div className="text-2xl font-bold text-good">
            ₹{Number(data.summary.totalValuation).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Total SKUs in System</div>
          <div className="text-2xl font-bold">{data.summary.totalSkus}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Low Stock Items</div>
          <div className="text-2xl font-bold text-warn">{data.summary.lowStockCount}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Out of Stock (OOS)</div>
          <div className={`text-2xl font-bold ${data.summary.oosCount > 0 ? "text-bad" : ""}`}>{data.summary.oosCount}</div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-2 text-xs">
        <button
          className={`rounded px-3 py-1 font-medium ${activeTab === "alerts" ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
          onClick={() => setActiveTab("alerts")}
        >
          🚨 Critical Stock Alerts ({data.summary.lowStockCount + data.summary.oosCount})
        </button>
        <button
          className={`rounded px-3 py-1 font-medium ${activeTab === "movements" ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
          onClick={() => setActiveTab("movements")}
        >
          📦 Stock Movement Audit Log
        </button>
      </div>

      {activeTab === "alerts" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card space-y-2">
            <h2 className="text-sm font-semibold text-bad border-b border-line pb-1">
              🔴 Out of Stock SKUs ({data.oosList.length})
            </h2>
            {data.oosList.length === 0 ? (
              <div className="text-xs text-muted py-4 text-center">Zero out-of-stock items. Stock is healthy!</div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto space-y-1 text-xs">
                {data.oosList.map((item) => (
                  <div key={item.id} className="flex justify-between items-center py-1.5 border-b border-line/50">
                    <div>
                      <div className="font-semibold text-ink">{item.name}</div>
                      <div className="text-[10px] text-muted">SKU: {item.sku}</div>
                    </div>
                    <div className="text-right">
                      <span className="badge bg-bad text-white text-xs">0.00 {item.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card space-y-2">
            <h2 className="text-sm font-semibold text-warn border-b border-line pb-1">
              🟠 Low Stock SKUs ({data.lowStockList.length})
            </h2>
            {data.lowStockList.length === 0 ? (
              <div className="text-xs text-muted py-4 text-center">No low stock items.</div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto space-y-1 text-xs">
                {data.lowStockList.map((item) => (
                  <div key={item.id} className="flex justify-between items-center py-1.5 border-b border-line/50">
                    <div>
                      <div className="font-semibold text-ink">{item.name}</div>
                      <div className="text-[10px] text-muted">SKU: {item.sku} · Min: {item.minStock} {item.unit}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-warn">{item.quantity.toFixed(2)} {item.unit}</div>
                      <div className="text-[10px] text-bad">Short by {item.shortage.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "movements" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2">Timestamp</th>
                <th className="py-2">Product SKU</th>
                <th className="py-2">Movement Type</th>
                <th className="py-2">Quantity</th>
                <th className="py-2">Before / After</th>
                <th className="py-2">Reference</th>
                <th className="py-2">Handled By</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMovements.map((m) => (
                <tr key={m.id} className="border-b border-line/50">
                  <td className="py-2 text-muted">{fmtTime(m.timestamp)}</td>
                  <td className="py-2 font-medium">{m.productName} ({m.sku})</td>
                  <td className="py-2">
                    <span className="badge bg-surface-hi text-ink font-semibold">{m.movementType}</span>
                  </td>
                  <td className={`py-2 font-bold ${m.movementQty > 0 ? "text-good" : "text-bad"}`}>
                    {m.movementQty > 0 ? `+${m.movementQty.toFixed(2)}` : m.movementQty.toFixed(2)}
                  </td>
                  <td className="py-2 text-muted">
                    {m.beforeQty.toFixed(2)} → {m.afterQty.toFixed(2)}
                  </td>
                  <td className="py-2 italic text-ink">{m.reference || "—"}</td>
                  <td className="py-2 text-muted">{m.staff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
