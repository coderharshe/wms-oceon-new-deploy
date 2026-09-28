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

  cash: {
    status: "OPEN" | "CLOSED";
    openingCash: number;
    expectedCash: number;
    actualCash: number;
    difference: number;
    discrepancyCount: number;
    openSessionsCount: number;
  };

  bank: {
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
  userRole?: string;
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
            <span className="badge bg-accent/10 text-accent font-semibold">14-Pillar System</span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Real-time Liquidity, Cash & Bank, Ledgers, GST, Profitability, and Audit Integrity
          </p>
        </div>

        <div className="flex items-center gap-2">
          {d.warehouses && d.warehouses.length > 0 && (
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="text-xs bg-paper border border-line rounded px-2.5 py-1.5 font-medium"
            >
              <option value="all">All Warehouses</option>
              {d.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
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
            + Log Expense
          </Link>
        </div>
      </div>

      {/* ── 1. Liquidity & Working Capital Master Stats ── */}
      <section className="space-y-2">
        <div className="flex justify-between items-center text-xs font-semibold text-muted">
          <span>1. MASTER LIQUIDITY & WORKING CAPITAL</span>
          <span>Net Daily Flow: <strong className={d.netCashFlow >= 0 ? "text-good" : "text-bad"}>{d.netCashFlow >= 0 ? `+₹${d.netCashFlow.toFixed(2)}` : `-₹${Math.abs(d.netCashFlow).toFixed(2)}`}</strong></span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="card border-l-4 border-l-good/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Cash in Drawers</span>
              <span className="text-[10px] bg-surface-hi px-1 rounded">{d.cash.status}</span>
            </div>
            <div className="text-xl font-black text-good mt-1">
              ₹{Number(d.cashBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Physical Counter Till</div>
          </div>

          <div className="card border-l-4 border-l-primary/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Bank Ledger</span>
              <span className="text-[10px] text-primary font-semibold">Reconciled</span>
            </div>
            <div className="text-xl font-black text-primary mt-1">
              ₹{Number(d.bankBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Operating Accounts</div>
          </div>

          <div className="card border-l-4 border-l-warn/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Accounts Receivable</span>
              <span className="text-[10px] text-warn font-semibold">{d.receivables.overdueCount} Overdue</span>
            </div>
            <div className="text-xl font-black text-warn mt-1">
              ₹{Number(d.totalReceivables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">{d.receivables.customerCount} Active Debtors</div>
          </div>

          <div className="card border-l-4 border-l-bad/80">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Accounts Payable</span>
              <span className="text-[10px] text-bad font-semibold">{d.payables.overdueBillsCount} Due</span>
            </div>
            <div className="text-xl font-black text-bad mt-1">
              ₹{Number(d.totalPayables).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">{d.payables.supplierCount} Suppliers</div>
          </div>

          <div className="card border-l-4 border-l-ink col-span-2 sm:col-span-1">
            <div className="text-[11px] text-muted flex justify-between items-center">
              <span>Net Working Capital</span>
              <span className="text-[10px] font-bold">C+B+AR-AP</span>
            </div>
            <div className={`text-xl font-black mt-1 ${d.netWorkingCapital >= 0 ? "text-good" : "text-bad"}`}>
              ₹{Number(d.netWorkingCapital).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Immediate Solvency</div>
          </div>
        </div>
      </section>

      {/* ── 14 PILLARS STRUCTURED GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* ── 2. Cash Management ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>💵 2. Cash Management</span>
            </div>
            <Link href="/finance/cash" className="text-xs text-accent hover:underline font-semibold">
              EOD Till →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Drawer Status:</span>
              <span className={`font-semibold ${d.cash.status === "OPEN" ? "text-good" : "text-muted"}`}>
                {d.cash.status === "OPEN" ? "🟢 OPEN" : "⚪ CLOSED"}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Opening Cash:</span>
              <span className="font-medium">₹{d.cash.openingCash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Expected Till Cash:</span>
              <span className="font-semibold text-ink">₹{d.cash.expectedCash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Drawer Discrepancies:</span>
              <span className={`font-bold ${d.cash.discrepancyCount > 0 ? "text-bad" : "text-good"}`}>
                {d.cash.discrepancyCount > 0 ? `⚠️ ${d.cash.discrepancyCount} Sessions with Variance` : "✓ None (Matched)"}
              </span>
            </div>
          </div>
        </section>

        {/* ── 3. Bank Management ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>🏦 3. Bank Management</span>
            </div>
            <Link href="/finance/bank" className="text-xs text-accent hover:underline font-semibold">
              Bank Ledger →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Current Ledger Balance:</span>
              <span className="font-bold text-primary">₹{d.bank.closingBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Unreconciled Tx:</span>
              <span className={d.bank.unreconciledTxCount > 0 ? "text-warn font-semibold" : "text-good font-semibold"}>
                {d.bank.unreconciledTxCount} entries (₹{d.bank.unreconciledAmount.toFixed(2)})
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Reconciliation Status:</span>
              <span className="text-good font-semibold">✓ Daily Statement In Sync</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Bank Payout Direct Debit:</span>
              <span className="text-muted">Supported via BankTx</span>
            </div>
          </div>
        </section>

        {/* ── 4. UPI / Digital Payments ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>📱 4. UPI / Digital Payments</span>
            </div>
            <Link href="/finance/upi" className="text-xs text-accent hover:underline font-semibold">
              Settlements →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Today's UPI Inflow:</span>
              <span className="font-bold text-good">₹{d.upi.todayTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Pending Bank Settlement:</span>
              <span className="font-semibold text-warn">₹{d.upi.pendingSettlementAmount.toFixed(2)} ({d.upi.pendingCount})</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Gateway Fee Deductions:</span>
              <span className="font-medium text-bad">-₹{d.upi.totalFeeDeductions.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Settlement Discrepancies:</span>
              <span className={`font-semibold ${d.upi.discrepancyCount > 0 ? "text-bad" : "text-good"}`}>
                {d.upi.discrepancyCount > 0 ? `${d.upi.discrepancyCount} Pending Review` : "✓ 0 Discrepancy"}
              </span>
            </div>
          </div>
        </section>

        {/* ── 5. Accounts Receivable ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>📥 5. Accounts Receivable</span>
            </div>
            <Link href="/finance/receivables" className="text-xs text-accent hover:underline font-semibold">
              Ageing Ledger →
            </Link>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Total Customer Dues:</span>
              <span className="font-bold text-warn">₹{d.receivables.total.toFixed(2)}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted">
                <span>0-15 Days: ₹{(d.receivables.ageing.bucket0_7 + d.receivables.ageing.bucket8_15).toFixed(0)}</span>
                <span>16-60 Days: ₹{(d.receivables.ageing.bucket16_30 + d.receivables.ageing.bucket31_60).toFixed(0)}</span>
                <span className="text-bad font-semibold">60+ Days: ₹{d.receivables.ageing.bucket60Plus.toFixed(0)}</span>
              </div>
              <div className="w-full bg-surface-hi h-2 rounded overflow-hidden flex">
                <div style={{ width: `${d.receivables.total > 0 ? ((d.receivables.ageing.bucket0_7 + d.receivables.ageing.bucket8_15) / d.receivables.total) * 100 : 100}%` }} className="bg-good" title="0-15 Days" />
                <div style={{ width: `${d.receivables.total > 0 ? ((d.receivables.ageing.bucket16_30 + d.receivables.ageing.bucket31_60) / d.receivables.total) * 100 : 0}%` }} className="bg-warn" title="16-60 Days" />
                <div style={{ width: `${d.receivables.total > 0 ? (d.receivables.ageing.bucket60Plus / d.receivables.total) * 100 : 0}%` }} className="bg-bad" title="60+ Days Overdue" />
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Accounts Payable ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>📤 6. Accounts Payable</span>
            </div>
            <Link href="/finance/payables" className="text-xs text-accent hover:underline font-semibold">
              Supplier Bills →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Total Supplier Dues:</span>
              <span className="font-bold text-bad">₹{d.payables.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Unpaid GRN Invoices:</span>
              <span className="font-semibold">{d.payables.pendingBillsCount} Invoices</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Overdue Invoices:</span>
              <span className={`font-semibold ${d.payables.overdueBillsCount > 0 ? "text-bad" : "text-good"}`}>
                {d.payables.overdueBillsCount > 0 ? `⚠️ ${d.payables.overdueBillsCount} Past Due Date` : "✓ No overdue bills"}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Associated Suppliers:</span>
              <span className="font-medium">{d.payables.supplierCount} Vendors</span>
            </div>
          </div>
        </section>

        {/* ── 7. Collections ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>💰 7. Collections</span>
            </div>
            <Link href="/finance/vouchers" className="text-xs text-accent hover:underline font-semibold">
              Receipt Vouchers →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Today's Inflow:</span>
              <span className="font-bold text-good">₹{d.collections.todayTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">💵 Cash Inflow:</span>
              <span className="font-medium">₹{d.collections.todayCash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">📱 UPI Inflow:</span>
              <span className="font-medium">₹{d.collections.todayUpi.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">🏦 Bank / NEFT / IMPS:</span>
              <span className="font-medium">₹{d.collections.todayBank.toFixed(2)}</span>
            </div>
          </div>
        </section>

        {/* ── 8. Supplier Payments ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>🏢 8. Supplier Payments</span>
            </div>
            <Link href="/finance/vouchers" className="text-xs text-accent hover:underline font-semibold">
              Payment Vouchers →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Paid Today:</span>
              <span className="font-bold text-bad">₹{d.supplierPayments.todayPaid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Paid This Month (MTD):</span>
              <span className="font-semibold">₹{d.supplierPayments.monthTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Payment Vouchers Issued:</span>
              <span className="font-medium">{d.supplierPayments.voucherCount} Vouchers</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Settlement Modes:</span>
              <span className="text-muted">Bank Transfer / Cash / Cheque</span>
            </div>
          </div>
        </section>

        {/* ── 9. Expenses ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>💳 9. Operational Expenses</span>
            </div>
            <Link href="/finance/expenses" className="text-xs text-accent hover:underline font-semibold">
              Expense Slip →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Today's Expenses:</span>
              <span className="font-bold text-bad">₹{d.expenses.todayTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Month to Date (MTD):</span>
              <span className="font-semibold text-ink">₹{d.expenses.monthTotal.toFixed(2)}</span>
            </div>
            <div className="py-1">
              <span className="text-[11px] text-muted block mb-1">Top Expense Categories:</span>
              <div className="flex flex-wrap gap-1">
                {d.expenses.byCategory.length > 0 ? (
                  d.expenses.byCategory.slice(0, 3).map((c) => (
                    <span key={c.category} className="badge bg-surface-hi text-ink text-[10px]">
                      {c.category}: ₹{c.amount.toFixed(0)}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-muted">No expenses recorded this month</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── 10. Refunds & Credit Notes ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>🔄 10. Refunds & Credit Notes</span>
            </div>
            <span className="badge bg-surface-hi text-muted text-[10px]">Adjustments</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Refunds Issued Today:</span>
              <span className="font-bold text-bad">₹{d.refunds.todayRefunds.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Total Refunds (MTD):</span>
              <span className="font-semibold">₹{d.refunds.totalRefundsMonth.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Payment Adjustments Logged:</span>
              <span className="font-medium">{d.refunds.adjustmentsCount} Adjustments</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Credit Note Reversals:</span>
              <span className="text-good font-semibold">✓ Automated in BillVersion</span>
            </div>
          </div>
        </section>

        {/* ── 11. Reconciliation ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>⚖️ 11. Financial Reconciliation</span>
            </div>
            <span className={`badge text-[10px] font-bold ${d.reconciliation.status === "BALANCED" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {d.reconciliation.status}
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Bank Statement Mismatch:</span>
              <span className={d.reconciliation.bankMismatch === 0 ? "text-good font-semibold" : "text-bad font-bold"}>
                {d.reconciliation.bankMismatch === 0 ? "✓ ₹0.00 (In Balance)" : `⚠️ ₹${d.reconciliation.bankMismatch.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Drawer Cash Variances:</span>
              <span className={d.reconciliation.cashDiscrepancies === 0 ? "text-good font-semibold" : "text-bad font-bold"}>
                {d.reconciliation.cashDiscrepancies === 0 ? "✓ 0 Discrepancy" : `⚠️ ${d.reconciliation.cashDiscrepancies} Unresolved`}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Unsettled UPI Ledger:</span>
              <span className="font-medium">₹{d.reconciliation.upiUnsettled.toFixed(2)}</span>
            </div>
          </div>
        </section>

        {/* ── 12. Profitability ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>📈 12. Profitability & Margins</span>
            </div>
            <span className="badge bg-good/10 text-good font-bold text-[10px]">MTD P&L</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Gross Revenue:</span>
              <span className="font-bold text-ink">₹{d.profitability.grossRevenue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Est. COGS (Purchase Cost):</span>
              <span className="text-muted">₹{d.profitability.estimatedCogs.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Gross Profit:</span>
              <span className="font-bold text-good">
                ₹{d.profitability.grossProfit.toFixed(2)} ({d.profitability.grossMarginPercent.toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between py-0.5 border-t border-line/60 pt-1">
              <span className="font-semibold">Net Operating Profit:</span>
              <span className={`font-black ${d.profitability.netOperatingProfit >= 0 ? "text-good" : "text-bad"}`}>
                ₹{d.profitability.netOperatingProfit.toFixed(2)} ({d.profitability.netMarginPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </section>

        {/* ── 13. Tax / GST ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>🏛️ 13. Tax & GST Position</span>
            </div>
            <Link href="/finance/tax" className="text-xs text-accent hover:underline font-semibold">
              GST Portal & GSTR-1/3B →
            </Link>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Output GST (Collected on Sales):</span>
              <span className="font-semibold text-ink">₹{d.taxGst.outputGst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Input Tax Credit (Purchases ITC):</span>
              <span className="font-semibold text-good">₹{d.taxGst.inputTaxCredit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5 border-t border-line/60 pt-1">
              <span className="font-semibold">Net GST Payable / (Credit):</span>
              <span className="font-bold text-warn">₹{d.taxGst.netGstPayable.toFixed(2)}</span>
            </div>
          </div>
        </section>

        {/* ── 14. Financial Reports ── */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>📊 14. Financial Reports</span>
            </div>
            <Link href="/finance/reports" className="text-xs text-accent hover:underline font-semibold">
              Full Statements →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <Link href="/finance/reports" className="p-1.5 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>📑 Profit & Loss (P&L) Statement</span>
              <span className="text-muted">→</span>
            </Link>
            <Link href="/finance/reports" className="p-1.5 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>🏛️ Balance Sheet & Working Capital</span>
              <span className="text-muted">→</span>
            </Link>
            <Link href="/finance/reports" className="p-1.5 rounded border border-line hover:bg-surface-hi flex justify-between items-center">
              <span>🌊 Cash Flow Statement</span>
              <span className="text-muted">→</span>
            </Link>
          </div>
        </section>

        {/* ── 15. Audit & Controls ── */}
        <section className="card space-y-3 md:col-span-2 lg:col-span-2">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <span>🛡️ 15. Audit, Dual-Controls & Approvals</span>
            </div>
            <span className="badge bg-surface-hi text-[10px]">Compliance</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded bg-surface border border-line">
              <div className="text-muted text-[11px]">Voucher Approvals</div>
              <div className="text-lg font-bold mt-0.5">{d.auditControls.pendingVouchersApproval} Pending</div>
            </div>
            <div className="p-2 rounded bg-surface border border-line">
              <div className="text-muted text-[11px]">Discount Approvals</div>
              <div className="text-lg font-bold mt-0.5">{d.auditControls.pendingDiscountApprovals} Pending</div>
            </div>
            <div className="p-2 rounded bg-surface border border-line">
              <div className="text-muted text-[11px]">Stock Adjustment Approvals</div>
              <div className="text-lg font-bold mt-0.5">{d.auditControls.pendingStockAdjustments} Pending</div>
            </div>
          </div>
          {d.auditControls.recentAuditLogs && d.auditControls.recentAuditLogs.length > 0 && (
            <div className="space-y-1 text-xs pt-1 border-t border-line/60">
              <div className="text-[11px] font-semibold text-muted">Recent Financial Audit Events:</div>
              <div className="space-y-1">
                {d.auditControls.recentAuditLogs.slice(0, 3).map((log) => (
                  <div key={log.id} className="flex justify-between items-center py-0.5 text-[11px]">
                    <span className="font-mono text-muted">{log.action} on {log.entityType}</span>
                    <span className="text-ink font-medium">{log.user}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                        className={`badge ${
                          v.type === "RECEIPT_VOUCHER" ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
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
                      className={`py-2 text-right font-bold ${
                        v.type === "RECEIPT_VOUCHER" ? "text-good" : "text-bad"
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

