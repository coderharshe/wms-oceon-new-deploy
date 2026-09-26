"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type DamagedResponse = {
  stats: {
    totalLossValue: number;
    totalUnitsDamaged: number;
    incidentCount: number;
    topDamagedProduct: string;
  };
  warehouses: { id: string; name: string; code: string }[];
  movements: {
    id: string;
    timestamp: string;
    product: {
      id: string;
      name: string;
      sku: string;
      category: string;
      unit: string;
      wholesalePrice: number;
    };
    warehouse: {
      id: string;
      name: string;
      code: string;
    };
    reportedBy: {
      id: string;
      name: string;
      staffId: string;
    };
    quantity: number;
    lossValue: number;
    beforeQty: number;
    afterQty: number;
    reason: string;
  }[];
};

export default function DamagedGoodsPage() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "all">("30d");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const url = `/api/admin/damaged?period=${period}${selectedWarehouse ? `&warehouseId=${selectedWarehouse}` : ""}`;
  const { data, loading, error, reload } = useApiGet<DamagedResponse>(url);

  const filteredMovements = useMemo(() => {
    if (!data?.movements) return [];
    if (!searchQuery.trim()) return data.movements;
    const q = searchQuery.toLowerCase();
    return data.movements.filter(
      (m) =>
        m.product.name.toLowerCase().includes(q) ||
        m.product.sku.toLowerCase().includes(q) ||
        m.reportedBy.name.toLowerCase().includes(q) ||
        m.reportedBy.staffId.toLowerCase().includes(q) ||
        m.warehouse.name.toLowerCase().includes(q) ||
        m.reason.toLowerCase().includes(q)
    );
  }, [data?.movements, searchQuery]);

  function exportCSV() {
    if (!filteredMovements.length) return;
    const headers = ["Date & Time", "SKU", "Product", "Category", "Warehouse", "Damaged Qty", "Unit", "Loss Value (INR)", "Reported By (Staff ID)", "Reason / Notes"];
    const rows = filteredMovements.map((m) => [
      `"${new Date(m.timestamp).toLocaleString()}"`,
      `"${m.product.sku}"`,
      `"${m.product.name}"`,
      `"${m.product.category}"`,
      `"${m.warehouse.name} (${m.warehouse.code})"`,
      m.quantity,
      `"${m.product.unit}"`,
      m.lossValue.toFixed(2),
      `"${m.reportedBy.name} (${m.reportedBy.staffId})"`,
      `"${m.reason.replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `damaged_goods_${period}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SkeletonStats count={4} />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Damaged Goods</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="inline-flex rounded-md shadow-xs border border-border bg-card p-0.5 text-xs">
            <button
              onClick={() => setPeriod("today")}
              className={`px-3 py-1 rounded ${period === "today" ? "bg-primary text-white font-bold" : "text-muted hover:text-foreground"}`}
            >
              Today
            </button>
            <button
              onClick={() => setPeriod("7d")}
              className={`px-3 py-1 rounded ${period === "7d" ? "bg-primary text-white font-bold" : "text-muted hover:text-foreground"}`}
            >
              7 Days
            </button>
            <button
              onClick={() => setPeriod("30d")}
              className={`px-3 py-1 rounded ${period === "30d" ? "bg-primary text-white font-bold" : "text-muted hover:text-foreground"}`}
            >
              30 Days
            </button>
            <button
              onClick={() => setPeriod("all")}
              className={`px-3 py-1 rounded ${period === "all" ? "bg-primary text-white font-bold" : "text-muted hover:text-foreground"}`}
            >
              All Time
            </button>
          </div>

          {/* Warehouse Selector */}
          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="input text-xs py-1 px-2 border-border"
          >
            <option value="">All Warehouses</option>
            {data.warehouses?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>

          <button onClick={exportCSV} className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 font-medium">
            📥 Export CSV
          </button>

          <button onClick={reload} className="btn-secondary text-xs py-1 px-2">
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs text-muted font-medium">Total Loss Value</div>
          <div className="text-xl font-bold text-rose-600 mt-0.5">
            ₹{data.stats.totalLossValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">Cost basis write-off</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted font-medium">Total Damaged Units</div>
          <div className="text-xl font-bold text-amber-600 mt-0.5">
            {data.stats.totalUnitsDamaged.toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-muted mt-1">Deducted from on-hand stock</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted font-medium">Reported Incidents</div>
          <div className="text-xl font-bold text-ink mt-0.5">
            {data.stats.incidentCount}
          </div>
          <div className="text-[11px] text-muted mt-1">Inventory logs in selected period</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted font-medium">Highest Damaged Item</div>
          <div className="text-sm font-bold text-ink truncate mt-0.5" title={data.stats.topDamagedProduct}>
            {data.stats.topDamagedProduct}
          </div>
          <div className="text-[11px] text-muted mt-1">Most frequent damage loss</div>
        </div>
      </div>

      {/* Table Section */}
      <section className="card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs font-bold uppercase text-muted tracking-wider">
            Damage Logs ({filteredMovements.length})
          </div>
          <div className="w-full sm:w-72">
            <input
              type="text"
              placeholder="Search product, SKU, staff, reason…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input text-xs w-full py-1 px-2.5"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="px-3">SKU</th>
                <th className="px-3">Product</th>
                <th className="px-3">Warehouse</th>
                <th className="px-3 text-right">Damaged Qty</th>
                <th className="px-3 text-right">Loss Valuation</th>
                <th className="px-3">Reported By</th>
                <th className="px-3">Reason / Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-xs text-muted">
                    No damaged goods recorded for the selected filters.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => (
                  <tr key={m.id} className="border-b border-border/50 hover:bg-muted/10 transition">
                    <td className="py-2.5 px-3 whitespace-nowrap text-xs text-muted">
                      {fmtTime(m.timestamp)}
                    </td>
                    <td className="px-3 font-mono text-xs font-semibold">{m.product.sku}</td>
                    <td className="px-3 font-semibold text-ink">
                      <div>{m.product.name}</div>
                      <div className="text-[11px] text-muted font-normal">{m.product.category}</div>
                    </td>
                    <td className="px-3 text-xs">
                      <span className="font-medium">{m.warehouse.name}</span>
                      <span className="text-muted block text-[10px]">{m.warehouse.code}</span>
                    </td>
                    <td className="px-3 text-right font-bold text-rose-600">
                      {m.quantity} {m.product.unit}
                    </td>
                    <td className="px-3 text-right font-semibold">
                      ₹{m.lossValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 text-xs">
                      <span className="font-medium">{m.reportedBy.name}</span>
                      <span className="text-muted block text-[10px] font-mono">{m.reportedBy.staffId}</span>
                    </td>
                    <td className="px-3 text-xs text-muted max-w-xs">
                      <div className="line-clamp-2" title={m.reason}>
                        {m.reason}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
