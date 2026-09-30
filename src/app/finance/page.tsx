"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type FinanceDashboardData = {
  cashBalance: number;
  bankBalance: number;
  totalReceivables: number;
  totalPayables: number;
  netWorkingCapital: number;
  netCashFlow: number;
  totalReceivedToday?: number;
  totalPaidToday?: number;
  netReceivedToday?: number;

  cash: {
    status: "OPEN" | "CLOSED";
    todayCash?: number;
    openingCash: number;
    expectedCash: number;
    actualCash: number;
    difference: number;
    discrepancyCount: number;
    openSessionsCount: number;
  };

  bank: {
    todayBank?: number;
    closingBalance: number;
    unreconciledTxCount: number;
    unreconciledAmount: number;
    recentTxCount: number;
  };

  upi: {
    todayTotal: number;
    pendingSettlementAmount: number;
    pendingCount: number;
    discrepancyCount: number;
    totalFeeDeductions: number;
  };

  receivables: {
    total: number;
    customerCount: number;
    overdueCount: number;
    ageing: {
      bucket0_7: number;
      bucket8_15: number;
      bucket16_30: number;
      bucket31_60: number;
      bucket60Plus: number;
    };
  };

  payables: {
    total: number;
    supplierCount: number;
    overdueBillsCount: number;
    pendingBillsCount: number;
  };

  collections: {
    todayTotal: number;
    todayCash: number;
    todayUpi: number;
    todayBank: number;
    txCount: number;
  };

  supplierPayments: {
    monthTotal: number;
    todayPaid: number;
    voucherCount: number;
  };

  expenses: {
    todayTotal: number;
    monthTotal: number;
    byCategory: { category: string; amount: number }[];
    pendingApprovalCount: number;
  };

  refunds: {
    todayRefunds: number;
    totalRefundsMonth: number;
    adjustmentsCount: number;
    pendingRefundCount: number;
  };

  reconciliation: {
    bankMismatch: number;
    cashDiscrepancies: number;
    upiUnsettled: number;
    status: "BALANCED" | "ATTENTION_REQUIRED";
  };

  profitability: {
    grossRevenue: number;
    estimatedCogs: number;
    grossProfit: number;
    grossMarginPercent: number;
    operatingExpenses: number;
    netOperatingProfit: number;
    netMarginPercent: number;
  };

  taxGst: {
    outputGst: number;
    inputTaxCredit: number;
    netGstPayable: number;
    pendingInvoicesCount: number;
  };

  reports: {
    pnlReady: boolean;
    balanceSheetBalanced: boolean;
    cashFlowPositive: boolean;
  };

  auditControls: {
    pendingVouchersApproval: number;
    pendingDiscountApprovals: number;
    pendingStockAdjustments: number;
    recentAuditLogs: {
      id: string;
      action: string;
      entityType: string;
      timestamp: string;
      user: string;
    }[];
  };

  trend: { date: string; label: string; collections: number; expenses: number; net: number }[];
  recentVouchers: {
    id: string;
    voucherNo: string;
    type: "RECEIPT_VOUCHER" | "PAYMENT_VOUCHER";
    date: string;
    partyName: string;
    partyType: string;
    amount: number;
    paymentMode: string;
    warehouse?: { name: string; code: string };
  }[];
  warehouses?: { id: string; name: string; code: string }[];
  currentWarehouse?: { id: string; name: string; code: string } | null;
  userRole?: string;
  dateRange?: {
    preset: string;
    startDateStr: string;
    endDateStr: string;
    label: string;
  };
};

