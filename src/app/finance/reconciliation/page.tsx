"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type UnreconciledItem = {
  id: string;
  source: "BANK" | "CASH_DRAWER" | "UPI" | "CHEQUE";
  type: string;
  partyName: string;
  referenceNo: string;
  amount: number;
  expectedAmount: number;
  difference: number;
  issue: string;
  status: "INVESTIGATING" | "RESOLVED";
  createdAt: string;
};

type PaymentTransactionItem = {
  id: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: string;
  referenceNo: string | null;
  recordedBy: string;
  timestamp: string;
};

type ReconciliationApiResponse = {
  businessDate: string;
  userRole: "ADMIN" | "MANAGER" | "FINANCE" | string;
  isMatched: boolean;
  triangulation: {
    systemSales: {
      grossSales: number;
      invoicedSales: number;
      orderCount: number;
      outstandingDue: number;
    };
    systemPayments: {
      totalCollected: number;
      cash: number;
      bank: number;
      upi: number;
      cheque: number;
      creditSales: number;
    };
    actualStatements: {
      cashCounted: number;
      cashSessionStatus: string;
      bankCredits: number;
      upiSettled: number;
      upiCharges: number;
    };
    variances: {
      cashVariance: number;
      bankVariance: number;
      upiVariance: number;
      totalVariance: number;
    };
  };
  unreconciledItems: UnreconciledItem[];
  recentTransactions: PaymentTransactionItem[];
};

