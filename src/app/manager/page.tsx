"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type ManagerDashboardData = {
  warehouseId: string;
  salesToday: number;
  salesYesterday: number;
  salesGrowthPercent: number;
  todaysOrders: number;
  yesterdaysOrders: number;
  pendingQc: number;
  completedToday: number;
  inventoryValue: number;
  lowStockCount: number;
  nearMinCount: number;
  oosCount: number;
  lowStockItems: { product: string; sku: string; onHand: string; minStock: string; level: "near" | "low" }[];
  staffCount: number;
  activeQcLocks: { qcSessionId: string; orderId: string; orderNumber: string; holderName: string; lockedSince: string }[];
  pendingTasksCount: number;
  pendingPOsCount: number;
  pendingDiscountsCount: number;
};

export default function ManagerDashboard() {
  const { data: d, error, loading, reload } = useApiGet<ManagerDashboardData>("/api/manager/dashboard");
  const { data: qc, reload: reloadQc } = useApiGet<{ enabled: boolean }>("/api/settings/qc");
  const [releasing, setReleasing] = useState<string | null>(null);
  const [savingQc, setSavingQc] = useState(false);

  async function toggleQc(enabled: boolean) {
    if (!enabled && !confirm("Turn QC off? Finance will complete orders directly and QC staff can't sign in.")) return;
    setSavingQc(true);
    await fetch("/api/settings/qc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setSavingQc(false);
    reloadQc();
    reload();
  }

  async function release(qcSessionId: string) {
    if (!confirm("Release this QC lock? The staff member currently working on it will lose access.")) return;
    setReleasing(qcSessionId);
    await fetch(`/api/qc/sessions/${qcSessionId}/release`, { method: "POST" });
    setReleasing(null);
    reload();
  }

  if (loading) return <SkeletonStats count={8} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !d) return <ErrorRetry message={error} onRetry={reload} />;
  if (!d) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-ink">Manager Dashboard</h1>
        <button onClick={reload} className="btn-secondary text-xs">
          Refresh
        </button>
      </div>

      {/* Quick Action & Alert Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/manager/tasks"
          className="card border-blue-200 bg-blue-50/40 p-3.5 flex items-center justify-between hover:border-blue-300 transition"
        >
          <div>
            <div className="text-xs font-bold text-blue-900 uppercase tracking-wider">Tasks</div>
            <div className="text-lg font-bold text-blue-950 mt-0.5">
              {d.pendingTasksCount} Active Tasks
            </div>
          </div>
          <span className="btn-primary text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold">
            View Tasks →
          </span>
        </Link>

        <Link
          href="/manager/alerts"
          className="card border-amber-200 bg-amber-50/40 p-3.5 flex items-center justify-between hover:border-amber-300 transition"
        >
          <div>
            <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">Alerts</div>
            <div className="text-lg font-bold text-amber-950 mt-0.5">
              {d.oosCount} OOS · {d.lowStockCount} Low Stock · {d.pendingQc} Pending QC
            </div>
          </div>
          <span className="btn-secondary text-xs border-amber-300 text-amber-900 font-semibold">
            View Alerts →
          </span>
        </Link>
      </div>

      {/* QC Stage Control */}
      {qc && (
        <div className="card flex items-center justify-between gap-3 p-3 bg-surface-2 border border-line">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-ink">QC Verification Stage</div>
            <div className="text-xs text-muted">
              Status: {qc.enabled ? "Active" : "Disabled (Bypassed)"}
            </div>
          </div>
          <button className="btn text-xs py-1 px-3" disabled={savingQc} onClick={() => toggleQc(!qc.enabled)}>
            {savingQc ? "Saving…" : qc.enabled ? "Turn QC Off" : "Turn QC On"}
          </button>
        </div>
      )}

      {/* Sales Velocity */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted tracking-wider">Sales</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card">
            <div className="text-xs text-muted">Today&apos;s Sales</div>
            <div className="text-xl font-bold text-primary">₹{d.salesToday.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-0.5">{d.todaysOrders} Orders</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Yesterday&apos;s Sales</div>
            <div className="text-xl font-bold">₹{d.salesYesterday.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-0.5">{d.yesterdaysOrders} Orders</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Growth</div>
            <div className={`text-xl font-bold ${d.salesGrowthPercent >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {d.salesGrowthPercent >= 0 ? `+${d.salesGrowthPercent.toFixed(1)}%` : `${d.salesGrowthPercent.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted mt-0.5">vs yesterday</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Stock Value</div>
            <div className="text-xl font-bold">₹{d.inventoryValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted mt-0.5">Wholesale value</div>
          </div>
        </div>
      </div>

      {/* Operations KPIs */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted tracking-wider">Operations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card">
            <div className="text-xs text-muted">Pending QC</div>
            <div className={`text-xl font-bold ${d.pendingQc > 0 ? "text-amber-600" : ""}`}>{d.pendingQc}</div>
            <div className="text-xs text-muted mt-0.5">Orders in queue</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Dispatched Today</div>
            <div className="text-xl font-bold text-emerald-600">{d.completedToday}</div>
            <div className="text-xs text-muted mt-0.5">Orders completed</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Active Staff</div>
            <div className="text-xl font-bold">{d.staffCount}</div>
            <div className="text-xs text-muted mt-0.5">Hub personnel</div>
          </div>
          <div className="card">
            <div className="text-xs text-muted">Pending POs</div>
            <div className="text-xl font-bold text-blue-600">{d.pendingPOsCount}</div>
            <div className="text-xs text-muted mt-0.5">Purchase orders</div>
          </div>
        </div>
      </div>

      {/* Active QC Locks */}
      {d.activeQcLocks.length > 0 && (
        <section className="card space-y-3">
          <h2 className="text-sm font-bold">Active QC & Picking Sessions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2">Order No</th>
                  <th>Staff Member</th>
                  <th>Locked Since</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.activeQcLocks.map((l) => (
                  <tr key={l.qcSessionId} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="py-2 font-semibold text-primary">{l.orderNumber}</td>
                    <td>{l.holderName}</td>
                    <td className="text-xs text-muted">{fmtTime(l.lockedSince)}</td>
                    <td className="text-right">
                      <button
                        className="btn-secondary text-xs text-rose-600 border-rose-300 py-1 px-2"
                        disabled={releasing === l.qcSessionId}
                        onClick={() => release(l.qcSessionId)}
                      >
                        {releasing === l.qcSessionId ? "Releasing…" : "Release Lock"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Low Stock Reorder List */}
      {d.lowStockItems.length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Low Stock Warnings</h2>
            <Link href="/manager/inventory" className="text-xs text-primary font-semibold hover:underline">
              View All Stock →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2">SKU</th>
                  <th>Product</th>
                  <th>On Hand</th>
                  <th>Minimum Stock</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {d.lowStockItems.map((i, idx) => {
                  const low = i.level === "low";
                  return (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="py-2 font-mono text-xs">{i.sku}</td>
                      <td className="font-medium">{i.product}</td>
                      <td className={low ? "font-bold text-rose-600" : "font-semibold text-amber-600"}>
                        {Number(i.onHand).toFixed(2)}
                      </td>
                      <td className="text-muted">{Number(i.minStock).toFixed(2)}</td>
                      <td>
                        <span
                          className={`badge text-xs font-bold px-2 py-0.5 ${
                            low ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {low ? "CRITICAL LOW" : "NEAR MINIMUM"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