export default function FinanceDashboardPage() {
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const queryParam = warehouseFilter !== "all" ? `?warehouseId=${warehouseFilter}` : "";

  const { data, loading, error, reload } = useApiGet<FinanceDashboardData>(`/api/finance/dashboard${queryParam}`);

  if (loading) return <SkeletonStats count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const d = data;

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header & Global Filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-ink">Finance Control Center</h1>
            {d.currentWarehouse && (
              <span className="badge bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                🏢 {d.currentWarehouse.name} ({d.currentWarehouse.code})
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {d.userRole === "ADMIN" && d.warehouses && d.warehouses.length > 0 && (
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="text-xs bg-paper border border-line rounded px-2.5 py-1.5 font-medium"
            >
              <option value="all">🌐 All Warehouses</option>
              {d.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  🏢 {w.name} ({w.code})
                </option>
              ))}
            </select>
          )}

          <button onClick={() => reload()} className="btn text-xs font-semibold" title="Refresh data">
            🔄 Refresh
          </button>
          <Link href="/finance/vouchers" className="btn btn-primary font-semibold text-xs">
            + New Voucher
          </Link>
          <Link href="/finance/expenses" className="btn text-xs font-semibold">
            🧾 Expenses
          </Link>
        </div>
      </div>

      {/* ── 1. Liquidity & Working Capital Master Stats ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap justify-between items-center text-xs font-semibold text-muted gap-2">
          <span>1. MASTER LIQUIDITY & WORKING CAPITAL</span>
          <div className="flex items-center gap-3 text-xs">
            <span>Inflow: <strong className="text-good font-mono">+₹{Number(d.totalReceivedToday ?? d.collections.todayTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
            <span>Outflow: <strong className="text-bad font-mono">-₹{Number(d.totalPaidToday ?? (d.supplierPayments.todayPaid + d.expenses.todayTotal + d.refunds.todayRefunds)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
            <span>Net Position: <strong className={`font-mono font-black ${d.netCashFlow >= 0 ? "text-good" : "text-bad"}`}>{d.netCashFlow >= 0 ? `+₹${d.netCashFlow.toFixed(2)}` : `-₹${Math.abs(d.netCashFlow).toFixed(2)}`}</strong></span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="card border-l-4 border-l-good/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Cash in Hand</span>
              <span className="text-[10px] bg-surface-hi px-1 rounded">{d.cash.status}</span>
            </div>
            <div className="text-xl font-black text-good mt-1 font-mono">
              ₹{Number(d.cashBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Physical Counter Till (Till Date)</div>
          </div>

          <div className="card border-l-4 border-l-primary/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Bank Balance</span>
              <span className="text-[10px] text-primary font-semibold">In Account</span>
            </div>
            <div className="text-xl font-black text-primary mt-1 font-mono">
              ₹{Number(d.bankBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Operating Accounts (Till Date)</div>
          </div>

          <div className="card border-l-4 border-l-warn/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Accounts Receivable</span>
              <span className="text-[10px] text-warn font-semibold">{d.receivables.overdueCount} Overdue</span>
            </div>
            <div className="text-xl font-black text-warn mt-1 font-mono">
              ₹{Number(d.totalReceivables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">{d.receivables.customerCount} Active Debtors</div>
          </div>

          <div className="card border-l-4 border-l-bad/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Accounts Payable</span>
              <span className="text-[10px] text-bad font-semibold">{d.payables.overdueBillsCount} Due</span>
            </div>
            <div className="text-xl font-black text-bad mt-1 font-mono">
              ₹{Number(d.totalPayables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">{d.payables.supplierCount} Suppliers</div>
          </div>

          <div className="card border-l-4 border-l-ink col-span-2 sm:col-span-1">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Net Working Capital</span>
              <span className="text-[10px] font-bold">Liquid - Dues</span>
            </div>
            <div className={`text-xl font-black mt-1 font-mono ${d.netWorkingCapital >= 0 ? "text-good" : "text-bad"}`}>
              ₹{Number(d.netWorkingCapital).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Solvency (C+B+AR - AP)</div>
          </div>
        </div>
      </section>

      {/* ── 14 PILLARS STRUCTURED GRID ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {/* ── 2. Cash Management ── */}
        <section className="card p-3.5 border-l-4 border-l-emerald-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>💵 Cash Received Today</span>
            </div>
            <Link href="/finance/cash" className="text-xs text-accent hover:underline font-semibold">
              EOD Till →
            </Link>
          </div>
          <div className="text-xl font-black text-emerald-600 font-mono mt-1">
            ₹{Number(d.cash.todayCash ?? d.collections.todayCash).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span className="flex items-center gap-1">
              <span>Drawer:</span>
              <strong className={d.cash.status === "OPEN" ? "text-good font-bold" : "text-muted"}>
                {d.cash.status === "OPEN" ? "🟢 OPEN" : "⚪ CLOSED"}
              </strong>
            </span>
            <span>Till: ₹{Number(d.cash.expectedCash).toFixed(0)}</span>
          </div>
        </section>

        {/* ── 3. Bank Management ── */}
        <section className="card p-3.5 border-l-4 border-l-sky-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>🏦 Bank Received Today</span>
            </div>
            <Link href="/finance/bank" className="text-xs text-accent hover:underline font-semibold">
              Ledger →
            </Link>
          </div>
          <div className="text-xl font-black text-sky-600 font-mono mt-1">
            ₹{Number(d.bank.todayBank ?? d.collections.todayBank).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Ledger: ₹{Number(d.bank.closingBalance).toFixed(0)}</span>
            <span className={d.bank.unreconciledTxCount > 0 ? "text-warn font-semibold" : "text-good font-semibold"}>
              {d.bank.unreconciledTxCount > 0 ? `⚠️ ${d.bank.unreconciledTxCount} Unreconciled` : "✓ Synced"}
            </span>
          </div>
        </section>

        {/* ── 4. UPI / Digital Payments ── */}
        <section className="card p-3.5 border-l-4 border-l-indigo-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>📱 UPI Received Today</span>
            </div>
            <Link href="/finance/upi" className="text-xs text-accent hover:underline font-semibold">
              Settlements →
            </Link>
          </div>
          <div className="text-xl font-black text-indigo-600 font-mono mt-1">
            ₹{Number(d.upi.todayTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Pending: ₹{d.upi.pendingSettlementAmount.toFixed(0)}</span>
            <span className={d.upi.discrepancyCount > 0 ? "text-bad font-semibold" : "text-good font-semibold"}>
              {d.upi.discrepancyCount > 0 ? `⚠️ ${d.upi.discrepancyCount} Pending` : "✓ 0 Discrepancy"}
            </span>
          </div>
        </section>

        {/* ── 5. Accounts Receivable ── */}
        <section className="card p-3.5 border-l-4 border-l-amber-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>📥 Receivables</span>
            </div>
            <Link href="/finance/receivables" className="text-xs text-accent hover:underline font-semibold">
              Ageing →
            </Link>
          </div>
          <div className="text-xl font-black text-warn font-mono mt-1">
            ₹{Number(d.receivables.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>0-15d: ₹{(d.receivables.ageing.bucket0_7 + d.receivables.ageing.bucket8_15).toFixed(0)}</span>
            <span className="text-bad font-semibold">60+d: ₹{d.receivables.ageing.bucket60Plus.toFixed(0)}</span>
          </div>
        </section>

        {/* ── 6. Accounts Payable ── */}
        <section className="card p-3.5 border-l-4 border-l-rose-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>📤 Payables</span>
            </div>
            <Link href="/finance/payables" className="text-xs text-accent hover:underline font-semibold">
              Supplier Bills →
            </Link>
          </div>
          <div className="text-xl font-black text-bad font-mono mt-1">
            ₹{Number(d.payables.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>{d.payables.pendingBillsCount} Unpaid</span>
            <span className={d.payables.overdueBillsCount > 0 ? "text-bad font-semibold" : "text-good font-semibold"}>
              {d.payables.overdueBillsCount > 0 ? `⚠️ ${d.payables.overdueBillsCount} Overdue` : "✓ No Overdue"}
            </span>
          </div>
        </section>

        {/* ── 7. Collections ── */}
        <section className="card p-3.5 border-l-4 border-l-green-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>💰 Collections</span>
            </div>
            <Link href="/finance/vouchers" className="text-xs text-accent hover:underline font-semibold">
              Receipts →
            </Link>
          </div>
          <div className="text-xl font-black text-good font-mono mt-1">
            ₹{Number(d.collections.todayTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Cash: ₹{d.collections.todayCash.toFixed(0)}</span>
            <span>UPI: ₹{d.collections.todayUpi.toFixed(0)}</span>
          </div>
        </section>

        {/* ── 8. Supplier Payments ── */}
        <section className="card p-3.5 border-l-4 border-l-red-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>🏢 Supplier Payments</span>
            </div>
            <Link href="/finance/vouchers" className="text-xs text-accent hover:underline font-semibold">
              Vouchers →
            </Link>
          </div>
          <div className="text-xl font-black text-bad font-mono mt-1">
            ₹{Number(d.supplierPayments.todayPaid).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>MTD: ₹{d.supplierPayments.monthTotal.toFixed(0)}</span>
            <span>{d.supplierPayments.voucherCount} Vouchers</span>
          </div>
        </section>

        {/* ── 9. Operational Expenses ── */}
        <section className="card p-3.5 border-l-4 border-l-orange-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>💳 Expenses</span>
            </div>
            <Link href="/finance/expenses" className="text-xs text-accent hover:underline font-semibold">
              Expenses →
            </Link>
          </div>
          <div className="text-xl font-black text-bad font-mono mt-1">
            ₹{Number(d.expenses.todayTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>MTD: ₹{d.expenses.monthTotal.toFixed(0)}</span>
            <span>{d.expenses.byCategory?.[0]?.category || "General"}</span>
          </div>
        </section>

        {/* ── 10. Refunds & Credit Notes ── */}
        <section className="card p-3.5 border-l-4 border-l-purple-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>🔄 Refunds & Adjustments</span>
            </div>
            <span className="badge bg-surface-hi text-muted text-[10px]">Credits</span>
          </div>
          <div className="text-xl font-black text-bad font-mono mt-1">
            ₹{Number(d.refunds.todayRefunds).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>MTD: ₹{d.refunds.totalRefundsMonth.toFixed(0)}</span>
            <span>{d.refunds.adjustmentsCount} Logged</span>
          </div>
        </section>

        {/* ── 11. Financial Reconciliation ── */}
        <section className="card p-3.5 border-l-4 border-l-cyan-500 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>⚖️ Reconciliation</span>
            </div>
            <span className={`badge text-[10px] font-bold ${d.reconciliation.status === "BALANCED" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {d.reconciliation.status}
            </span>
          </div>
          <div className="text-xl font-black text-ink font-mono mt-1">
            {d.reconciliation.status === "BALANCED" ? "Balanced" : "Review Req."}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span className={d.reconciliation.bankMismatch === 0 ? "text-good font-semibold" : "text-bad font-bold"}>
              Bank: {d.reconciliation.bankMismatch === 0 ? "✓ Sync" : `⚠️ ₹${d.reconciliation.bankMismatch.toFixed(0)}`}
            </span>
            <span className={d.reconciliation.cashDiscrepancies === 0 ? "text-good font-semibold" : "text-bad font-bold"}>
              Till: {d.reconciliation.cashDiscrepancies === 0 ? "✓ 0 Diff" : `⚠️ ${d.reconciliation.cashDiscrepancies}`}
            </span>
          </div>
        </section>

        {/* ── 12. Profitability & Margins ── */}
        <section className="card p-3.5 border-l-4 border-l-emerald-600 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>📈 Profitability</span>
            </div>
            <span className="badge bg-good/10 text-good font-bold text-[10px]">MTD P&L</span>
          </div>
          <div className={`text-xl font-black font-mono mt-1 ${d.profitability.netOperatingProfit >= 0 ? "text-good" : "text-bad"}`}>
            ₹{Number(d.profitability.netOperatingProfit).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Gross: ₹{d.profitability.grossProfit.toFixed(0)}</span>
            <span className="font-semibold text-good">Margin: {d.profitability.netMarginPercent.toFixed(1)}%</span>
          </div>
        </section>

        {/* ── 13. Tax / GST ── */}
        <section className="card p-3.5 border-l-4 border-l-blue-600 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>🏛️ Tax & GST</span>
            </div>
            <Link href="/finance/tax" className="text-xs text-accent hover:underline font-semibold">
              GST Portal →
            </Link>
          </div>
          <div className="text-xl font-black text-warn font-mono mt-1">
            ₹{Number(d.taxGst.netGstPayable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Output: ₹{d.taxGst.outputGst.toFixed(0)}</span>
            <span className="text-good font-semibold">ITC: ₹{d.taxGst.inputTaxCredit.toFixed(0)}</span>
          </div>
        </section>

        {/* ── 14. Financial Reports ── */}
        <section className="card p-3.5 border-l-4 border-l-violet-600 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>📊 Financial Reports</span>
            </div>
            <Link href="/finance/reports" className="text-xs text-accent hover:underline font-semibold">
              Statements →
            </Link>
          </div>
          <div className="text-base font-bold text-ink mt-1 truncate">
            P&L, Balance Sheet
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Cash Flow & Ledgers</span>
            <span className="text-accent font-semibold">View All →</span>
          </div>
        </section>

        {/* ── 15. Audit & Controls ── */}
        <section className="card p-3.5 border-l-4 border-l-slate-600 hover:shadow-sm transition-all">
          <div className="flex justify-between items-center pb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-ink">
              <span>🛡️ Approvals & Audit</span>
            </div>
            <span className="badge bg-surface-hi text-[10px]">Dual-Control</span>
          </div>
          <div className="text-xl font-black text-ink font-mono mt-1">
            {d.auditControls.pendingVouchersApproval + d.auditControls.pendingDiscountApprovals + d.auditControls.pendingStockAdjustments} Pending
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted mt-2 pt-1.5 border-t border-line">
            <span>Vouchers: {d.auditControls.pendingVouchersApproval}</span>
            <span>Discounts: {d.auditControls.pendingDiscountApprovals}</span>
          </div>
        </section>
      </div>

      {/* ── 7-Day Inflow vs Outflow Visualizer ── */}
      <section className="card space-y-3">
        <div className="flex justify-between items-center border-b border-line pb-2">
          <div>
            <h2 className="text-sm font-bold text-ink">7-Day Cash Flow Dynamics</h2>
            <p className="text-[11px] text-muted">Daily comparison of Collections (Inflow) vs Operational Expenses (Outflow)</p>
          </div>
          <span className="text-xs font-semibold text-good">Real-time Stream</span>
        </div>

        <div className="grid grid-cols-7 gap-2 pt-2">
          {d.trend.map((day) => {
            const maxVal = Math.max(...d.trend.map((t) => Math.max(t.collections, t.expenses)), 100);
            const colHeight = Math.max(4, Math.round((day.collections / maxVal) * 80));
            const expHeight = Math.max(4, Math.round((day.expenses / maxVal) * 80));

            return (
              <div key={day.date} className="flex flex-col items-center gap-1.5 p-2 rounded bg-surface border border-line">
                <div className="h-24 w-full flex items-end justify-center gap-1.5 pb-1">
                  <div
                    style={{ height: `${colHeight}px` }}
                    className="w-3 bg-good rounded-t"
                    title={`Collections: ₹${day.collections.toFixed(2)}`}
                  />
                  <div
                    style={{ height: `${expHeight}px` }}
                    className="w-3 bg-bad/80 rounded-t"
                    title={`Expenses: ₹${day.expenses.toFixed(2)}`}
                  />
                </div>
                <div className="text-[10px] font-semibold text-center truncate w-full">{day.label}</div>
                <div className={`text-[10px] font-bold ${day.net >= 0 ? "text-good" : "text-bad"}`}>
                  {day.net >= 0 ? `+₹${day.net.toFixed(0)}` : `-₹${Math.abs(day.net).toFixed(0)}`}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Recent Vouchers & Activity Stream ── */}
      {d.recentVouchers && d.recentVouchers.length > 0 && (
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div>
              <h2 className="text-sm font-bold text-ink">Recent Vouchers & Transactions</h2>
              <p className="text-[11px] text-muted">Latest payment and receipt vouchers registered in system</p>
            </div>
            <Link href="/finance/vouchers" className="text-xs text-accent hover:underline font-semibold">
              View All Vouchers →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Voucher #</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Party</th>
                  <th className="py-2">Mode</th>
                  <th className="py-2">Date</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.recentVouchers.map((v) => (
                  <tr key={v.id} className="border-b border-line hover:bg-surface-hi">
                    <td className="py-2 font-mono font-medium">{v.voucherNo}</td>
                    <td className="py-2">
                      <span
                        className={`badge ${v.type === "RECEIPT_VOUCHER" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
                          }`}
                      >
                        {v.type === "RECEIPT_VOUCHER" ? "Receipt" : "Payment"}
                      </span>
                    </td>
                    <td className="py-2 font-medium">{v.partyName}</td>
                    <td className="py-2">
                      <span className="badge bg-surface-hi">{v.paymentMode}</span>
                    </td>
                    <td className="py-2 text-muted">{new Date(v.date).toLocaleDateString("en-IN")}</td>
                    <td
                      className={`py-2 text-right font-bold ${v.type === "RECEIPT_VOUCHER" ? "text-good" : "text-bad"
                        }`}
                    >
                      {v.type === "RECEIPT_VOUCHER" ? `+₹${Number(v.amount).toFixed(2)}` : `-₹${Number(v.amount).toFixed(2)}`}
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

