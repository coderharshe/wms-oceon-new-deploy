"use client";

import Link from "next/link";
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

export default function FinanceDashboardPage() {
  const { data, loading, error, reload } = useApiGet<FinanceOverview>("/api/finance/dashboard");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  const d = data || {
    cashBalance: 0,
    bankBalance: 0,
    upiToday: 0,
    todayCollection: 0,
    todayCash: 0,
    todayExpenses: 0,
    totalReceivables: 0,
    totalPayables: 0,
    netCashFlow: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Finance Control Dashboard</h1>
          <p className="text-xs text-muted">Complete financial visibility: Cash, Bank, UPI, Receivables, Payables, and Vouchers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance/vouchers" className="btn btn-primary font-semibold text-xs">
            + New Voucher
          </Link>
          <Link href="/finance/expenses" className="btn text-xs">
            + Log Expense
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Drawer Cash Balance</div>
          <div className="text-2xl font-bold text-good">
            ₹{Number(d.cashBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Bank Balance</div>
          <div className="text-2xl font-bold text-primary">
            ₹{Number(d.bankBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Total Customer Receivables</div>
          <div className={`text-2xl font-bold ${d.totalReceivables > 0 ? "text-warn" : ""}`}>
            ₹{Number(d.totalReceivables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Total Supplier Payables</div>
          <div className={`text-2xl font-bold ${d.totalPayables > 0 ? "text-bad" : ""}`}>
            ₹{Number(d.totalPayables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Today's Collections</div>
          <div className="text-xl font-bold text-good">₹{Number(d.todayCollection).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Today's UPI Collections</div>
          <div className="text-xl font-bold">₹{Number(d.upiToday).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Today's Expenses</div>
          <div className="text-xl font-bold text-bad">₹{Number(d.todayExpenses).toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Net Daily Cash Flow</div>
          <div className={`text-xl font-bold ${d.netCashFlow >= 0 ? "text-good" : "text-bad"}`}>
            {d.netCashFlow >= 0 ? `+₹${d.netCashFlow.toFixed(2)}` : `-₹${Math.abs(d.netCashFlow).toFixed(2)}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Money Ledgers</h2>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <Link href="/finance/cash" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>💵 Cash Drawer & EOD Closing</span>
              <span className="text-muted">→</span>
            </Link>
            <Link href="/finance/bank" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>🏦 Bank Ledger & Reconciliation</span>
              <span className="text-muted">→</span>
            </Link>
            <Link href="/finance/upi" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>📱 UPI Settlement & Fee Deductions</span>
              <span className="text-muted">→</span>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Outstanding Ledgers</h2>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <Link href="/finance/receivables" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>📥 Customer Receivables & Ageing</span>
              <span className="text-warn font-semibold">₹{Number(d.totalReceivables).toFixed(2)}</span>
            </Link>
            <Link href="/finance/payables" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>📤 Supplier Payables & Dues</span>
              <span className="text-bad font-semibold">₹{Number(d.totalPayables).toFixed(2)}</span>
            </Link>
            <Link href="/finance/expenses" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>💳 Expense Categories & Slips</span>
              <span className="text-muted">→</span>
            </Link>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Vouchers & Reports</h2>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <Link href="/finance/vouchers" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>🧾 Payment & Receipt Vouchers</span>
              <span className="text-muted">→</span>
            </Link>
            <Link href="/finance/reports" className="p-2 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>📊 Profit & Loss, Balance & Cash Flow</span>
              <span className="text-muted">→</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
