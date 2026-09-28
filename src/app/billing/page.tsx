"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type RecentBillItem = {
  id: string;
  orderNumber: string;
  billNumber: string;
  customerName: string;
  customerType: string;
  sellingMode: string;
  total: number;
  itemsCount: number;
  orderStatus: string;
  paymentStatus: string;
  paidAmount: number;
  createdAt: string;
};

type BillingDashboardData = {
  metrics: {
    todaySales: number;
    totalBills: number;
    itemsSold: number;
    pendingBills: {
      count: number;
      amount: number;
    };
    cancelledBills: {
      count: number;
      amount: number;
    };
    refunds: {
      count: number;
      amount: number;
    };
    paymentCollection: {
      total: number;
      cash: number;
      upi: number;
      bank: number;
      cheque: number;
      transactionsCount: number;
    };
    avgOrderValue: number;
  };
  recentBills: RecentBillItem[];
};

export default function BillingDashboardPage() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useApiGet<BillingDashboardData>("/api/billing/dashboard");

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonStats count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { metrics, recentBills } = data;

  const filteredBills = recentBills.filter(
    (b) =>
      b.billNumber.toLowerCase().includes(q.toLowerCase()) ||
      b.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      b.customerName.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="w-full space-y-5 pb-12">
      {/* ── 1. Header & Quick Action Buttons ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-ink">🛒 Billing Dashboard</h1>

          </div>
          <p className="text-xs text-muted mt-0.5">
            Daily retail &amp; wholesale invoice operations, collections, and settlement metrics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/billing/new" className="btn btn-primary text-sm font-bold shadow-sm flex items-center gap-1.5">
            <span>+</span> New Bill (F2)
          </Link>

          <button onClick={() => reload()} className="btn text-sm font-semibold" title="Refresh Live Data">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── 2. Primary 7-Pillar KPI Ribbon ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {/* 1. Today's Sales */}
        <div className="card p-3.5 border-l-4 border-l-emerald-500">
          <div className="text-xs font-semibold text-emerald-700">1. Today's Sales</div>
          <div className="text-xl font-black text-emerald-700 font-mono mt-0.5">
            ₹{metrics.todaySales.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">AOV: ₹{metrics.avgOrderValue.toFixed(0)}</div>
        </div>

        {/* 2. Total Bills */}
        <div className="card p-3.5 border-l-4 border-l-sky-500">
          <div className="text-xs font-semibold text-sky-700">2. Total Bills</div>
          <div className="text-xl font-black text-ink font-mono mt-0.5">
            {metrics.totalBills}
          </div>
          <div className="text-[11px] text-muted mt-1">Generated invoices</div>
        </div>

        {/* 3. Inventory Sold */}
        <div className="card p-3.5 border-l-4 border-l-teal-500">
          <div className="text-xs font-semibold text-teal-700">3. Items Sold</div>
          <div className="text-xl font-black text-teal-700 font-mono mt-0.5">
            {metrics.itemsSold.toLocaleString()}
          </div>
          <div className="text-[11px] text-muted mt-1">Total units moved</div>
        </div>

        {/* 4. Pending Bills */}
        <div className="card p-3.5 border-l-4 border-l-amber-500">
          <div className="text-xs font-semibold text-amber-700">4. Pending Bills</div>
          <div className="text-xl font-black text-amber-700 font-mono mt-0.5">
            {metrics.pendingBills.count}
          </div>
          <div className="text-[11px] text-amber-800 font-semibold mt-1">
            ₹{metrics.pendingBills.amount.toLocaleString("en-IN", { minimumFractionDigits: 0 })} due
          </div>
        </div>

        {/* 5. Cancelled Bills */}
        <div className="card p-3.5 border-l-4 border-l-rose-500">
          <div className="text-xs font-semibold text-rose-700">5. Cancelled Bills</div>
          <div className="text-xl font-black text-rose-700 font-mono mt-0.5">
            {metrics.cancelledBills.count}
          </div>
          <div className="text-[11px] text-rose-800 font-semibold mt-1">
            ₹{metrics.cancelledBills.amount.toLocaleString("en-IN", { minimumFractionDigits: 0 })} void
          </div>
        </div>

        {/* 6. Refunds */}
        <div className="card p-3.5 border-l-4 border-l-purple-500">
          <div className="text-xs font-semibold text-purple-700">6. Refunds / Returns</div>
          <div className="text-xl font-black text-purple-700 font-mono mt-0.5">
            ₹{metrics.refunds.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">{metrics.refunds.count} QC adjustments</div>
        </div>

        {/* 7. Payment Collection */}
        <div className="card p-3.5 border-l-4 border-l-primary">
          <div className="text-xs font-semibold text-primary">7. Total Collection</div>
          <div className="text-xl font-black text-primary font-mono mt-0.5">
            ₹{metrics.paymentCollection.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-muted mt-1">{metrics.paymentCollection.transactionsCount} receipts</div>
        </div>
      </div>

      {/* ── 3. Payment Tender Breakdown Banner ── */}
      <div className="bg-surface p-4 rounded-xl border border-line space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-ink uppercase tracking-wider">
            💵 Counter Collections by Payment Tender:
          </div>
          <div className="text-xs font-bold text-good">
            Total Collected: ₹{metrics.paymentCollection.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-surface-hi p-3 rounded-lg border border-line flex items-center justify-between">
            <div>
              <span className="text-muted block text-[11px]">💵 Cash Tender</span>
              <span className="text-base font-bold text-emerald-700 font-mono">
                ₹{metrics.paymentCollection.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className="text-lg">💵</span>
          </div>

          <div className="bg-surface-hi p-3 rounded-lg border border-line flex items-center justify-between">
            <div>
              <span className="text-muted block text-[11px]">📱 UPI Dynamic QR</span>
              <span className="text-base font-bold text-sky-700 font-mono">
                ₹{metrics.paymentCollection.upi.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className="text-lg">📱</span>
          </div>

          <div className="bg-surface-hi p-3 rounded-lg border border-line flex items-center justify-between">
            <div>
              <span className="text-muted block text-[11px]">🏦 Bank Transfer / Cards</span>
              <span className="text-base font-bold text-purple-700 font-mono">
                ₹{metrics.paymentCollection.bank.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className="text-lg">🏦</span>
          </div>

          <div className="bg-surface-hi p-3 rounded-lg border border-line flex items-center justify-between">
            <div>
              <span className="text-muted block text-[11px]">📑 Cheque / Draft</span>
              <span className="text-base font-bold text-amber-700 font-mono">
                ₹{metrics.paymentCollection.cheque.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <span className="text-lg">📑</span>
          </div>
        </div>
      </div>

      {/* ── 4. Recent Bills & Invoices Live Table ── */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div>
            <h3 className="text-sm font-bold text-ink">Recent Invoices</h3>

          </div>

          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search bill number or customer..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="bg-surface-hi border border-line rounded-lg px-3 py-1 text-xs text-ink w-64"
            />
            <Link href="/billing/orders" className="btn text-xs">
              View All Bills →
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto text-xs">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2.5">Time</th>
                <th className="py-2.5">Bill / Slip No</th>
                <th className="py-2.5">Customer / Shop Name</th>
                <th className="py-2.5">Mode</th>
                <th className="py-2.5 text-center">Items</th>
                <th className="py-2.5 text-right font-bold text-ink">Bill Total</th>
                <th className="py-2.5 text-right">Paid Amount</th>
                <th className="py-2.5 text-center">Payment Status</th>
                <th className="py-2.5 text-center">Order Status</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-6 text-muted">
                    No matching bills generated today. Press <strong>F2</strong> to create a new bill.
                  </td>
                </tr>
              ) : (
                filteredBills.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-hi/50 transition-colors">
                    <td className="py-2 text-muted font-mono">{b.createdAt}</td>
                    <td className="py-2 font-mono font-bold">
                      <Link
                        href={`/billing/orders/${b.id}`}
                        className="text-accent hover:underline flex items-center gap-1 group"
                        title={`Open Bill / Slip #${b.billNumber}`}
                      >
                        <span>{b.billNumber}</span>
                        <span className="opacity-0 group-hover:opacity-100 text-[10px] transition-opacity">↗</span>
                      </Link>
                    </td>
                    <td className="py-2 font-semibold text-ink max-w-xs truncate">{b.customerName}</td>
                    <td className="py-2">
                      <span className="bg-surface-hi text-muted text-[10px] px-2 py-0.5 rounded font-semibold">
                        {b.sellingMode}
                      </span>
                    </td>
                    <td className="py-2 text-center font-mono">{b.itemsCount}</td>
                    <td className="py-2 text-right font-mono font-black text-ink text-sm">
                      ₹{b.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono text-emerald-700 font-semibold">
                      ₹{b.paidAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${b.paymentStatus === "PAID"
                          ? "bg-emerald-500/15 text-emerald-700"
                          : b.paymentStatus === "PARTIALLY_PAID"
                            ? "bg-amber-500/15 text-amber-700"
                            : "bg-rose-500/15 text-rose-700"
                          }`}
                      >
                        {b.paymentStatus}
                      </span>
                    </td>
                    <td className="py-2 text-center">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${b.orderStatus === "COMPLETED" || b.orderStatus === "PAID"
                          ? "bg-emerald-500/10 text-emerald-700"
                          : b.orderStatus === "CANCELLED"
                            ? "bg-rose-500/10 text-rose-700 font-bold"
                            : "bg-sky-500/10 text-sky-700"
                          }`}
                      >
                        {b.orderStatus}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/billing/orders/${b.id}`}
                        className="btn text-[11px] px-2.5 py-1 hover:border-accent hover:text-accent font-medium"
                        title={`View Slip #${b.billNumber}`}
                      >
                        View Slip
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
