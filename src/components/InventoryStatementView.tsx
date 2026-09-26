"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtDate } from "@/lib/fmt";

export type StatementItem = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  brand: string | null;
  active: boolean;
  baseUnit: {
    id: string;
    name: string;
    symbol: string;
  };
  costPrice: number;
  wholesalePrice: number;
  retailPrice: number;
  openingQty: number;
  openingCostValuation: number;
  openingWholesaleValuation: number;
  inwardQty: number;
  inwardCostValuation: number;
  outwardQty: number;
  outwardCostValuation: number;
  outwardSalesValuation: number;
  damagedQty: number;
  damagedCostValuation: number;
  returnQty: number;
  adjustmentQty: number;
  closingQty: number;
  closingCostValuation: number;
  closingWholesaleValuation: number;
  netChangeQty: number;
  netChangeCostValuation: number;
  movementBreakdown: Record<string, number>;
};

type StatementResponse = {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalSkus: number;
    totalOpeningQty: number;
    totalOpeningCostValuation: number;
    totalOpeningWholesaleValuation: number;
    totalInwardQty: number;
    totalInwardCostValuation: number;
    totalOutwardQty: number;
    totalOutwardCostValuation: number;
    totalOutwardSalesValuation: number;
    totalDamagedQty: number;
    totalDamagedCostValuation: number;
    totalAdjustmentsQty: number;
    totalClosingQty: number;
    totalClosingCostValuation: number;
    totalClosingWholesaleValuation: number;
    netStockChangeQty: number;
    netStockChangeValuation: number;
    turnoverRatio: number;
  };
  items: StatementItem[];
  warehouses: Array<{ id: string; name: string; code: string }>;
  categories: string[];
};

