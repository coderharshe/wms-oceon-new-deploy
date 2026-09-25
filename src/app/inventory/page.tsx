"use client";

import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type InventoryDashboardData = {
  totalSkus: number;
  totalQuantity: number;
  totalValuation: number;
  lowStockCount: number;
  oosCount: number;
  nearExpiryCount: number;
  todayInward: number;
  todayOutward: number;
};

export default function InventoryDashboardPage() {
  const { data, loading, error, reload } = useApiGet<InventoryDashboardData>("/api/inventory/dashboard");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  const d = data || {
    totalSkus: 0,
    totalQuantity: 0,
    totalValuation: 0,
    lowStockCount: 0,
    oosCount: 0,
    nearExpiryCount: 0,
    todayInward: 0,
    todayOutward: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Inventory Team Dashboard</h1>
          <p className="text-xs text-muted">Stock health, inward/GRN processing, physical counting, and variance control</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory/grn" className="btn btn-primary font-semibold">
            📥 Receive Stock (GRN)
          </Link>
          <Link href="/inventory/count" className="btn">
            🔎 Physical Count
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Total SKUs</div>
          <div className="text-2xl font-bold">{d.totalSkus}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Total Stock Value</div>
          <div className="text-2xl font-bold">₹{Number(d.totalValuation).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Low Stock Items</div>
          <div className="text-2xl font-bold text-warn">{d.lowStockCount}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Out of Stock (OOS)</div>
          <div className={`text-2xl font-bold ${d.oosCount > 0 ? "text-bad" : ""}`}>{d.oosCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Inventory Operations</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/inventory/grn" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📥 Inward / GRN</div>
              <div className="text-xs text-muted">Physical check & stock entry against PO</div>
            </Link>
            <Link href="/inventory/outward" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📤 Stock Issue / Outward</div>
              <div className="text-xs text-muted">Dispatch, damage, return with mandatory reason</div>
            </Link>
            <Link href="/inventory/count" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">🔎 Physical Stock Count</div>
              <div className="text-xs text-muted">System vs physical audit & variance adjustments</div>
            </Link>
            <Link href="/inventory/reports" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📊 Inventory Reports</div>
              <div className="text-xs text-muted">Fast/slow moving, ageing, expiry, valuation</div>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Inventory Team Permissions</h2>
          <ul className="text-xs space-y-1.5 text-muted">
            <li>✅ <strong>CAN:</strong> Receive stock, count stock, report damage, physical count, view movement.</li>
            <li>❌ <strong>CANNOT:</strong> Change selling or purchase prices.</li>
            <li>❌ <strong>CANNOT:</strong> Make arbitrary unapproved stock adjustments.</li>
            <li>❌ <strong>CANNOT:</strong> Delete inventory history or financial transactions.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
