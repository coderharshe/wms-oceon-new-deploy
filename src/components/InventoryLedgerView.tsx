"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { EditProductModal } from "@/components/EditProductModal";
import { AddProductModal } from "@/components/AddProductModal";
import { UnitStockAdjustModal } from "@/components/UnitStockAdjustModal";
import { InventoryStatementView } from "@/components/InventoryStatementView";
import { fmtDate } from "@/lib/fmt";

export type LedgerItem = {
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
  onHand: number;
  reserved: number;
  available: number;
  minStock: number | null;
  maxStock: number | null;
  wholesalePrice: number;
  retailPrice: number;
  costPrice: number;
  taxPercent: number;
  wholesaleValuation: number;
  retailValuation: number;
  costValuation: number;
  status: "OUT_OF_STOCK" | "LOW_STOCK" | "DEAD_STOCK" | "OVERSTOCKED" | "HEALTHY";
  lastMovementDate: string;
  lastMovementType: string;
  daysSinceLastMovement: number;
  warehouseBreakdown: Array<{
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    onHand: number;
    reserved: number;
    available: number;
  }>;
  saleUnitsCount: number;
  saleUnits?: Array<{
    unitId: string;
    unit: { symbol: string };
    factorToBase: string;
    barcode: string | null;
    wholesalePrice: string | null;
    retailPrice: string | null;
  }>;
  imageKey: string | null;
};

type LedgerResponse = {
  summary: {
    totalSkus: number;
    totalUnitsOnHand: number;
    totalWholesaleValuation: number;
    totalRetailValuation: number;
    totalCostValuation: number;
    lowStockCount: number;
    outOfStockCount: number;
    deadStockCount: number;
    deadStockLockedCapital: number;
    overstockedCount: number;
    healthyCount: number;
    deadStockThresholdDays: number;
  };
  items: LedgerItem[];
  warehouses: Array<{ id: string; name: string; code: string }>;
  categories: string[];
};

