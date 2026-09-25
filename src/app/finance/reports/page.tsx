"use client";

import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type FinanceOverview = {
  cashBalance: number;
  bankBalance: number;
  upiToday: number;
  todayCollection: number;
  todayCash: number;
  todayExpenses: number;
  totalReceivables: number;
  totalPayables: number;
  netCashFlow: number;
};

export default function FinanceReportsPage() {
  const { data, loading, error, reload } = useApiGet<FinanceOverview>("/api/finance/dashboard");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-lg font-bold">Financial Statements & Cash Flow Summary</h1>
        <p className="text-xs text-muted">Consolidated P&L indicators, liquidity position, and working capital overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="card space-y-3">
          <h2 className="text-sm font-bold border-b border-line pb-1 text-ink">📊 Liquidity & Cash Flow Statement</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Total Collections (Inflow):</span>
              <span className="font-bold text-good">+₹{data.todayCollection.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Total Operational Expenses (Outflow):</span>
              <span className="font-bold text-bad">-₹{data.todayExpenses.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line text-sm font-bold">
              <span>Net Operating Cash Flow:</span>
              <span className={data.netCashFlow >= 0 ? "text-good" : "text-bad"}>
                {data.netCashFlow >= 0 ? `+₹${data.netCashFlow.toFixed(2)}` : `-₹${Math.abs(data.netCashFlow).toFixed(2)}`}
              </span>
            </div>
          </div>
        </section>

        <section className="card space-y-3">
          <h2 className="text-sm font-bold border-b border-line pb-1 text-ink">🏦 Working Capital & Balance Position</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Physical Cash in Drawers:</span>
              <span className="font-semibold">₹{data.cashBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Bank Ledger Balance:</span>
              <span className="font-semibold">₹{data.bankBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Customer Receivables (Asset):</span>
              <span className="font-bold text-warn">₹{data.totalReceivables.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line/50">
              <span className="text-muted">Supplier Payables (Liability):</span>
              <span className="font-bold text-bad">₹{data.totalPayables.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line text-sm font-bold">
              <span>Net Working Capital:</span>
              <span className={(data.totalReceivables + data.cashBalance + data.bankBalance - data.totalPayables) >= 0 ? "text-good" : "text-bad"}>
                ₹{(data.totalReceivables + data.cashBalance + data.bankBalance - data.totalPayables).toFixed(2)}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
