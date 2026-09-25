"use client";

import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type BillingDashboardData = {
  todayOrders: number;
  todayBills: number;
  todaySales: number;
  avgOrderValue: number;
  itemsSold: number;
  cancelledOrders: number;
  creditSales: number;
};

export default function BillingDashboardPage() {
  const { data, loading, error, reload } = useApiGet<BillingDashboardData>("/api/billing/dashboard");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  const d = data || {
    todayOrders: 0,
    todayBills: 0,
    todaySales: 0,
    avgOrderValue: 0,
    itemsSold: 0,
    cancelledOrders: 0,
    creditSales: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Billing & Sales Dashboard</h1>
          <p className="text-xs text-muted">Real-time daily POS sales and billing metrics</p>
        </div>
        <div className="flex gap-2">
          <Link href="/billing/new" className="btn btn-primary font-semibold">
            + New Bill (F2)
          </Link>
          <Link href="/billing/orders" className="btn">
            View Bills (Alt+O)
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Today's Sales</div>
          <div className="text-2xl font-bold text-good">₹{Number(d.todaySales).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Bills Generated</div>
          <div className="text-2xl font-bold">{d.todayBills}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Average Order Value</div>
          <div className="text-2xl font-bold">₹{Number(d.avgOrderValue).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Items Sold</div>
          <div className="text-2xl font-bold">{d.itemsSold}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/billing/new" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">🛒 Create New Bill</div>
              <div className="text-xs text-muted">Start a retail/wholesale invoice</div>
            </Link>
            <Link href="/billing/orders" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">🧾 Search Past Bills</div>
              <div className="text-xs text-muted">View, print, or share invoices</div>
            </Link>
            <Link href="/billing/gst-bill" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">📄 GST B2B Invoices</div>
              <div className="text-xs text-muted">Generate official tax invoices</div>
            </Link>
            <Link href="/billing/discounts" className="rounded border border-line p-3 hover:bg-surface-hi">
              <div className="font-semibold text-sm">🏷️ Discount Approvals</div>
              <div className="text-xs text-muted">Check manager/admin approvals</div>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Billing Policy Reminders</h2>
          <ul className="text-xs space-y-1.5 text-muted">
            <li>✅ <strong>0–2% Discount:</strong> Permitted directly by billing staff.</li>
            <li>⚠️ <strong>2–5% Discount:</strong> Requires Manager approval before finalizing.</li>
            <li>🛑 <strong>5%+ Discount:</strong> Requires Sir/Admin approval.</li>
            <li>🔒 Invoices cannot be deleted — use Cancel / Credit Note / Refund only.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