export function InventoryLedgerView({
  defaultWarehouseId,
  portalRole = "ADMIN",
}: {
  defaultWarehouseId?: string;
  portalRole?: string;
}) {
  const [viewTab, setViewTab] = useState<"HEALTH" | "STATEMENT">("HEALTH");
  const [warehouseFilter, setWarehouseFilter] = useState(defaultWarehouseId || "");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [deadStockDays, setDeadStockDays] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<LedgerItem | null>(null);
  const [adjustingWhId, setAdjustingWhId] = useState<string | undefined>(undefined);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (warehouseFilter) qs.set("warehouseId", warehouseFilter);
  if (deadStockDays !== 30) qs.set("deadStockDays", deadStockDays.toString());

  const { data, error, loading, reload } = useApiGet<LedgerResponse>(
    `/api/admin/inventory-ledger?${qs.toString()}`
  );

  const items = data?.items ?? [];
  const summary = data?.summary;
  const warehouses = data?.warehouses ?? [];
  const categories = data?.categories ?? [];

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    let result = items;

    if (statusFilter !== "ALL") {
      result = result.filter((item) => item.status === statusFilter);
    }

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
      let valA: any = a[sortBy as keyof LedgerItem];
      let valB: any = b[sortBy as keyof LedgerItem];

      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [items, statusFilter, categoryFilter, searchQuery, sortBy, sortDir]);

  function handleSort(column: string) {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
  }

  function exportCSV() {
    if (!filteredItems.length) return;
    const headers = [
      "SKU",
      "Barcode",
      "Product Name",
      "Category",
      "Brand",
      "Base Unit",
      "Stock On Hand",
      "Reserved Stock",
      "Available Stock",
      "Min Stock",
      "Max Stock",
      "Status",
      "Wholesale Price (INR)",
      "Retail Price (INR)",
      "Cost Price (INR)",
      "Tax (%)",
      "Wholesale Valuation (INR)",
      "Retail Valuation (INR)",
      "Cost Valuation (INR)",
      "Last Movement Date",
      "Last Movement Type",
      "Days Since Movement",
    ];

    const rows = filteredItems.map((it) => [
      `"${it.sku}"`,
      `"${it.barcode || ""}"`,
      `"${it.name.replace(/"/g, '""')}"`,
      `"${it.category || ""}"`,
      `"${it.brand || ""}"`,
      `"${it.baseUnit.symbol}"`,
      `"${it.onHand}"`,
      `"${it.reserved}"`,
      `"${it.available}"`,
      `"${it.minStock ?? ""}"`,
      `"${it.maxStock ?? ""}"`,
      `"${it.status}"`,
      `"${it.wholesalePrice.toFixed(2)}"`,
      `"${it.retailPrice.toFixed(2)}"`,
      `"${it.costPrice.toFixed(2)}"`,
      `"${it.taxPercent}"`,
      `"${it.wholesaleValuation.toFixed(2)}"`,
      `"${it.retailValuation.toFixed(2)}"`,
      `"${it.costValuation.toFixed(2)}"`,
      `"${fmtDate(it.lastMovementDate)}"`,
      `"${it.lastMovementType}"`,
      `"${it.daysSinceLastMovement}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `inventory_ledger_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      {/* Sub-navigation Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewTab("HEALTH")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewTab === "HEALTH"
                ? "bg-accent text-white shadow-xs"
                : "bg-surface-2 text-ink hover:bg-surface-hi border border-line"
            }`}
          >
            📊 Stock Health & Valuation Ledger
          </button>
          <button
            onClick={() => setViewTab("STATEMENT")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewTab === "STATEMENT"
                ? "bg-accent text-white shadow-xs"
                : "bg-surface-2 text-ink hover:bg-surface-hi border border-line"
            }`}
          >
            📈 Opening & Closing Stock Statement (Analytics)
          </button>
        </div>
      </div>

      {/* Mode 2: Opening & Closing Stock Statement */}
      {viewTab === "STATEMENT" && (
        <InventoryStatementView
          defaultWarehouseId={warehouseFilter || defaultWarehouseId}
          portalRole={portalRole}
        />
      )}

      {/* Mode 1: Health & Dead Stock Ledger */}
      {viewTab === "HEALTH" && (
        <div className="space-y-4">
          {/* KPI Cards Summary */}
          {loading && !data ? (
            <SkeletonStats count={5} className="grid grid-cols-2 sm:grid-cols-5 gap-3" />
          ) : summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Total Valuation */}
              <div className="card bg-gradient-to-br from-surface to-surface-2 border-line flex flex-col justify-center">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                  Total Stock Valuation
                </div>
                <div className="text-xl font-bold text-ink mt-1 font-mono">
                  ₹{summary.totalWholesaleValuation.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              {/* Low Stock Warning */}
              <div
                onClick={() => setStatusFilter((prev) => (prev === "LOW_STOCK" ? "ALL" : "LOW_STOCK"))}
                className={`card cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-center ${
                  statusFilter === "LOW_STOCK"
                    ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-500/20"
                    : "border-line bg-surface"
                }`}
              >
                <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wider flex items-center justify-between">
                  <span>⚠️ Low Stock</span>
                  {statusFilter === "LOW_STOCK" && <span className="text-[10px] font-bold">ACTIVE</span>}
                </div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1 font-mono">
                  {summary.lowStockCount}
                </div>
              </div>

              {/* Dead Stock Warning */}
              <div
                onClick={() => setStatusFilter((prev) => (prev === "DEAD_STOCK" ? "ALL" : "DEAD_STOCK"))}
                className={`card cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-center ${
                  statusFilter === "DEAD_STOCK"
                    ? "border-purple-500 bg-purple-50/50 dark:bg-purple-950/20 ring-2 ring-purple-500/20"
                    : "border-line bg-surface"
                }`}
              >
                <div className="text-[11px] font-semibold text-purple-800 dark:text-purple-400 uppercase tracking-wider flex items-center justify-between">
                  <span>⏳ Dead Stock ({deadStockDays}d+)</span>
                  {statusFilter === "DEAD_STOCK" && <span className="text-[10px] font-bold">ACTIVE</span>}
                </div>
                <div className="text-2xl font-bold text-purple-700 dark:text-purple-300 mt-1 font-mono">
                  {summary.deadStockCount}
                </div>
              </div>

              {/* Out of Stock */}
              <div
                onClick={() => setStatusFilter((prev) => (prev === "OUT_OF_STOCK" ? "ALL" : "OUT_OF_STOCK"))}
                className={`card cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-center ${
                  statusFilter === "OUT_OF_STOCK"
                    ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 ring-2 ring-rose-500/20"
                    : "border-line bg-surface"
                }`}
              >
                <div className="text-[11px] font-semibold text-rose-800 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
                  <span>🚫 Out of Stock</span>
                  {statusFilter === "OUT_OF_STOCK" && <span className="text-[10px] font-bold">ACTIVE</span>}
                </div>
                <div className="text-2xl font-bold text-rose-700 dark:text-rose-300 mt-1 font-mono">
                  {summary.outOfStockCount}
                </div>
              </div>

              {/* Total Healthy SKUs */}
              <div
                onClick={() => setStatusFilter((prev) => (prev === "HEALTHY" ? "ALL" : "HEALTHY"))}
                className={`card cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-center ${
                  statusFilter === "HEALTHY"
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 ring-2 ring-emerald-500/20"
                    : "border-line bg-surface"
                }`}
              >
                <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider flex items-center justify-between">
                  <span>✅ Healthy Stock</span>
                  {statusFilter === "HEALTHY" && <span className="text-[10px] font-bold">ACTIVE</span>}
                </div>
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 font-mono">
                  {summary.healthyCount}
                </div>
              </div>
            </div>
          ) : null}

      {/* Control & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-surface-2/70 p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search SKU, name, barcode, category…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input text-xs w-full py-1.5 pl-7 pr-2"
            />
            <span className="absolute left-2.5 top-2 text-muted text-xs">🔍</span>
          </div>

          {/* Hub / Warehouse Selector */}
          {warehouses.length > 0 && portalRole === "ADMIN" && (
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="input text-xs py-1.5 px-2 font-medium"
            >
              <option value="">🏢 Global (All Hubs / Warehouses)</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>
          )}

          {/* Category Selector */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input text-xs py-1.5 px-2 font-medium"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Dead stock threshold dropdown */}
          <div className="flex items-center gap-1 bg-surface px-2 py-1 rounded border border-line text-xs">
            <span className="text-muted text-[11px]">Dead Stock:</span>
            <select
              value={deadStockDays}
              onChange={(e) => setDeadStockDays(parseInt(e.target.value, 10))}
              className="bg-transparent text-xs font-semibold text-ink border-none outline-none cursor-pointer"
            >
              <option value={7}>7+ Days</option>
              <option value={15}>15+ Days</option>
              <option value={30}>30+ Days</option>
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {(searchQuery || statusFilter !== "ALL" || categoryFilter || warehouseFilter) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("ALL");
                setCategoryFilter("");
                if (portalRole === "ADMIN") setWarehouseFilter("");
              }}
              className="text-xs text-accent hover:underline font-semibold px-2 py-1"
            >
              Reset Filters
            </button>
          )}
          <button
            onClick={() => setIsAddingProduct(true)}
            className="btn-primary text-xs px-3 py-1.5 font-semibold flex items-center gap-1.5 shadow-xs hover:brightness-105 transition-all"
            title="Add a brand new product to the master catalog"
          >
            <span>➕</span>
            <span>Add New Product</span>
          </button>
          <button
            onClick={exportCSV}
            disabled={filteredItems.length === 0}
            className="btn-secondary text-xs px-3 py-1.5 font-medium flex items-center gap-1 shadow-xs"
            title="Download full inventory ledger report as CSV"
          >
            📥 Export Ledger CSV
          </button>
          <button
            onClick={reload}
            className="btn text-xs px-2.5 py-1.5 font-medium flex items-center gap-1"
            title="Refresh inventory"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Stock Health Status Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-2 text-xs">
        <span className="text-[11px] font-bold text-muted uppercase mr-1">Status Filter:</span>
        <button
          onClick={() => setStatusFilter("ALL")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all ${
            statusFilter === "ALL"
              ? "bg-ink text-surface shadow-xs font-bold"
              : "bg-surface-2 text-muted hover:text-ink"
          }`}
        >
          All Items ({items.length})
        </button>
        <button
          onClick={() => setStatusFilter("LOW_STOCK")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
            statusFilter === "LOW_STOCK"
              ? "bg-amber-600 text-white font-bold shadow-xs"
              : "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:opacity-80"
          }`}
        >
          ⚠️ Low Stock ({summary?.lowStockCount ?? 0})
        </button>
        <button
          onClick={() => setStatusFilter("DEAD_STOCK")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
            statusFilter === "DEAD_STOCK"
              ? "bg-purple-600 text-white font-bold shadow-xs"
              : "bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 hover:opacity-80"
          }`}
        >
          ⏳ Dead Stock ({summary?.deadStockCount ?? 0})
        </button>
        <button
          onClick={() => setStatusFilter("OUT_OF_STOCK")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
            statusFilter === "OUT_OF_STOCK"
              ? "bg-rose-600 text-white font-bold shadow-xs"
              : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 hover:opacity-80"
          }`}
        >
          🚫 Out of Stock ({summary?.outOfStockCount ?? 0})
        </button>
        <button
          onClick={() => setStatusFilter("OVERSTOCKED")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
            statusFilter === "OVERSTOCKED"
              ? "bg-blue-600 text-white font-bold shadow-xs"
              : "bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 hover:opacity-80"
          }`}
        >
          📦 Overstocked ({summary?.overstockedCount ?? 0})
        </button>
        <button
          onClick={() => setStatusFilter("HEALTHY")}
          className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1 ${
            statusFilter === "HEALTHY"
              ? "bg-emerald-600 text-white font-bold shadow-xs"
              : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:opacity-80"
          }`}
        >
          ✅ Healthy ({summary?.healthyCount ?? 0})
        </button>

        <div className="ml-auto text-xs text-muted font-medium">
          Showing {filteredItems.length} of {items.length} SKUs
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Main Ledger Table */}
      {loading && !data ? (
        <SkeletonTable rows={10} cols={10} />
      ) : (
        <div className="card overflow-x-auto p-0 border border-line shadow-xs">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                <th
                  onClick={() => handleSort("name")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors"
                >
                  Product Name {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("sku")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors font-mono"
                >
                  SKU / Barcode {sortBy === "sku" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="py-2.5 px-3">Category</th>
                <th
                  onClick={() => handleSort("status")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors text-center"
                >
                  Stock Health {sortBy === "status" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("onHand")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors text-right"
                >
                  On Hand {sortBy === "onHand" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="py-2.5 px-3 text-right">Avail / Reserved</th>
                <th className="py-2.5 px-3 text-right">Min / Max</th>
                <th
                  onClick={() => handleSort("wholesalePrice")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors text-right"
                >
                  Wholesale ₹ {sortBy === "wholesalePrice" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("retailPrice")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors text-right"
                >
                  Retail ₹ {sortBy === "retailPrice" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("wholesaleValuation")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors text-right font-bold"
                >
                  Valuation ₹ {sortBy === "wholesaleValuation" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th
                  onClick={() => handleSort("daysSinceLastMovement")}
                  className="py-2.5 px-3 cursor-pointer hover:bg-[#0369a1] transition-colors"
                >
                  Last Movement {sortBy === "daysSinceLastMovement" && (sortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="py-2.5 px-3 text-center">Hubs</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 bg-surface">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-10 text-xs text-muted">
                    No inventory records match the selected filters or search query.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isExpanded = expandedRowId === item.id;
                  const isDeadStock = item.status === "DEAD_STOCK";
                  const isLowStock = item.status === "LOW_STOCK";
                  const isOOS = item.status === "OUT_OF_STOCK";

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-surface-2/60 transition-colors ${
                        isOOS
                          ? "bg-rose-500/5"
                          : isLowStock
                          ? "bg-amber-500/5"
                          : isDeadStock
                          ? "bg-purple-500/5"
                          : ""
                      }`}
                    >
                      {/* Product Name */}
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-ink flex items-center gap-1.5">
                          {item.name}
                          {!item.active && (
                            <span className="badge text-[9px] bg-muted/20 text-muted">Inactive</span>
                          )}
                        </div>
                        {item.brand && (
                          <div className="text-[10px] text-muted font-medium">Brand: {item.brand}</div>
                        )}
                      </td>

                      {/* SKU / Barcode */}
                      <td className="py-2.5 px-3 font-mono">
                        <div className="font-bold text-ink text-[11px]">{item.sku}</div>
                        {item.barcode ? (
                          <div className="text-[10px] text-muted flex items-center gap-1" title="Barcode">
                            <span>|||</span> {item.barcode}
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted/60 italic">No barcode</div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3 text-muted font-medium">
                        <span className="badge text-[10px] bg-surface-2 text-ink border border-line">
                          {item.category}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="py-2.5 px-3 text-center">
                        {item.status === "OUT_OF_STOCK" && (
                          <span className="badge text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                            🚫 Out of Stock
                          </span>
                        )}
                        {item.status === "LOW_STOCK" && (
                          <span className="badge text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            ⚠️ Low ({item.onHand}/{item.minStock})
                          </span>
                        )}
                        {item.status === "DEAD_STOCK" && (
                          <span
                            className="badge text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                            title={`No movement in ${item.daysSinceLastMovement} days`}
                          >
                            ⏳ Dead ({item.daysSinceLastMovement}d idle)
                          </span>
                        )}
                        {item.status === "OVERSTOCKED" && (
                          <span className="badge text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            📦 Overstocked ({item.onHand}/{item.maxStock})
                          </span>
                        )}
                        {item.status === "HEALTHY" && (
                          <span className="badge text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            ✅ Healthy
                          </span>
                        )}
                      </td>

                      {/* Quantity On Hand */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                        <span className={isOOS ? "text-rose-600" : isLowStock ? "text-amber-600" : "text-ink"}>
                          {item.onHand.toLocaleString("en-IN")}
                        </span>{" "}
                        <span className="text-[10px] text-muted font-normal">{item.baseUnit.symbol}</span>
                      </td>

                      {/* Avail / Reserved */}
                      <td className="py-2.5 px-3 text-right font-mono text-muted text-[11px]">
                        <span className="font-semibold text-ink">{item.available}</span>
                        {item.reserved > 0 && (
                          <span className="text-amber-600 ml-1">({item.reserved} res)</span>
                        )}
                      </td>

                      {/* Min / Max Stock */}
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] text-muted">
                        <span>{item.minStock != null ? item.minStock : "—"}</span>
                        {" / "}
                        <span>{item.maxStock != null ? item.maxStock : "—"}</span>
                      </td>

                      {/* Wholesale Price */}
                      <td className="py-2.5 px-3 text-right font-mono text-ink font-medium">
                        ₹{item.wholesalePrice.toFixed(2)}
                      </td>

                      {/* Retail Price */}
                      <td className="py-2.5 px-3 text-right font-mono text-muted">
                        ₹{item.retailPrice.toFixed(2)}
                      </td>

                      {/* Total Valuation */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                        ₹{item.wholesaleValuation.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Last Movement */}
                      <td className="py-2.5 px-3 text-muted text-[11px]">
                        <div>{fmtDate(item.lastMovementDate)}</div>
                        <div className="text-[10px] font-medium text-ink/70">
                          {item.lastMovementType} ({item.daysSinceLastMovement}d ago)
                        </div>
                      </td>

                      {/* Hub Breakdown Toggle */}
                      <td className="py-2.5 px-3 text-center">
                        {item.warehouseBreakdown.length > 0 ? (
                          <button
                            onClick={() => setExpandedRowId(isExpanded ? null : item.id)}
                            className="text-[11px] px-2 py-0.5 rounded bg-surface-2 text-ink hover:bg-surface-hi border border-line font-medium"
                            title="View Hub Distribution"
                          >
                            {item.warehouseBreakdown.length} {item.warehouseBreakdown.length === 1 ? "Hub" : "Hubs"} {isExpanded ? "▲" : "▼"}
                          </button>
                        ) : (
                          <span className="text-muted text-[11px]">0 Hubs</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setAdjustingWhId(warehouseFilter || undefined);
                              setAdjustingProduct(item);
                            }}
                            className="rounded px-2 py-1 text-xs font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors border border-accent/20"
                            title="Directly edit inventory by its units"
                          >
                            ⚖️ Adjust Units
                          </button>
                          <button
                            onClick={() => setEditingProduct(item)}
                            className="rounded px-2 py-1 text-xs font-semibold text-muted hover:text-ink hover:bg-surface-hi transition-colors"
                            title="Edit Product Master"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Hub Breakdown Expansion Drawer (if clicked) */}
      {expandedRowId && (
        <div className="card bg-surface-2 border border-line p-3 text-xs space-y-2">
          <div className="flex items-center justify-between border-b border-line pb-1.5 font-semibold text-ink">
            <span>
              🏬 Hub Stock Distribution for SKU:{" "}
              <strong className="font-mono text-accent">
                {items.find((x) => x.id === expandedRowId)?.sku}
              </strong>{" "}
              ({items.find((x) => x.id === expandedRowId)?.name})
            </span>
            <button
              onClick={() => setExpandedRowId(null)}
              className="text-muted hover:text-ink font-bold text-xs"
            >
              ✕ Close
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
            {items
              .find((x) => x.id === expandedRowId)
              ?.warehouseBreakdown.map((wh) => (
                <div
                  key={wh.warehouseId}
                  className="bg-surface p-2.5 rounded border border-line flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-bold text-ink">{wh.warehouseName}</div>
                    <div className="text-[10px] text-muted font-mono">{wh.warehouseCode}</div>
                  </div>
                  <div className="text-right font-mono flex flex-col items-end gap-1">
                    <div>
                      <span className="font-bold text-ink">{wh.onHand} on hand</span>
                      <span className="text-[10px] text-muted ml-1">({wh.available} avail)</span>
                    </div>
                    <button
                      onClick={() => {
                        const it = items.find((x) => x.id === expandedRowId);
                        if (it) {
                          setAdjustingWhId(wh.warehouseId);
                          setAdjustingProduct(it);
                        }
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 font-semibold border border-accent/20"
                    >
                      ⚖️ Adjust in this Hub
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Direct Unit Stock Adjust Modal */}
      {adjustingProduct && (
        <UnitStockAdjustModal
          product={adjustingProduct}
          warehouses={warehouses}
          selectedWarehouseId={adjustingWhId}
          onClose={() => {
            setAdjustingProduct(null);
            setAdjustingWhId(undefined);
          }}
          onSaved={() => {
            setAdjustingProduct(null);
            setAdjustingWhId(undefined);
            reload();
          }}
        />
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            reload();
          }}
        />
      )}

      {/* Add New Product Modal */}
      {isAddingProduct && (
        <AddProductModal
          onClose={() => setIsAddingProduct(false)}
          onCreated={() => {
            setIsAddingProduct(false);
            reload();
          }}
        />
      )}
        </div>
      )}
    </div>
  );
}
