"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";
import { fmtDate } from "@/lib/fmt";

type ExpiredItem = {
  id: string;
  batchNumber: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  costRate: number;
  valuation: number;
  expiryDate: string;
  mfgDate: string | null;
  daysOverdue: number;
  warehouseName: string;
  warehouseCode: string;
};

type NearExpiryItem = {
  id: string;
  batchNumber: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  costRate: number;
  valuation: number;
  expiryDate: string;
  mfgDate: string | null;
  daysRemaining: number;
  warehouseName: string;
  warehouseCode: string;
  urgency: "CRITICAL" | "HIGH" | "MEDIUM";
};

type StockAlertItem = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  minStock: number;
  shortage?: number;
  warehouseName: string;
  wholesalePrice: number;
};

type InventoryDashboardData = {
  summary: {
    totalSkus: number;
    totalQuantity: number;
    totalValuation: number;
    lowStockCount: number;
    oosCount: number;
    expiredCount: number;
    expiredValuation: number;
    nearExpiryCount: number;
    nearExpiryValuation: number;
    todayInward: number;
    todayOutward: number;
  };
  lowStockList: StockAlertItem[];
  oosList: StockAlertItem[];
  expiredList: ExpiredItem[];
  nearExpiryList: NearExpiryItem[];
};

export default function InventoryDashboardPage() {
  const [activeTab, setActiveTab] = useState<"near_expiry" | "expired" | "low_stock" | "oos">("near_expiry");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, loading, error, reload } = useApiGet<InventoryDashboardData>("/api/inventory/dashboard");

  const summary = data?.summary || {
    totalSkus: 0,
    totalQuantity: 0,
    totalValuation: 0,
    lowStockCount: 0,
    oosCount: 0,
    expiredCount: 0,
    expiredValuation: 0,
    nearExpiryCount: 0,
    nearExpiryValuation: 0,
    todayInward: 0,
    todayOutward: 0,
  };

  const expiredList = data?.expiredList ?? [];
  const nearExpiryList = data?.nearExpiryList ?? [];
  const lowStockList = data?.lowStockList ?? [];
  const oosList = data?.oosList ?? [];

  // Filtered near-expiry items
  const filteredNearExpiry = useMemo(() => {
    if (!searchQuery.trim()) return nearExpiryList;
    const q = searchQuery.toLowerCase().trim();
    return nearExpiryList.filter(
      (it) =>
        it.productName.toLowerCase().includes(q) ||
        it.sku.toLowerCase().includes(q) ||
        it.batchNumber.toLowerCase().includes(q)
    );
  }, [nearExpiryList, searchQuery]);

  // Filtered expired items
  const filteredExpired = useMemo(() => {
    if (!searchQuery.trim()) return expiredList;
    const q = searchQuery.toLowerCase().trim();
    return expiredList.filter(
      (it) =>
        it.productName.toLowerCase().includes(q) ||
        it.sku.toLowerCase().includes(q) ||
        it.batchNumber.toLowerCase().includes(q)
    );
  }, [expiredList, searchQuery]);

  // Filtered low stock items
  const filteredLowStock = useMemo(() => {
    if (!searchQuery.trim()) return lowStockList;
    const q = searchQuery.toLowerCase().trim();
    return lowStockList.filter(
      (it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
    );
  }, [lowStockList, searchQuery]);

  // Filtered OOS items
  const filteredOos = useMemo(() => {
    if (!searchQuery.trim()) return oosList;
    const q = searchQuery.toLowerCase().trim();
    return oosList.filter(
      (it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
    );
  }, [oosList, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Inventory Dashboard</h1>
          <p className="text-xs text-muted mt-0.5">
            Real-time stock valuation, expiry monitoring, near-expiry alerts, and batch health
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/inventory/ledger" className="btn text-xs font-semibold flex items-center gap-1">
            📑 Inventory Ledger
          </Link>
          <Link href="/inventory/grn" className="btn-primary text-xs font-semibold flex items-center gap-1">
            📥 Inward (GRN)
          </Link>
          <Link href="/inventory/count" className="btn text-xs font-medium flex items-center gap-1">
            🔎 Physical Count
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      {loading && !data ? (
        <SkeletonStats count={6} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Total Valuation */}
          <div className="card bg-gradient-to-br from-surface to-surface-2 border-line">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Total Stock Value
            </div>
            <div className="text-lg font-bold text-ink mt-1 font-mono">
              ₹{summary.totalValuation.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">{summary.totalSkus} Active SKUs</div>
          </div>

          {/* Near Expiry (< 60 Days) */}
          <div
            onClick={() => setActiveTab("near_expiry")}
            className={`card cursor-pointer transition-all hover:scale-[1.01] ${
              activeTab === "near_expiry"
                ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-500/20"
                : "border-line bg-surface"
            }`}
          >
            <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wider flex items-center justify-between">
              <span>⏳ Near Expiry</span>
              {activeTab === "near_expiry" && <span className="text-[9px] font-bold">VIEW</span>}
            </div>
            <div className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1 font-mono">
              {summary.nearExpiryCount}
            </div>
            <div className="text-[10px] text-muted mt-0.5 truncate" title={`₹${summary.nearExpiryValuation.toLocaleString("en-IN")} at risk`}>
              ₹{summary.nearExpiryValuation.toLocaleString("en-IN", { maximumFractionDigits: 0 })} at risk
            </div>
          </div>

          {/* Expired Stock */}
          <div
            onClick={() => setActiveTab("expired")}
            className={`card cursor-pointer transition-all hover:scale-[1.01] ${
              activeTab === "expired"
                ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 ring-2 ring-rose-500/20"
                : "border-line bg-surface"
            }`}
          >
            <div className="text-[11px] font-semibold text-rose-800 dark:text-rose-400 uppercase tracking-wider flex items-center justify-between">
              <span>☠️ Expired Stock</span>
              {activeTab === "expired" && <span className="text-[9px] font-bold">VIEW</span>}
            </div>
            <div className="text-xl font-bold text-rose-700 dark:text-rose-300 mt-1 font-mono">
              {summary.expiredCount}
            </div>
            <div className="text-[10px] text-muted mt-0.5 truncate" title={`₹${summary.expiredValuation.toLocaleString("en-IN")} loss`}>
              ₹{summary.expiredValuation.toLocaleString("en-IN", { maximumFractionDigits: 0 })} loss
            </div>
          </div>

          {/* Low Stock Items */}
          <div
            onClick={() => setActiveTab("low_stock")}
            className={`card cursor-pointer transition-all hover:scale-[1.01] ${
              activeTab === "low_stock"
                ? "border-orange-500 bg-orange-50/50 dark:bg-orange-950/20 ring-2 ring-orange-500/20"
                : "border-line bg-surface"
            }`}
          >
            <div className="text-[11px] font-semibold text-orange-800 dark:text-orange-400 uppercase tracking-wider flex items-center justify-between">
              <span>⚠️ Low Stock</span>
              {activeTab === "low_stock" && <span className="text-[9px] font-bold">VIEW</span>}
            </div>
            <div className="text-xl font-bold text-orange-700 dark:text-orange-300 mt-1 font-mono">
              {summary.lowStockCount}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Below reorder level</div>
          </div>

          {/* Out of Stock (OOS) */}
          <div
            onClick={() => setActiveTab("oos")}
            className={`card cursor-pointer transition-all hover:scale-[1.01] ${
              activeTab === "oos"
                ? "border-red-500 bg-red-50/50 dark:bg-red-950/20 ring-2 ring-red-500/20"
                : "border-line bg-surface"
            }`}
          >
            <div className="text-[11px] font-semibold text-red-800 dark:text-red-400 uppercase tracking-wider flex items-center justify-between">
              <span>🚫 Out of Stock</span>
              {activeTab === "oos" && <span className="text-[9px] font-bold">VIEW</span>}
            </div>
            <div className="text-xl font-bold text-red-700 dark:text-red-300 mt-1 font-mono">
              {summary.oosCount}
            </div>
            <div className="text-[10px] text-muted mt-0.5">0 quantity on hand</div>
          </div>

          {/* Today Activity */}
          <div className="card bg-surface border-line">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              Today Activity
            </div>
            <div className="text-xs font-mono font-bold text-ink mt-1.5 space-y-1">
              <div className="text-emerald-700 flex justify-between">
                <span>Inward (GRN):</span>
                <span>+{summary.todayInward}</span>
              </div>
              <div className="text-rose-700 flex justify-between">
                <span>Outward:</span>
                <span>-{summary.todayOutward}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expiry & Critical Stock Management Section */}
      <div className="card space-y-3 border-line shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
          <div className="flex flex-wrap items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
            <button
              onClick={() => setActiveTab("near_expiry")}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "near_expiry"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>⏳ Near-Expiry Stock</span>
              <span className="badge text-[10px] bg-black/20 text-white px-1.5 py-0.2">
                {nearExpiryList.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("expired")}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "expired"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>☠️ Expired Stock</span>
              <span className="badge text-[10px] bg-black/20 text-white px-1.5 py-0.2">
                {expiredList.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("low_stock")}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "low_stock"
                  ? "bg-orange-600 text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>⚠️ Low Stock</span>
              <span className="badge text-[10px] bg-black/20 text-white px-1.5 py-0.2">
                {lowStockList.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("oos")}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "oos"
                  ? "bg-red-700 text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>🚫 Out of Stock</span>
              <span className="badge text-[10px] bg-black/20 text-white px-1.5 py-0.2">
                {oosList.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search product, SKU, batch…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input text-xs py-1 px-2.5 w-48 sm:w-60"
            />
            <button onClick={reload} className="btn text-xs px-2 py-1 font-medium" title="Refresh">
              🔄
            </button>
          </div>
        </div>

        {error && <ErrorRetry message={error} onRetry={reload} />}

        {/* 1. Near Expiry Table */}
        {activeTab === "near_expiry" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 font-mono">SKU</th>
                  <th className="py-2.5 px-3 font-mono">Batch Number</th>
                  <th className="py-2.5 px-3 text-center">Urgency / Expiry Alert</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3 text-right">Quantity On Hand</th>
                  <th className="py-2.5 px-3 text-right">Stock Valuation</th>
                  <th className="py-2.5 px-3">Hub / Warehouse</th>
                  <th className="py-2.5 px-3 text-right">Recommended Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 bg-surface">
                {filteredNearExpiry.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-xs text-muted">
                      {nearExpiryList.length === 0
                        ? "🎉 No stock is nearing expiry in the next 60 days. All batch inventory is fresh!"
                        : "No items match your search."}
                    </td>
                  </tr>
                ) : (
                  filteredNearExpiry.map((it) => (
                    <tr key={it.id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-ink">{it.productName}</td>
                      <td className="py-2.5 px-3 font-mono text-muted font-bold">{it.sku}</td>
                      <td className="py-2.5 px-3 font-mono text-ink">
                        <span className="badge text-[10px] bg-surface-2 border border-line font-bold">
                          {it.batchNumber}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`badge text-[10px] font-bold ${
                            it.urgency === "CRITICAL"
                              ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 animate-pulse"
                              : it.urgency === "HIGH"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300"
                          }`}
                        >
                          ⏳ Expires in {it.daysRemaining} days
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-ink">
                        {fmtDate(it.expiryDate)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                        {it.quantity} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700 dark:text-amber-400">
                        ₹{it.valuation.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {it.warehouseName} ({it.warehouseCode})
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        <Link
                          href="/inventory/outward"
                          className="btn-secondary text-[11px] px-2 py-0.5 font-medium"
                          title="Issue or discount for quick clearance"
                        >
                          ⚡ Priority Clearance
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 2. Expired Stock Table */}
        {activeTab === "expired" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-rose-700 text-white font-bold border-b border-rose-800">
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 font-mono">SKU</th>
                  <th className="py-2.5 px-3 font-mono">Batch Number</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3 text-right">Quantity On Hand</th>
                  <th className="py-2.5 px-3 text-right">Loss Valuation</th>
                  <th className="py-2.5 px-3">Hub / Warehouse</th>
                  <th className="py-2.5 px-3 text-right">Mandatory Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 bg-surface">
                {filteredExpired.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-xs text-muted">
                      {expiredList.length === 0
                        ? "✅ Excellent! There is zero expired stock sitting in any hub."
                        : "No expired items match your search."}
                    </td>
                  </tr>
                ) : (
                  filteredExpired.map((it) => (
                    <tr key={it.id} className="bg-rose-500/5 hover:bg-rose-500/10 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-ink">{it.productName}</td>
                      <td className="py-2.5 px-3 font-mono text-muted font-bold">{it.sku}</td>
                      <td className="py-2.5 px-3 font-mono text-ink">
                        <span className="badge text-[10px] bg-surface-2 border border-line font-bold">
                          {it.batchNumber}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="badge text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                          ☠️ Expired ({it.daysOverdue}d overdue)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-rose-700">
                        {fmtDate(it.expiryDate)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                        {it.quantity} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-800 dark:text-rose-300">
                        ₹{it.valuation.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {it.warehouseName} ({it.warehouseCode})
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        <Link
                          href="/inventory/outward"
                          className="btn-primary text-[11px] px-2.5 py-1 font-semibold bg-rose-600 hover:bg-rose-700"
                        >
                          🗑️ Move to Damage / Dispose
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. Low Stock Table */}
        {activeTab === "low_stock" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 font-mono">SKU</th>
                  <th className="py-2.5 px-3 text-right">Current Stock</th>
                  <th className="py-2.5 px-3 text-right">Min Reorder Level</th>
                  <th className="py-2.5 px-3 text-right font-bold text-amber-200">Shortage</th>
                  <th className="py-2.5 px-3 text-right">Wholesale Rate</th>
                  <th className="py-2.5 px-3">Hub / Warehouse</th>
                  <th className="py-2.5 px-3 text-right">Reorder Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 bg-surface">
                {filteredLowStock.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-xs text-muted">
                      No low stock alerts. All inventory levels are above minimum reorder threshold.
                    </td>
                  </tr>
                ) : (
                  filteredLowStock.map((it) => (
                    <tr key={it.id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-ink">{it.name}</td>
                      <td className="py-2.5 px-3 font-mono text-muted font-bold">{it.sku}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600">
                        {it.quantity} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-muted">
                        {it.minStock} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                        -{it.shortage} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-ink">
                        ₹{it.wholesalePrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-muted">{it.warehouseName}</td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          href="/inventory/grn"
                          className="btn-primary text-[11px] px-2.5 py-1 font-semibold"
                        >
                          📦 Reorder via GRN
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. Out of Stock Table */}
        {activeTab === "oos" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-red-700 text-white font-bold border-b border-red-800">
                  <th className="py-2.5 px-3">Product Name</th>
                  <th className="py-2.5 px-3 font-mono">SKU</th>
                  <th className="py-2.5 px-3 text-right">Current Stock</th>
                  <th className="py-2.5 px-3 text-right">Min Stock Needed</th>
                  <th className="py-2.5 px-3 text-right">Wholesale Rate</th>
                  <th className="py-2.5 px-3">Hub / Warehouse</th>
                  <th className="py-2.5 px-3 text-right">Immediate Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 bg-surface">
                {filteredOos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-xs text-muted">
                      No products are out of stock.
                    </td>
                  </tr>
                ) : (
                  filteredOos.map((it) => (
                    <tr key={it.id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-ink">{it.name}</td>
                      <td className="py-2.5 px-3 font-mono text-muted font-bold">{it.sku}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                        0 {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-muted">
                        {it.minStock} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-ink">
                        ₹{it.wholesalePrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-muted">{it.warehouseName}</td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          href="/inventory/grn"
                          className="btn-primary text-[11px] px-2.5 py-1 font-semibold"
                        >
                          📥 Inward Stock
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Operational Quick Links & Permissions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Inventory Operations</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/inventory/ledger" className="rounded border border-line p-3 hover:bg-surface-hi transition-colors">
              <div className="font-semibold text-sm">📑 Inventory Ledger</div>
              <div className="text-xs text-muted">Complete stock counts, dead stock & valuation</div>
            </Link>
            <Link href="/inventory/grn" className="rounded border border-line p-3 hover:bg-surface-hi transition-colors">
              <div className="font-semibold text-sm">📥 Inward / GRN</div>
              <div className="text-xs text-muted">Physical check & stock entry against PO</div>
            </Link>
            <Link href="/inventory/outward" className="rounded border border-line p-3 hover:bg-surface-hi transition-colors">
              <div className="font-semibold text-sm">📤 Stock Issue / Outward</div>
              <div className="text-xs text-muted">Dispatch, damage, return with mandatory reason</div>
            </Link>
            <Link href="/inventory/count" className="rounded border border-line p-3 hover:bg-surface-hi transition-colors">
              <div className="font-semibold text-sm">🔎 Physical Stock Count</div>
              <div className="text-xs text-muted">System vs physical audit & variance adjustments</div>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Inventory Permissions</h2>
          <ul className="text-xs space-y-1.5 text-muted">
            <li>✅ <strong>CAN:</strong> Receive stock, count stock, report damage, physical count, view expiry.</li>
            <li>❌ <strong>CANNOT:</strong> Change selling or purchase prices.</li>
            <li>❌ <strong>CANNOT:</strong> Make arbitrary unapproved stock adjustments.</li>
            <li>❌ <strong>CANNOT:</strong> Delete inventory history or financial transactions.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
