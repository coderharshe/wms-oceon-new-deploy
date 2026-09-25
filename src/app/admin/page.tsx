"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type AdminDashboardData = {
  period: string;
  totalOrders: number;
  totalBills: number;
  totalSales: number;
  aov: number;
  grossMargin: number;
  cashCollected: number;
  upiCollected: number;
  refunds: number;
  outstandingReceivables: number;
  totalPurchases: number;
  totalPayables: number;
  totalExpenses: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStockItems: { product: string; sku: string; warehouse: string; onHand: string; minStock: string }[];
  qcAdjustments: number;
  activeWarehouses: number;
  warehousesList: { id: string; name: string; code: string }[];
  totalPendingApprovals: number;
};

export default function AdminDashboardPage() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "all">("30d");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");

  const url = `/api/admin/dashboard?period=${period}${selectedWarehouse ? `&warehouseId=${selectedWarehouse}` : ""}`;
  const { data: d, error, loading, reload } = useApiGet<AdminDashboardData>(url);

  if (loading) return <SkeletonStats count={12} />;
  if (error && !d) return <ErrorRetry message={error} onRetry={reload} />;
  if (!d) return null;

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Executive Consolidated Dashboard (ADM-01)</h1>
          <p className="text-xs text-muted">Complete single-screen view of Sales, Purchases, Cash/Bank, Inventory & Approvals.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="inline-flex rounded-md shadow-sm border border-border bg-card p-0.5 text-xs">
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
            <option value="">All Warehouses ({d.activeWarehouses})</option>
            {d.warehousesList?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>

          <button onClick={reload} className="btn-secondary text-xs py-1 px-2">
            Refresh
          </button>
        </div>
      </div>

      {/* Quick Action Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/admin/approvals"
          className="card bg-gradient-to-r from-amber-50 to-amber-100/50 border-amber-300 p-4 flex items-center justify-between hover:shadow transition"
        >
          <div>
            <div className="text-xs font-bold text-amber-900 uppercase">⚡ Approvals Hub</div>
            <div className="text-base font-bold text-amber-950 mt-0.5">
              {d.totalPendingApprovals} Items Requiring Sir / Admin Approval
            </div>
            <p className="text-xs text-amber-800">POs &gt; ₹50k, Discounts &gt; 5%, Variances & Vouchers</p>
          </div>
          <span className="btn-primary text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold">Review →</span>
        </Link>

        <Link
          href="/admin/alerts"
          className="card bg-gradient-to-r from-rose-50 to-rose-100/50 border-rose-300 p-4 flex items-center justify-between hover:shadow transition"
        >
          <div>
            <div className="text-xs font-bold text-rose-900 uppercase">🚨 Executive Alert Center</div>
            <div className="text-base font-bold text-rose-950 mt-0.5">
              {d.outOfStockCount} OOS SKUs · {d.lowStockCount} Low Stock SKUs
            </div>
            <p className="text-xs text-rose-800">Cash mismatches, overdue payables & system notices</p>
          </div>
          <span className="btn-primary text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold">Inspect →</span>
        </Link>
      </div>

      {/* Sales & Revenue Grid */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted tracking-wider">Sales & Revenue Performance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card">
            <div className="text-xs text-muted">Total Sales</div>
            <div className="text-xl font-bold text-primary">₹{d.totalSales.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-1">{d.totalBills} Bills generated</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Average Order Value (AOV)</div>
            <div className="text-xl font-bold">₹{d.aov.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-1">{d.totalOrders} Total orders</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Gross Margin</div>
            <div className="text-xl font-bold text-emerald-600">{d.grossMargin.toFixed(1)}%</div>
            <div className="text-xs text-muted mt-1">Purchases: ₹{d.totalPurchases.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">To Collect (Receivables)</div>
            <div className="text-xl font-bold text-amber-600">₹{d.outstandingReceivables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-1">Unpaid customer balances</div>
          </div>
        </div>
      </div>

      {/* Cash, Bank & Collections */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted tracking-wider">Collections & Financial Flow</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card">
            <div className="text-xs text-muted">Cash Collected</div>
            <div className="text-lg font-semibold">₹{d.cashCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">UPI Collected</div>
            <div className="text-lg font-semibold">₹{d.upiCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Refunds Issued</div>
            <div className="text-lg font-semibold text-rose-600">₹{d.refunds.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Operating Expenses</div>
            <div className="text-lg font-semibold text-amber-600">₹{d.totalExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      {/* Inventory & Warehousing */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted tracking-wider">Inventory & Operations Health</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card">
            <div className="text-xs text-muted">Total Stock Valuation</div>
            <div className="text-xl font-bold">₹{d.inventoryValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-1">Wholesale cost basis</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Out of Stock (0 Qty)</div>
            <div className="text-xl font-bold text-rose-600">{d.outOfStockCount} SKUs</div>
            <div className="text-xs text-muted mt-1">Procurement required</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Low Stock Warnings</div>
            <div className="text-xl font-bold text-amber-600">{d.lowStockCount} SKUs</div>
            <div className="text-xs text-muted mt-1">Below min stock level</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">QC Adjustments</div>
            <div className="text-xl font-bold">{d.qcAdjustments}</div>
            <div className="text-xs text-muted mt-1">Physical picking audits</div>
          </div>
        </div>
      </div>

      {/* Critical Low Stock Table */}
      {d.lowStockItems.length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Critical Stock Items Below Reorder Level</h2>
            <Link href="/procurement/requisitions" className="text-xs text-primary font-semibold hover:underline">
              Generate Purchase Requisition →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2">SKU</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Current Stock</th>
                  <th>Min Stock Threshold</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.lowStockItems.map((i, idx) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="py-2 font-mono text-xs">{i.sku}</td>
                    <td className="font-semibold">{i.product}</td>
                    <td>{i.warehouse}</td>
                    <td className="font-bold">{i.onHand}</td>
                    <td>{i.minStock}</td>
                    <td>
                      <span className={`badge text-xs font-bold px-2 py-0.5 ${Number(i.onHand) <= 0 ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                        {Number(i.onHand) <= 0 ? "OUT OF STOCK" : "LOW STOCK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