export function InventoryStatementView({
  defaultWarehouseId,
  portalRole = "ADMIN",
}: {
  defaultWarehouseId?: string;
  portalRole?: string;
}) {
  const [warehouseFilter, setWarehouseFilter] = useState(defaultWarehouseId || "");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activePreset, setActivePreset] = useState<string>("THIS_MONTH");

  // Date states (YYYY-MM-DD format)
  const todayStr = new Date().toISOString().split("T")[0];
  const firstOfMonthStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(firstOfMonthStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [selectedProductBreakdown, setSelectedProductBreakdown] = useState<StatementItem | null>(null);

  // Quick preset handlers
  function applyPreset(preset: string) {
    setActivePreset(preset);
    const now = new Date();

    if (preset === "TODAY") {
      const d = now.toISOString().split("T")[0];
      setStartDate(d);
      setEndDate(d);
    } else if (preset === "YESTERDAY") {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      setStartDate(y);
      setEndDate(y);
    } else if (preset === "LAST_7_DAYS") {
      const s = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      setStartDate(s);
      setEndDate(todayStr);
    } else if (preset === "THIS_MONTH") {
      setStartDate(firstOfMonthStr);
      setEndDate(todayStr);
    } else if (preset === "LAST_MONTH") {
      const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
      setStartDate(lmStart);
      setEndDate(lmEnd);
    }
  }

  const qs = new URLSearchParams();
  if (warehouseFilter) qs.set("warehouseId", warehouseFilter);
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", `${endDate}T23:59:59.999Z`);

  const { data, error, loading, reload } = useApiGet<StatementResponse>(
    `/api/admin/inventory-statement?${qs.toString()}`
  );

  const items = data?.items ?? [];
  const summary = data?.summary;
  const warehouses = data?.warehouses ?? [];
  const categories = data?.categories ?? [];

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    let result = items;

    if (categoryFilter) {
      result = result.filter((item) => item.category === categoryFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          (item.barcode && item.barcode.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q)) ||
          (item.brand && item.brand.toLowerCase().includes(q))
      );
    }

    return [...result].sort((a, b) => {
      let valA: any = a[sortBy as keyof StatementItem];
      let valB: any = b[sortBy as keyof StatementItem];

      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [items, categoryFilter, searchQuery, sortBy, sortDir]);

  // Export Statement to CSV
  function exportCSV() {
    if (!filteredItems.length) return;

    const headers = [
      "SKU",
      "Product Name",
      "Category",
      "Base Unit",
      "Cost Price (₹)",
      "Wholesale Price (₹)",
      "Opening Stock Qty",
      "Opening Cost Valuation (₹)",
      "Opening Wholesale Valuation (₹)",
      "Inward Qty (GRN/Receipt)",
      "Inward Cost Valuation (₹)",
      "Outward Qty (Sales/Dispatch)",
      "Outward Cost Valuation (₹)",
      "Outward Sales Valuation (₹)",
      "Damaged/Expired Qty",
      "Damaged Cost Valuation (₹)",
      "Adjustments Qty",
      "Closing Stock Qty",
      "Closing Cost Valuation (₹)",
      "Closing Wholesale Valuation (₹)",
      "Net Qty Flow",
      "Net Cost Valuation Flow (₹)",
    ];

    const rows = filteredItems.map((item) => [
      `"${item.sku.replace(/"/g, '""')}"`,
      `"${item.name.replace(/"/g, '""')}"`,
      `"${item.category.replace(/"/g, '""')}"`,
      `"${item.baseUnit.symbol}"`,
      item.costPrice.toFixed(2),
      item.wholesalePrice.toFixed(2),
      item.openingQty.toFixed(2),
      item.openingCostValuation.toFixed(2),
      item.openingWholesaleValuation.toFixed(2),
      item.inwardQty.toFixed(2),
      item.inwardCostValuation.toFixed(2),
      item.outwardQty.toFixed(2),
      item.outwardCostValuation.toFixed(2),
      item.outwardSalesValuation.toFixed(2),
      item.damagedQty.toFixed(2),
      item.damagedCostValuation.toFixed(2),
      item.adjustmentQty.toFixed(2),
      item.closingQty.toFixed(2),
      item.closingCostValuation.toFixed(2),
      item.closingWholesaleValuation.toFixed(2),
      item.netChangeQty.toFixed(2),
      item.netChangeCostValuation.toFixed(2),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Opening_Closing_Stock_Statement_${startDate}_to_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Top Filter Bar with Presets & Date Range */}
      <div className="card space-y-3 bg-surface border border-line">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-line pb-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-muted mr-1">Period:</span>
            {[
              { id: "TODAY", label: "Today" },
              { id: "YESTERDAY", label: "Yesterday" },
              { id: "LAST_7_DAYS", label: "Last 7 Days" },
              { id: "THIS_MONTH", label: "This Month" },
              { id: "LAST_MONTH", label: "Last Month" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  activePreset === p.id
                    ? "bg-accent text-white shadow-xs"
                    : "bg-surface-2 text-ink hover:bg-surface-hi border border-line"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Pickers */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setActivePreset("CUSTOM");
                }}
                className="text-xs py-1 px-2 rounded border border-line bg-surface-2 text-ink"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted">To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setActivePreset("CUSTOM");
                }}
                className="text-xs py-1 px-2 rounded border border-line bg-surface-2 text-ink"
              />
            </div>
            <button
              onClick={() => reload()}
              className="btn text-xs py-1 px-2.5 bg-surface-2 hover:bg-surface-hi"
              title="Refresh Statement"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Second Row: Hub, Category, Search, Export */}
        <div className="flex flex-col sm:flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {portalRole === "ADMIN" && (
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="text-xs py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
              >
                <option value="">🏢 All Hubs / Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            )}

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
            >
              <option value="">📂 All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="🔍 Search SKU / Name / Barcode…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs py-1.5 px-3 rounded border border-line bg-surface-2 text-ink w-48 lg:w-64"
            />
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={exportCSV}
              disabled={filteredItems.length === 0}
              className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 bg-surface-2 hover:bg-surface-hi border border-line font-medium"
            >
              <span>📥</span> Export Statement CSV
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Analytics Summary KPI Cards */}
      {loading ? (
        <SkeletonStats count={6} />
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Opening Stock */}
          <div className="card p-3 bg-surface border border-line space-y-1">
            <div className="text-[11px] font-medium text-muted">Opening Stock</div>
            <div className="text-base font-bold text-ink">
              ₹{Math.round(summary.totalOpeningCostValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted flex justify-between">
              <span>{Math.round(summary.totalOpeningQty).toLocaleString()} units</span>
              <span>Wholesale: ₹{Math.round(summary.totalOpeningWholesaleValuation).toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* 2. Inward Receipts */}
          <div className="card p-3 bg-good/5 border border-good/20 space-y-1">
            <div className="text-[11px] font-medium text-good">Inward Inflow (+)</div>
            <div className="text-base font-bold text-good">
              +₹{Math.round(summary.totalInwardCostValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted">
              +{Math.round(summary.totalInwardQty).toLocaleString()} units received
            </div>
          </div>

          {/* 3. Outward Dispatches / Sales */}
          <div className="card p-3 bg-accent/5 border border-accent/20 space-y-1">
            <div className="text-[11px] font-medium text-accent">Outward Sales (-)</div>
            <div className="text-base font-bold text-accent">
              -₹{Math.round(summary.totalOutwardCostValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted flex justify-between">
              <span>-{Math.round(summary.totalOutwardQty).toLocaleString()} units</span>
              <span>Sales: ₹{Math.round(summary.totalOutwardSalesValuation).toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* 4. Damaged / Wastage Loss */}
          <div className="card p-3 bg-bad/5 border border-bad/20 space-y-1">
            <div className="text-[11px] font-medium text-bad">Damaged / Wastage (-)</div>
            <div className="text-base font-bold text-bad">
              ₹{Math.round(summary.totalDamagedCostValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted">
              {Math.round(summary.totalDamagedQty).toLocaleString()} units write-off
            </div>
          </div>

          {/* 5. Closing Stock */}
          <div className="card p-3 bg-surface border border-line space-y-1">
            <div className="text-[11px] font-medium text-muted">Closing Stock</div>
            <div className="text-base font-bold text-ink">
              ₹{Math.round(summary.totalClosingCostValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted flex justify-between">
              <span>{Math.round(summary.totalClosingQty).toLocaleString()} units</span>
              <span>Wholesale: ₹{Math.round(summary.totalClosingWholesaleValuation).toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* 6. Net Flow & Turnover */}
          <div className="card p-3 bg-surface-2 border border-line space-y-1">
            <div className="text-[11px] font-medium text-muted">Net Stock Flow</div>
            <div
              className={`text-base font-bold ${
                summary.netStockChangeValuation >= 0 ? "text-good" : "text-bad"
              }`}
            >
              {summary.netStockChangeValuation >= 0 ? "+" : ""}
              ₹{Math.round(summary.netStockChangeValuation).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-muted flex justify-between">
              <span>
                {summary.netStockChangeQty >= 0 ? "+" : ""}
                {Math.round(summary.netStockChangeQty).toLocaleString()} units
              </span>
              <span className="font-semibold text-accent">Turnover: {summary.turnoverRatio}x</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Statement Table */}
      {loading ? (
        <SkeletonTable rows={10} cols={9} />
      ) : (
        <div className="card p-0 overflow-x-auto border border-line">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-muted uppercase tracking-wider text-[10px]">
                <th
                  onClick={() => {
                    setSortBy("sku");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 cursor-pointer hover:text-ink font-semibold"
                >
                  SKU / Name {sortBy === "sku" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="py-2.5 px-3 text-right font-semibold">Cost Rate</th>
                <th
                  onClick={() => {
                    setSortBy("openingQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold bg-surface-3/30"
                >
                  Opening Stock {sortBy === "openingQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  onClick={() => {
                    setSortBy("inwardQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold text-good bg-good/5"
                >
                  Inward (+) {sortBy === "inwardQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  onClick={() => {
                    setSortBy("outwardQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold text-accent bg-accent/5"
                >
                  Outward (-) {sortBy === "outwardQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  onClick={() => {
                    setSortBy("damagedQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold text-bad bg-bad/5"
                >
                  Damage (-) {sortBy === "damagedQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="py-2.5 px-3 text-right font-semibold">Adj (±)</th>
                <th
                  onClick={() => {
                    setSortBy("closingQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold bg-surface-3/30"
                >
                  Closing Stock {sortBy === "closingQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th
                  onClick={() => {
                    setSortBy("netChangeQty");
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  }}
                  className="py-2.5 px-3 text-right cursor-pointer hover:text-ink font-semibold"
                >
                  Net Flow {sortBy === "netChangeQty" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="py-2.5 px-3 text-center font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No stock movements or products matching the criteria for the selected period.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-2/60 transition-colors">
                    {/* SKU & Name */}
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-ink">{item.name}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="font-mono text-accent">{item.sku}</span>
                        <span>•</span>
                        <span>{item.category}</span>
                      </div>
                    </td>

                    {/* Cost Rate */}
                    <td className="py-2.5 px-3 text-right font-mono text-muted">
                      ₹{item.costPrice.toFixed(2)}
                      <div className="text-[10px] text-muted/70">per {item.baseUnit.symbol}</div>
                    </td>

                    {/* Opening Stock */}
                    <td className="py-2.5 px-3 text-right font-mono bg-surface-3/10">
                      <div className="font-semibold text-ink">
                        {item.openingQty.toLocaleString()} {item.baseUnit.symbol}
                      </div>
                      <div className="text-[10px] text-muted">
                        ₹{Math.round(item.openingCostValuation).toLocaleString("en-IN")}
                      </div>
                    </td>

                    {/* Inward (+) */}
                    <td className="py-2.5 px-3 text-right font-mono bg-good/5">
                      <div className="font-semibold text-good">
                        {item.inwardQty > 0 ? `+${item.inwardQty.toLocaleString()}` : "0"} {item.baseUnit.symbol}
                      </div>
                      {item.inwardQty > 0 && (
                        <div className="text-[10px] text-good/80">
                          +₹{Math.round(item.inwardCostValuation).toLocaleString("en-IN")}
                        </div>
                      )}
                    </td>

                    {/* Outward (-) */}
                    <td className="py-2.5 px-3 text-right font-mono bg-accent/5">
                      <div className="font-semibold text-accent">
                        {item.outwardQty > 0 ? `-${item.outwardQty.toLocaleString()}` : "0"} {item.baseUnit.symbol}
                      </div>
                      {item.outwardQty > 0 && (
                        <div className="text-[10px] text-accent/80">
                          -₹{Math.round(item.outwardCostValuation).toLocaleString("en-IN")}
                        </div>
                      )}
                    </td>

                    {/* Damage (-) */}
                    <td className="py-2.5 px-3 text-right font-mono bg-bad/5">
                      <div className="font-semibold text-bad">
                        {item.damagedQty > 0 ? `-${item.damagedQty.toLocaleString()}` : "0"} {item.baseUnit.symbol}
                      </div>
                      {item.damagedQty > 0 && (
                        <div className="text-[10px] text-bad/80">
                          -₹{Math.round(item.damagedCostValuation).toLocaleString("en-IN")}
                        </div>
                      )}
                    </td>

                    {/* Adjustment (±) */}
                    <td className="py-2.5 px-3 text-right font-mono text-muted">
                      {item.adjustmentQty !== 0 ? (
                        <span className={item.adjustmentQty > 0 ? "text-good" : "text-bad"}>
                          {item.adjustmentQty > 0 ? `+${item.adjustmentQty}` : item.adjustmentQty}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>

                    {/* Closing Stock */}
                    <td className="py-2.5 px-3 text-right font-mono bg-surface-3/10">
                      <div className="font-semibold text-ink">
                        {item.closingQty.toLocaleString()} {item.baseUnit.symbol}
                      </div>
                      <div className="text-[10px] text-muted">
                        ₹{Math.round(item.closingCostValuation).toLocaleString("en-IN")}
                      </div>
                    </td>

                    {/* Net Flow */}
                    <td className="py-2.5 px-3 text-right font-mono">
                      <div
                        className={`font-semibold ${
                          item.netChangeQty > 0
                            ? "text-good"
                            : item.netChangeQty < 0
                            ? "text-bad"
                            : "text-muted"
                        }`}
                      >
                        {item.netChangeQty > 0 ? `+${item.netChangeQty}` : item.netChangeQty} {item.baseUnit.symbol}
                      </div>
                      <div className="text-[10px] text-muted">
                        {item.netChangeCostValuation >= 0 ? "+" : ""}
                        ₹{Math.round(item.netChangeCostValuation).toLocaleString("en-IN")}
                      </div>
                    </td>

                    {/* Movement Details Action */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => setSelectedProductBreakdown(item)}
                        className="text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink font-medium"
                      >
                        Breakdown
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Movement Breakdown Modal */}
      {selectedProductBreakdown && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelectedProductBreakdown(null)}
        >
          <div
            className="card w-full max-w-lg space-y-3 bg-surface border border-line"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  Stock Movement Breakdown: {selectedProductBreakdown.name}
                </h3>
                <div className="text-xs text-muted font-mono">{selectedProductBreakdown.sku}</div>
              </div>
              <button
                onClick={() => setSelectedProductBreakdown(null)}
                className="text-muted hover:text-ink font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-surface-2 border border-line">
                <div className="text-muted text-[10px]">Opening Stock</div>
                <div className="font-bold text-ink text-sm">
                  {selectedProductBreakdown.openingQty} {selectedProductBreakdown.baseUnit.symbol}
                </div>
                <div className="text-muted text-[10px]">
                  ₹{Math.round(selectedProductBreakdown.openingCostValuation).toLocaleString("en-IN")}
                </div>
              </div>

              <div className="p-2 rounded bg-surface-2 border border-line">
                <div className="text-muted text-[10px]">Closing Stock</div>
                <div className="font-bold text-ink text-sm">
                  {selectedProductBreakdown.closingQty} {selectedProductBreakdown.baseUnit.symbol}
                </div>
                <div className="text-muted text-[10px]">
                  ₹{Math.round(selectedProductBreakdown.closingCostValuation).toLocaleString("en-IN")}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <h4 className="text-xs font-semibold text-ink">Movements in Selected Period:</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {Object.keys(selectedProductBreakdown.movementBreakdown).length === 0 ? (
                  <div className="text-xs text-muted italic p-2 bg-surface-2 rounded text-center">
                    No specific transaction records found in this date range.
                  </div>
                ) : (
                  Object.entries(selectedProductBreakdown.movementBreakdown).map(([type, qty]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between p-2 rounded bg-surface-2 border border-line text-xs font-mono"
                    >
                      <span className="font-semibold text-ink">{type}</span>
                      <span className="text-accent font-bold">
                        {qty} {selectedProductBreakdown.baseUnit.symbol}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <button
                onClick={() => setSelectedProductBreakdown(null)}
                className="btn text-xs py-1.5 px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
