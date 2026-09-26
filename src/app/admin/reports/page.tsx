"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtDate, fmtQty } from "@/lib/fmt";

const TABS = [
  { id: "sales", label: "Sales" },
  { id: "payments", label: "Payments" },
  { id: "inventory", label: "Inventory" },
  { id: "qc", label: "QC" },
  { id: "cash", label: "Cash" },
] as const;

type TabType = (typeof TABS)[number]["id"];

export default function ReportsPage() {
  const [tab, setTab] = useState<TabType>("sales");
  const [warehouseId, setWarehouseId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const { data: warehouses } = useApiGet<{ id: string; name: string }[]>("/api/admin/warehouses");

  const qs = new URLSearchParams({
    type: tab,
    ...(warehouseId ? { warehouseId } : {}),
  });
  const { data, error, loading, reload } = useApiGet<any>(`/api/admin/reports?${qs}`);

  const isCurrentData = data && data.type === tab;

  // Inventory search filter
  const filteredInventoryItems = useMemo(() => {
    if (!isCurrentData || tab !== "inventory" || !Array.isArray(data.items)) return [];
    if (!searchQuery.trim()) return data.items;
    const q = searchQuery.toLowerCase();
    return data.items.filter(
      (item: any) =>
        (item.product && item.product.toLowerCase().includes(q)) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.warehouse && item.warehouse.toLowerCase().includes(q))
    );
  }, [data, isCurrentData, tab, searchQuery]);

  // Inventory summary metrics
  const inventoryStats = useMemo(() => {
    if (!isCurrentData || tab !== "inventory" || !Array.isArray(data.items)) {
      return { totalSkus: 0, totalValuation: 0, lowStockCount: 0, outOfStockCount: 0 };
    }
    let totalVal = 0;
    let lowCount = 0;
    let outCount = 0;
    for (const it of data.items) {
      totalVal += Number(it.valuation ?? 0);
      if (it.lowStock) lowCount++;
      if (Number(it.onHand ?? 0) <= 0) outCount++;
    }
    return {
      totalSkus: data.items.length,
      totalValuation: totalVal,
      lowStockCount: lowCount,
      outOfStockCount: outCount,
    };
  }, [data, isCurrentData, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Reports</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {warehouses && warehouses.length > 0 && (
            <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
              <label className="text-xs text-muted pl-1">Warehouse:</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="bg-surface rounded border border-line text-xs font-medium text-ink px-2 py-1"
              >
                <option value="">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg border border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setSearchQuery("");
                }}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  tab === t.id
                    ? "bg-accent text-white shadow-sm"
                    : "text-muted hover:text-ink hover:bg-surface"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(loading || !isCurrentData) && !error && (
        <div className="space-y-4">
          <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />
          <SkeletonTable rows={6} cols={4} />
        </div>
      )}

      {error && !isCurrentData && <ErrorRetry message={error} onRetry={reload} />}

      {/* ─────────────────────── SALES TAB ─────────────────────── */}
      {isCurrentData && tab === "sales" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="card border-l-4 border-l-accent">
              <div className="text-xs font-medium text-muted uppercase">Total Revenue</div>
              <div className="text-2xl font-bold text-ink mt-1">₹{Number(data.totalRevenue ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">{data.billCount ?? 0} Invoices generated</div>
            </div>
            <div className="card border-l-4 border-l-blue-500">
              <div className="text-xs font-medium text-muted uppercase">Wholesale Volume</div>
              <div className="text-2xl font-bold text-ink mt-1">₹{Number(data.wholesaleTotal ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">B2B bulk orders</div>
            </div>
            <div className="card border-l-4 border-l-emerald-500">
              <div className="text-xs font-medium text-muted uppercase">Retail Counter</div>
              <div className="text-2xl font-bold text-ink mt-1">₹{Number(data.retailTotal ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">Walk-in retail sales</div>
            </div>
            <div className="card border-l-4 border-l-purple-500">
              <div className="text-xs font-medium text-muted uppercase">Top Product Share</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {Array.isArray(data.byProduct) && data.byProduct[0]
                  ? `₹${Number(data.byProduct[0].revenue ?? 0).toFixed(2)}`
                  : "₹0.00"}
              </div>
              <div className="text-[11px] text-muted mt-1 truncate">
                {Array.isArray(data.byProduct) && data.byProduct[0] ? data.byProduct[0].name : "No sales recorded"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-ink">🏆 Top Performing Products</h2>
                <span className="text-xs text-muted">By Revenue</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2">#</th>
                      <th className="py-2">Product</th>
                      <th className="py-2 text-right">Qty Sold</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {Array.isArray(data.byProduct) && data.byProduct.length > 0 ? (
                      data.byProduct.map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-surface-2/40">
                          <td className="py-2 font-mono text-muted">{i + 1}</td>
                          <td className="py-2 font-semibold text-ink">{p.name}</td>
                          <td className="py-2 text-right text-muted">{fmtQty(p.qty)}</td>
                          <td className="py-2 text-right font-bold text-ink">₹{Number(p.revenue ?? 0).toFixed(2)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted">
                          No product sales recorded in this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-ink">👥 Top Buying Customers</h2>
                <span className="text-xs text-muted">By Billing Volume</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2">#</th>
                      <th className="py-2">Shop / Customer</th>
                      <th className="py-2 text-right">Total Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {Array.isArray(data.byCustomer) && data.byCustomer.length > 0 ? (
                      data.byCustomer.map((c: any, i: number) => (
                        <tr key={i} className="hover:bg-surface-2/40">
                          <td className="py-2 font-mono text-muted">{i + 1}</td>
                          <td className="py-2 font-semibold text-ink">{c.name || "Walk-in Customer"}</td>
                          <td className="py-2 text-right font-bold text-good">₹{Number(c.revenue ?? 0).toFixed(2)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-muted">
                          No customer transactions recorded in this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── PAYMENTS TAB ─────────────────────── */}
      {isCurrentData && tab === "payments" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="card border-l-4 border-l-good">
              <div className="text-xs font-medium text-muted uppercase">Total Collected</div>
              <div className="text-2xl font-bold text-good mt-1">
                ₹{Number(data.totalCollected ?? Number(data.cashCollected ?? 0) + Number(data.upiCollected ?? 0)).toFixed(2)}
              </div>
              <div className="text-[11px] text-muted mt-1">Cash + UPI settlements</div>
            </div>
            <div className="card border-l-4 border-l-blue-600">
              <div className="text-xs font-medium text-muted uppercase">Cash Inflow</div>
              <div className="text-2xl font-bold text-ink mt-1">₹{Number(data.cashCollected ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">Till drawer receipts</div>
            </div>
            <div className="card border-l-4 border-l-cyan-600">
              <div className="text-xs font-medium text-muted uppercase">UPI Inflow</div>
              <div className="text-2xl font-bold text-ink mt-1">₹{Number(data.upiCollected ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">Direct QR / VPA receipts</div>
            </div>
            <div className="card border-l-4 border-l-warn">
              <div className="text-xs font-medium text-muted uppercase">Pending Invoices</div>
              <div className="text-2xl font-bold text-warn mt-1">₹{Number(data.pending ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">Awaiting confirmation</div>
            </div>
            <div className="card border-l-4 border-l-bad">
              <div className="text-xs font-medium text-muted uppercase">Refunds Given</div>
              <div className="text-2xl font-bold text-bad mt-1">₹{Number(data.refunds ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">QC adjustment payouts</div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-ink">💳 Recent Payment Transactions</h2>
              <span className="text-xs text-muted">Latest 50 entries</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Date & Time</th>
                    <th className="py-2">Bill No</th>
                    <th className="py-2">Customer</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Type</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {Array.isArray(data.transactions) && data.transactions.length > 0 ? (
                    data.transactions.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-surface-2/40">
                        <td className="py-2 text-muted font-mono">{fmtDate(tx.timestamp)}</td>
                        <td className="py-2 font-semibold text-ink">{tx.billNumber}</td>
                        <td className="py-2 text-ink">{tx.customerName}</td>
                        <td className="py-2">
                          <span
                            className={`badge text-[10px] ${
                              tx.method === "CASH" ? "bg-amber-100 text-amber-800" : "bg-cyan-100 text-cyan-800"
                            }`}
                          >
                            {tx.method}
                          </span>
                        </td>
                        <td className="py-2">
                          <span
                            className={`badge text-[10px] ${
                              tx.type === "PAYMENT"
                                ? "bg-emerald-100 text-emerald-800"
                                : tx.type === "REFUND"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-slate-100 text-slate-800"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td
                          className={`py-2 text-right font-bold ${
                            tx.type === "REFUND" ? "text-bad" : "text-good"
                          }`}
                        >
                          {tx.type === "REFUND" ? "-" : "+"}₹{Number(tx.amount ?? 0).toFixed(2)}
                        </td>
                        <td className="py-2">
                          <span
                            className={`badge text-[10px] ${
                              tx.status === "CONFIRMED"
                                ? "bg-emerald-100 text-emerald-800"
                                : tx.status === "PENDING"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td className="py-2 text-muted">{tx.recordedBy}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted">
                        No transactions recorded in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── INVENTORY TAB ─────────────────────── */}
      {isCurrentData && tab === "inventory" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card border-l-4 border-l-accent">
              <div className="text-xs font-medium text-muted uppercase">Total SKUs</div>
              <div className="text-2xl font-bold text-ink mt-1">{inventoryStats.totalSkus}</div>
              <div className="text-[11px] text-muted mt-1">Active catalog items</div>
            </div>
            <div className="card border-l-4 border-l-good">
              <div className="text-xs font-medium text-muted uppercase">Stock Valuation</div>
              <div className="text-2xl font-bold text-good mt-1">₹{inventoryStats.totalValuation.toFixed(2)}</div>
              <div className="text-[11px] text-muted mt-1">Based on purchase cost</div>
            </div>
            <div className="card border-l-4 border-l-warn">
              <div className="text-xs font-medium text-muted uppercase">Low Stock Alerts</div>
              <div className="text-2xl font-bold text-warn mt-1">{inventoryStats.lowStockCount}</div>
              <div className="text-[11px] text-muted mt-1">Below minimum threshold</div>
            </div>
            <div className="card border-l-4 border-l-bad">
              <div className="text-xs font-medium text-muted uppercase">Out of Stock</div>
              <div className="text-2xl font-bold text-bad mt-1">{inventoryStats.outOfStockCount}</div>
              <div className="text-[11px] text-muted mt-1">Zero quantity on hand</div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">📦 Warehouse Inventory Snapshot</h2>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search product, SKU or warehouse..."
                className="input text-xs w-full sm:w-64"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Product</th>
                    <th className="py-2">SKU</th>
                    <th className="py-2">Warehouse</th>
                    <th className="py-2 text-right">On Hand</th>
                    <th className="py-2 text-right">Reserved</th>
                    <th className="py-2 text-right">Available</th>
                    <th className="py-2 text-right">Valuation</th>
                    <th className="py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {filteredInventoryItems.length > 0 ? (
                    filteredInventoryItems.map((item: any, idx: number) => {
                      const onHand = Number(item.onHand ?? 0);
                      const isOut = onHand <= 0;
                      return (
                        <tr key={idx} className="hover:bg-surface-2/40">
                          <td className="py-2 font-semibold text-ink">{item.product}</td>
                          <td className="py-2 font-mono text-muted text-[11px]">{item.sku}</td>
                          <td className="py-2 text-muted">{item.warehouse}</td>
                          <td className={`py-2 text-right font-medium ${isOut ? "text-bad font-bold" : "text-ink"}`}>
                            {onHand.toFixed(2)}
                          </td>
                          <td className="py-2 text-right text-muted">{Number(item.reserved ?? 0).toFixed(2)}</td>
                          <td className="py-2 text-right font-bold text-ink">{Number(item.available ?? 0).toFixed(2)}</td>
                          <td className="py-2 text-right font-mono">₹{Number(item.valuation ?? 0).toFixed(2)}</td>
                          <td className="py-2 text-center">
                            {isOut ? (
                              <span className="badge bg-bad/10 text-bad font-semibold">OUT</span>
                            ) : item.lowStock ? (
                              <span className="badge bg-warn/10 text-warn font-semibold">LOW</span>
                            ) : (
                              <span className="badge bg-good/10 text-good font-semibold">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted">
                        {searchQuery ? "No matching inventory items found" : "No inventory recorded"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── QC TAB ─────────────────────── */}
      {isCurrentData && tab === "qc" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card border-l-4 border-l-accent">
              <div className="text-xs font-medium text-muted uppercase">Total Modifications</div>
              <div className="text-2xl font-bold text-ink mt-1">{data.total ?? 0}</div>
              <div className="text-[11px] text-muted mt-1">QC line item adjustments</div>
            </div>
            <div className="card border-l-4 border-l-amber-500">
              <div className="text-xs font-medium text-muted uppercase">Quantity Reduced</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">{data.byAction?.REDUCE ?? 0}</div>
              <div className="text-[11px] text-muted mt-1">Damage / customer request</div>
            </div>
            <div className="card border-l-4 border-l-rose-500">
              <div className="text-xs font-medium text-muted uppercase">Items Removed</div>
              <div className="text-2xl font-bold text-rose-600 mt-1">
                {(data.byAction?.REMOVE ?? 0) + (data.byAction?.MARK_UNAVAILABLE ?? 0)}
              </div>
              <div className="text-[11px] text-muted mt-1">Out of stock / cancelled</div>
            </div>
            <div className="card border-l-4 border-l-emerald-500">
              <div className="text-xs font-medium text-muted uppercase">Items Kept / Unchanged</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{data.byAction?.KEEP ?? 0}</div>
              <div className="text-[11px] text-muted mt-1">Verified accurate</div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-ink">🔍 Recent Quality Check Adjustments</h2>
              <span className="text-xs text-muted">Audit trail of physical handover</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Date & Time</th>
                    <th className="py-2">Order No</th>
                    <th className="py-2">QC Staff</th>
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Original Qty</th>
                    <th className="py-2 text-right">Final Qty</th>
                    <th className="py-2 text-center">Action</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {Array.isArray(data.recent) && data.recent.length > 0 ? (
                    data.recent.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-surface-2/40">
                        <td className="py-2 text-muted font-mono">{fmtDate(r.createdAt)}</td>
                        <td className="py-2 font-semibold text-ink">{r.order}</td>
                        <td className="py-2 text-muted">{r.qcUser}</td>
                        <td className="py-2 font-medium text-ink">{r.product}</td>
                        <td className="py-2 text-right text-muted">{fmtQty(r.originalQty)}</td>
                        <td className="py-2 text-right font-bold text-ink">{fmtQty(r.finalQty)}</td>
                        <td className="py-2 text-center">
                          <span
                            className={`badge text-[10px] ${
                              r.action === "KEEP"
                                ? "bg-emerald-100 text-emerald-800"
                                : r.action === "REDUCE"
                                ? "bg-amber-100 text-amber-800"
                                : r.action === "REMOVE" || r.action === "MARK_UNAVAILABLE"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {r.action}
                          </span>
                        </td>
                        <td className="py-2 text-muted italic">{r.reason || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted">
                        No QC adjustments recorded in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── CASH TAB ─────────────────────── */}
      {isCurrentData && tab === "cash" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card border-l-4 border-l-accent">
              <div className="text-xs font-medium text-muted uppercase">Total Sessions</div>
              <div className="text-2xl font-bold text-ink mt-1">
                {Array.isArray(data.sessions) ? data.sessions.length : 0}
              </div>
              <div className="text-[11px] text-muted mt-1">Recorded till shifts</div>
            </div>
            <div className="card border-l-4 border-l-emerald-500">
              <div className="text-xs font-medium text-muted uppercase">Closed & Balanced</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">
                {Array.isArray(data.sessions)
                  ? data.sessions.filter((s: any) => s.status === "CLOSED" && Number(s.difference ?? 0) === 0).length
                  : 0}
              </div>
              <div className="text-[11px] text-muted mt-1">Zero discrepancy</div>
            </div>
            <div className="card border-l-4 border-l-amber-500">
              <div className="text-xs font-medium text-muted uppercase">Open Drawers</div>
              <div className="text-2xl font-bold text-amber-600 mt-1">
                {Array.isArray(data.sessions)
                  ? data.sessions.filter((s: any) => s.status === "OPEN").length
                  : 0}
              </div>
              <div className="text-[11px] text-muted mt-1">Currently active shifts</div>
            </div>
            <div className="card border-l-4 border-l-rose-500">
              <div className="text-xs font-medium text-muted uppercase">Discrepancies</div>
              <div className="text-2xl font-bold text-rose-600 mt-1">
                {Array.isArray(data.sessions)
                  ? data.sessions.filter((s: any) => s.difference != null && Number(s.difference) !== 0).length
                  : 0}
              </div>
              <div className="text-[11px] text-muted mt-1">Requires manager review</div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-ink">💵 Cash Drawer Shifts & EOD Reconciliation</h2>
              <span className="text-xs text-muted">Daily cash ledger</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Business Date</th>
                    <th className="py-2">Warehouse</th>
                    <th className="py-2">Cashier / Staff</th>
                    <th className="py-2 text-right">Opening Float</th>
                    <th className="py-2 text-right">Expected Cash</th>
                    <th className="py-2 text-right">Actual Count</th>
                    <th className="py-2 text-right">Variance</th>
                    <th className="py-2 text-center">Status</th>
                    <th className="py-2">Reason / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {Array.isArray(data.sessions) && data.sessions.length > 0 ? (
                    data.sessions.map((s: any) => {
                      const diff = s.difference != null ? Number(s.difference) : null;
                      const hasDiscrepancy = diff !== null && diff !== 0;
                      return (
                        <tr key={s.id} className="hover:bg-surface-2/40">
                          <td className="py-2 font-mono text-muted">{fmtDate(s.businessDate)}</td>
                          <td className="py-2 text-muted">{s.warehouse}</td>
                          <td className="py-2 font-semibold text-ink">{s.financeUser}</td>
                          <td className="py-2 text-right font-mono">₹{Number(s.openingCash ?? 0).toFixed(2)}</td>
                          <td className="py-2 text-right font-mono text-muted">
                            {s.expectedCash != null ? `₹${Number(s.expectedCash).toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 text-right font-mono font-medium text-ink">
                            {s.actualCash != null ? `₹${Number(s.actualCash).toFixed(2)}` : "—"}
                          </td>
                          <td
                            className={`py-2 text-right font-mono font-bold ${
                              diff === null
                                ? "text-muted"
                                : diff === 0
                                ? "text-good"
                                : diff > 0
                                ? "text-blue-600"
                                : "text-bad"
                            }`}
                          >
                            {diff !== null ? `${diff > 0 ? "+" : ""}₹${diff.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 text-center">
                            <span
                              className={`badge text-[10px] ${
                                s.status === "CLOSED"
                                  ? hasDiscrepancy
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {s.status}
                            </span>
                          </td>
                          <td className="py-2 text-muted italic">{s.discrepancyReason || "—"}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted">
                        No cash sessions recorded in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