export default function ReconciliationPage() {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<"triangulation" | "investigation" | "transactions">("triangulation");

  // Investigation & Resolve Modal State
  const [investigatingItem, setInvestigatingItem] = useState<UnreconciledItem | null>(null);
  const [resolutionType, setResolutionType] = useState<
    "BANK_CHARGES_WRITE_OFF" | "MANUAL_LEDGER_ADJUSTMENT" | "TIMING_DIFFERENCE" | "CASH_SHORTAGE_RECOVERY" | "RECONCILED_MATCH"
  >("RECONCILED_MATCH");
  const [resolutionNotes, setResolutionNotes] = useState("");

  // Daily Approval Modal State
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");

  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<ReconciliationApiResponse>(
    `/api/finance/reconciliation?date=${date}`
  );

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { triangulation, isMatched, unreconciledItems, userRole } = data;
  const canApprove = userRole === "ADMIN" || userRole === "MANAGER";

  const openInvestigateModal = (item: UnreconciledItem) => {
    setInvestigatingItem(item);
    if (item.source === "BANK") setResolutionType("RECONCILED_MATCH");
    else if (item.source === "UPI") setResolutionType("BANK_CHARGES_WRITE_OFF");
    else setResolutionType("CASH_SHORTAGE_RECOVERY");
    setResolutionNotes(`Resolution for ${item.issue}`);
    setFeedback(null);
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!investigatingItem) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RESOLVE_DISCREPANCY",
          itemId: investigatingItem.id,
          source: investigatingItem.source,
          resolutionType,
          resolutionNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to resolve discrepancy");

      setFeedback({ type: "success", message: `Discrepancy resolved via ${resolutionType.replace(/_/g, " ")}!` });
      setTimeout(() => {
        setInvestigatingItem(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to resolve" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveDailyRecon = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE_DAILY_RECONCILIATION",
          businessDate: date,
          closingNotes: approvalNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to approve reconciliation");

      setFeedback({ type: "success", message: `Daily reconciliation for ${date} signed off & approved by ${userRole}!` });
      setTimeout(() => {
        setShowApprovalModal(false);
        reload();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to approve" });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Banner & Date Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚖️</span>
            <h1 className="text-xl font-black text-ink">Finance Reconciliation & Audit Core</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Triangulate System Sales &rarr; Recorded Payments &rarr; Physical / Bank Statements &rarr; Investigate & Resolve
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Picker */}
          <div className="flex items-center gap-1.5 bg-surface p-1 rounded-lg border border-line text-xs">
            <span className="text-muted px-1.5 font-semibold">Date:</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent font-bold text-ink focus:outline-none"
            />
            <button
              onClick={() => setDate(new Date().toISOString().slice(0, 10))}
              className="px-2 py-0.5 bg-surface-hi rounded text-[10px] font-semibold text-muted hover:text-ink"
            >
              Today
            </button>
          </div>

          {/* Match Status Badge */}
          {isMatched ? (
            <span className="px-3 py-1.5 rounded-lg bg-good/15 text-good border border-good/40 text-xs font-bold flex items-center gap-1.5">
              <span>✓</span>
              <span>100% Matched & Balanced</span>
            </span>
          ) : (
            <span className="px-3 py-1.5 rounded-lg bg-bad/15 text-bad border border-bad/40 text-xs font-bold flex items-center gap-1.5 animate-pulse">
              <span>⚠️</span>
              <span>Variance: ₹{triangulation.variances.totalVariance.toFixed(2)}</span>
            </span>
          )}

          {canApprove && (
            <button
              onClick={() => {
                setApprovalNotes(`Reconciliation verified and approved for ${date}`);
                setShowApprovalModal(true);
                setFeedback(null);
              }}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-good text-white hover:bg-good/90 shadow-md flex items-center gap-1.5 transition-all"
            >
              🛡️ Approve Daily Recon
            </button>
          )}
        </div>
      </div>

      {/* Visual Triangulation Cards (The Heart of Finance) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {/* 1. SYSTEM SALES */}
        <div className="card p-4 border-l-4 border-l-indigo-500 bg-indigo-500/[0.02] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700">1️⃣ SYSTEM SALES</span>
            <span className="text-[10px] bg-indigo-500/10 text-indigo-700 px-1.5 py-0.5 rounded font-mono">
              {triangulation.systemSales.orderCount} Orders
            </span>
          </div>
          <div className="text-2xl font-black text-ink">
            ₹{triangulation.systemSales.invoicedSales.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-muted space-y-1 pt-1 border-t border-line/50">
            <div className="flex justify-between">
              <span>Gross Billed:</span>
              <span className="font-semibold text-ink">₹{triangulation.systemSales.grossSales.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Credit Sales (Unpaid):</span>
              <span className="font-semibold text-warn">₹{triangulation.systemSales.outstandingDue.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 2. SYSTEM PAYMENTS */}
        <div className="card p-4 border-l-4 border-l-sky-500 bg-sky-500/[0.02] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-700">2️⃣ SYSTEM PAYMENTS</span>
            <span className="text-[10px] bg-sky-500/10 text-sky-700 px-1.5 py-0.5 rounded">All Tenders</span>
          </div>
          <div className="text-2xl font-black text-sky-700">
            ₹{triangulation.systemPayments.totalCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-muted space-y-1 pt-1 border-t border-line/50">
            <div className="flex justify-between">
              <span>Cash Recorded:</span>
              <span className="font-semibold text-ink">₹{triangulation.systemPayments.cash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Bank (NEFT/RTGS):</span>
              <span className="font-semibold text-ink">₹{triangulation.systemPayments.bank.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>UPI / QR:</span>
              <span className="font-semibold text-ink">₹{triangulation.systemPayments.upi.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 3. ACTUAL STATEMENTS */}
        <div className="card p-4 border-l-4 border-l-purple-500 bg-purple-500/[0.02] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-700">3️⃣ ACTUAL STATEMENTS</span>
            <span className="text-[10px] bg-purple-500/10 text-purple-700 px-1.5 py-0.5 rounded font-mono">External</span>
          </div>
          <div className="text-2xl font-black text-purple-700">
            ₹{(
              triangulation.actualStatements.cashCounted +
              triangulation.actualStatements.bankCredits +
              triangulation.actualStatements.upiSettled
            ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-muted space-y-1 pt-1 border-t border-line/50">
            <div className="flex justify-between">
              <span>Physical Cash Count:</span>
              <span className="font-semibold text-ink">₹{triangulation.actualStatements.cashCounted.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Bank Statement Credit:</span>
              <span className="font-semibold text-ink">₹{triangulation.actualStatements.bankCredits.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>UPI Gateway Settlement:</span>
              <span className="font-semibold text-ink">₹{triangulation.actualStatements.upiSettled.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 4. MATCH & VARIANCES */}
        <div className={`card p-4 border-l-4 space-y-2 ${
          isMatched ? "border-l-good bg-good/[0.03]" : "border-l-bad bg-bad/[0.03]"
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold ${isMatched ? "text-good" : "text-bad"}`}>
              4️⃣ MATCH STATUS
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              isMatched ? "bg-good text-white" : "bg-bad text-white"
            }`}>
              {isMatched ? "MATCHED" : "UNRECONCILED"}
            </span>
          </div>
          <div className={`text-2xl font-black ${isMatched ? "text-good" : "text-bad"}`}>
            {isMatched ? "₹0.00 Delta" : `₹${triangulation.variances.totalVariance.toFixed(2)} Diff`}
          </div>
          <div className="text-xs text-muted space-y-1 pt-1 border-t border-line/50">
            <div className="flex justify-between">
              <span>Cash Variance:</span>
              <span className={`font-semibold ${triangulation.variances.cashVariance === 0 ? "text-good" : "text-bad"}`}>
                ₹{triangulation.variances.cashVariance.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Bank Statement Variance:</span>
              <span className={`font-semibold ${triangulation.variances.bankVariance === 0 ? "text-good" : "text-bad"}`}>
                ₹{triangulation.variances.bankVariance.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>UPI Settlement Variance:</span>
              <span className={`font-semibold ${triangulation.variances.upiVariance === 0 ? "text-good" : "text-bad"}`}>
                ₹{triangulation.variances.upiVariance.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
          <button
            onClick={() => setActiveTab("triangulation")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "triangulation" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            📊 Daily Triangulation Audit Sheet
          </button>
          <button
            onClick={() => setActiveTab("investigation")}
            className={`px-3 py-1.5 rounded transition-all flex items-center gap-1.5 ${
              activeTab === "investigation" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            <span>🔍 Unreconciled Investigation Queue</span>
            {unreconciledItems.length > 0 && (
              <span className="bg-bad text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {unreconciledItems.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("transactions")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "transactions" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            📋 Today&apos;s Receipts & Orders ({data.recentTransactions.length})
          </button>
        </div>
      </div>

      {/* TAB 1: DAILY TRIANGULATION AUDIT SHEET */}
      {activeTab === "triangulation" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Daily Reconciliation Triangulation Matrix</h2>
              <p className="text-[11px] text-muted">
                Channel-by-channel comparison of System Ledgers against Physical Till counts & Statement Credits
              </p>
            </div>
            <div className="text-xs font-semibold">
              Date: <strong className="text-ink font-mono">{date}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Payment Channel / Tender</th>
                <th className="py-3 px-3 text-right">System Recorded (A)</th>
                <th className="py-3 px-3 text-right">Actual Statement / Count (B)</th>
                <th className="py-3 px-3 text-right">Variance (B &minus; A)</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {/* Cash Channel */}
              <tr className="hover:bg-surface-hi/80 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-bold text-ink">💵 Physical Cash (Till / Drawer)</div>
                  <div className="text-[10px] text-muted">Drawer session state: {triangulation.actualStatements.cashSessionStatus}</div>
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.systemPayments.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.actualStatements.cashCounted.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`py-3 px-3 text-right font-black ${
                  triangulation.variances.cashVariance === 0 ? "text-good" : "text-bad"
                }`}>
                  {triangulation.variances.cashVariance > 0 ? "+" : ""}
                  ₹{triangulation.variances.cashVariance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-center">
                  {triangulation.variances.cashVariance === 0 ? (
                    <span className="text-[10px] font-bold text-good bg-good/15 px-2 py-0.5 rounded-full">
                      ✓ Balanced
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-bad bg-bad/15 px-2 py-0.5 rounded-full">
                      Discrepancy
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  {triangulation.variances.cashVariance !== 0 && (
                    <button
                      onClick={() => setActiveTab("investigation")}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-bad/10 text-bad hover:bg-bad/20"
                    >
                      Investigate
                    </button>
                  )}
                </td>
              </tr>

              {/* Bank Transfers */}
              <tr className="hover:bg-surface-hi/80 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-bold text-ink">🏦 Bank Account (NEFT / RTGS / IMPS)</div>
                  <div className="text-[10px] text-muted">HDFC Current & SBI Current Credits</div>
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.systemPayments.bank.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.actualStatements.bankCredits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`py-3 px-3 text-right font-black ${
                  triangulation.variances.bankVariance === 0 ? "text-good" : "text-bad"
                }`}>
                  {triangulation.variances.bankVariance > 0 ? "+" : ""}
                  ₹{triangulation.variances.bankVariance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-center">
                  {triangulation.variances.bankVariance === 0 ? (
                    <span className="text-[10px] font-bold text-good bg-good/15 px-2 py-0.5 rounded-full">
                      ✓ Balanced
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-bad bg-bad/15 px-2 py-0.5 rounded-full">
                      Unmatched Deposits
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  {triangulation.variances.bankVariance !== 0 && (
                    <button
                      onClick={() => setActiveTab("investigation")}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-bad/10 text-bad hover:bg-bad/20"
                    >
                      Investigate
                    </button>
                  )}
                </td>
              </tr>

              {/* UPI Digital Gateway */}
              <tr className="hover:bg-surface-hi/80 transition-colors">
                <td className="py-3 px-4">
                  <div className="font-bold text-ink">📱 UPI / QR Gateway Clearing</div>
                  <div className="text-[10px] text-muted">Settlement batch net of gateway charges</div>
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.systemPayments.upi.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right font-medium text-ink">
                  ₹{triangulation.actualStatements.upiSettled.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className={`py-3 px-3 text-right font-black ${
                  triangulation.variances.upiVariance === 0 ? "text-good" : "text-bad"
                }`}>
                  {triangulation.variances.upiVariance > 0 ? "+" : ""}
                  ₹{triangulation.variances.upiVariance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-center">
                  {triangulation.variances.upiVariance === 0 ? (
                    <span className="text-[10px] font-bold text-good bg-good/15 px-2 py-0.5 rounded-full">
                      ✓ Balanced
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-bad bg-bad/15 px-2 py-0.5 rounded-full">
                      MDR / Timing Delta
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  {triangulation.variances.upiVariance !== 0 && (
                    <button
                      onClick={() => setActiveTab("investigation")}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-bad/10 text-bad hover:bg-bad/20"
                    >
                      Investigate
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: UNRECONCILED INVESTIGATION QUEUE */}
      {activeTab === "investigation" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Unreconciled Discrepancy Investigation Queue</h2>
              <p className="text-[11px] text-muted">
                Follow workflow: <strong>Unreconciled &rarr; Investigate &rarr; Resolve &rarr; Approve</strong>
              </p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Pending Items: <strong className="text-bad">{unreconciledItems.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-3">Party / Account</th>
                <th className="py-3 px-3">Reference / UTR #</th>
                <th className="py-3 px-3">Discrepancy Issue</th>
                <th className="py-3 px-3 text-right">Statement Amount (₹)</th>
                <th className="py-3 px-3 text-right">Variance Delta (₹)</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {unreconciledItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-good font-semibold">
                    ✓ All channels reconciled! Zero unreconciled discrepancies for {date}.
                  </td>
                </tr>
              ) : (
                unreconciledItems.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-bold text-ink">
                      <span className="bg-surface-hi px-2 py-0.5 rounded border border-line text-[10px]">
                        {item.source}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-ink">{item.partyName}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-muted">{item.referenceNo}</td>
                    <td className="py-3 px-3 text-bad font-medium">{item.issue}</td>
                    <td className="py-3 px-3 text-right font-bold text-ink">
                      ₹{item.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-bad">
                      ₹{Math.abs(item.difference).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openInvestigateModal(item)}
                        className="px-3 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm"
                      >
                        🔍 Investigate & Resolve
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: RECEIPTS & ORDERS BREAKDOWN */}
      {activeTab === "transactions" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Day&apos;s Inward Payment Receipts</h2>
              <p className="text-[11px] text-muted">All receipt transactions processed on {date}</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Total Receipts: <strong className="text-ink">{data.recentTransactions.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-3">Order #</th>
                <th className="py-3 px-3">Customer Shop</th>
                <th className="py-3 px-3">Tender Mode</th>
                <th className="py-3 px-3">Reference #</th>
                <th className="py-3 px-3">Cashier / Staff</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No payment transactions on this date.
                  </td>
                </tr>
              ) : (
                data.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-muted text-[11px]">
                      {new Date(tx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-3 px-3 font-bold text-ink">{tx.orderNumber}</td>
                    <td className="py-3 px-3 text-ink">{tx.customerName}</td>
                    <td className="py-3 px-3 font-semibold text-muted">{tx.method}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-muted">{tx.referenceNo || "—"}</td>
                    <td className="py-3 px-3 text-muted">{tx.recordedBy}</td>
                    <td className="py-3 px-4 text-right font-black text-good text-sm">
                      ₹{tx.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: INVESTIGATE & RESOLVE DISCREPANCY */}
      {investigatingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Investigate & Resolve Discrepancy</h3>
                <p className="text-xs text-muted">
                  Source: <strong className="text-ink">{investigatingItem.source}</strong> ({investigatingItem.partyName})
                </p>
              </div>
              <button onClick={() => setInvestigatingItem(null)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            {/* Issue Description Banner */}
            <div className="bg-bad/10 border border-bad/30 p-3 rounded-lg text-xs space-y-1">
              <div className="font-bold text-bad">⚠️ Discrepancy Detected:</div>
              <div className="text-ink">{investigatingItem.issue}</div>
              <div className="text-[11px] text-muted flex justify-between pt-1">
                <span>Statement Amount: <strong>₹{investigatingItem.amount.toFixed(2)}</strong></span>
                <span>Variance: <strong className="text-bad">₹{Math.abs(investigatingItem.difference).toFixed(2)}</strong></span>
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${
                  feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
                }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleResolveSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Resolution Action *</label>
                <select
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                >
                  <option value="RECONCILED_MATCH">✓ Verified & Match with Sales Ledger</option>
                  <option value="BANK_CHARGES_WRITE_OFF">💳 Bank / Gateway Charges Write-Off (MDR Fee)</option>
                  <option value="TIMING_DIFFERENCE">⏳ Timing Difference / In-Transit Clearance</option>
                  <option value="CASH_SHORTAGE_RECOVERY">💵 Cash Shortage Staff Liability / Petty Cash</option>
                  <option value="MANUAL_LEDGER_ADJUSTMENT">📝 Manual Ledger Adjustment</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Audit Resolution Notes / Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="e.g. MDR charges of ₹14.50 verified with Razorpay settlement slip"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setInvestigatingItem(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Processing..." : "Confirm & Resolve Discrepancy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: APPROVE DAILY RECONCILIATION */}
      {showApprovalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Approve Daily Reconciliation</h3>
                <p className="text-xs text-muted">
                  Official supervisory sign-off for <strong className="text-ink">{date}</strong>
                </p>
              </div>
              <button onClick={() => setShowApprovalModal(false)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            <div className="bg-good/10 border border-good/30 p-3 rounded-lg text-xs space-y-1">
              <div className="font-bold text-good">🛡️ Supervisory Sign-off:</div>
              <div className="text-muted">
                Approving this daily audit commits that all Cash, Bank, and UPI accounts have been reconciled with external records.
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${
                  feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
                }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleApproveDailyRecon} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Sign-off Remarks</label>
                <textarea
                  rows={2}
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowApprovalModal(false)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-good text-white text-xs font-bold hover:bg-good/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Submitting..." : "✓ Approve & Seal Daily Recon"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
