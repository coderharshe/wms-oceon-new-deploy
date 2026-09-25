"use client";

import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type ProcurementDashboardData = {
  pendingRequisitions: number;
  openPOs: number;
  pendingDeliveries: number;
  overduePOs: number;
  todayPurchaseValue: number;
};

export default function ProcurementDashboardPage() {
  const { data, loading, error, reload } = useApiGet<ProcurementDashboardData>("/api/procurement/dashboard");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  const d = data || {
    pendingRequisitions: 0,
    openPOs: 0,
    pendingDeliveries: 0,
    overduePOs: 0,
    todayPurchaseValue: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Procurement & Purchase Control</h1>
          <p className="text-xs text-muted">Supplier negotiation, landed cost analysis, and purchase order lifecycle</p>
        </div>
        <div className="flex gap-2">
          <Link href="/procurement/suppliers" className="btn btn-primary font-semibold">
            🔍 Compare Suppliers
          </Link>
          <Link href="/procurement/orders/new" className="btn">
            + Create PO
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Pending Requisitions</div>
          <div className="text-2xl font-bold text-warn">{d.pendingRequisitions}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Open Purchase Orders</div>
          <div className="text-2xl font-bold">{d.openPOs}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Pending Deliveries</div>
          <div className="text-2xl font-bold">{d.pendingDeliveries}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Overdue POs</div>
          <div className={`text-2xl font-bold ${d.overduePOs > 0 ? "text-bad" : ""}`}>{d.overduePOs}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Procurement Core Modules</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/procurement/suppliers" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📊 Supplier Comparison</div>
              <div className="text-xs text-muted">Rate, MOQ, Scheme & Credit comparison</div>
            </Link>
            <Link href="/procurement/requisitions" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📋 Purchase Requisitions</div>
              <div className="text-xs text-muted">Auto-triggered from low stock levels</div>
            </Link>
            <Link href="/procurement/orders" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">🧾 Purchase Orders (PO)</div>
              <div className="text-xs text-muted">Draft, approval matrix & sent status</div>
            </Link>
            <Link href="/procurement/rates" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📈 Rate History & Trends</div>
              <div className="text-xs text-muted">Track historical prices per SKU</div>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">PO Approval Matrix</h2>
          <ul className="text-xs space-y-1.5 text-muted">
            <li>🟢 <strong>₹0 – ₹10,000:</strong> Direct Procurement officer approval.</li>
            <li>🟠 <strong>₹10,001 – ₹50,000:</strong> Procurement + Manager dual approval.</li>
            <li>🔴 <strong>₹50,000+:</strong> Sir/Admin approval required.</li>
            <li>📦 Receiving is verified physically by Inventory via GRN upon arrival.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
