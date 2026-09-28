"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";

type TenderBreakdown = {
  cash: number;
  bank: number;
  cheque: number;
  upi: number;
};

type ReceivableItem = {
  id: string;
  orderNumber: string;
  billId: string | null;
  billNumber: string | null;
  customerId: string;
  retailerName: string;
  ownerName: string | null;
  mobile: string | null;
  gstin: string | null;
  invoiceDate: string;
  dueDate: string;
  billTotal: number;
  amountPaid: number;
  balanceDue: number;
  ageDays: number;
  daysOverdue: number;
  creditLimit: number | null;
  totalCustomerDebt: number;
  creditUsedPercent: number | null;
  tenderBreakdown: TenderBreakdown;
  warehouse: string;
};

type RetailerSummary = {
  customerId: string;
  retailerName: string;
  ownerName: string | null;
  mobile: string | null;
  gstin: string | null;
  creditLimit: number | null;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  oldestInvoiceDays: number;
  invoices: ReceivableItem[];
};

type ReceivablesApiResponse = {
  totalReceivables: number;
  ageing: {
    bucket0_7: number;
    bucket8_15: number;
    bucket16_30: number;
    bucket31_60: number;
    bucket60Plus: number;
  };
  receivablesList: ReceivableItem[];
  retailerSummary: RetailerSummary[];
};

export default function AccountsReceivablePage() {
  const [viewMode, setViewMode] = useState<"retailers" | "invoices">("retailers");
  const [q, setQ] = useState("");
  const [filterOverdue, setFilterOverdue] = useState<"all" | "overdue" | "critical">("all");
  const [expandedRetailer, setExpandedRetailer] = useState<string | null>(null);

  // Quick Collect Modal State
  const [collectTarget, setCollectTarget] = useState<ReceivableItem | null>(null);
  const [collectAmount, setCollectAmount] = useState<string>("");
  const [collectMethod, setCollectMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [bankName, setBankName] = useState<string>("HDFC Current");
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [chequeNumber, setChequeNumber] = useState<string>("");
  const [chequeBank, setChequeBank] = useState<string>("");
  const [chequeDueDate, setChequeDueDate] = useState<string>("");
  const [collectNotes, setCollectNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<ReceivablesApiResponse>("/api/finance/receivables");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  // Filter Invoices
  const filteredInvoices = data.receivablesList.filter((r) => {
    const matchesSearch =
      r.retailerName.toLowerCase().includes(q.toLowerCase()) ||
      (r.ownerName && r.ownerName.toLowerCase().includes(q.toLowerCase())) ||
      (r.mobile && r.mobile.includes(q)) ||
      r.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      (r.billNumber && r.billNumber.toLowerCase().includes(q.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterOverdue === "overdue") return r.daysOverdue > 0;
    if (filterOverdue === "critical") return r.daysOverdue > 15;
    return true;
  });

  // Filter Retailers
  const filteredRetailers = data.retailerSummary.filter((ret) => {
    const matchesSearch =
      ret.retailerName.toLowerCase().includes(q.toLowerCase()) ||
      (ret.ownerName && ret.ownerName.toLowerCase().includes(q.toLowerCase())) ||
      (ret.mobile && ret.mobile.includes(q)) ||
      (ret.gstin && ret.gstin.toLowerCase().includes(q.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterOverdue === "overdue") return ret.invoices.some((i) => i.daysOverdue > 0);
    if (filterOverdue === "critical") return ret.invoices.some((i) => i.daysOverdue > 15);
    return true;
  });

  const openCollectModal = (item: ReceivableItem) => {
    setCollectTarget(item);
    setCollectAmount(item.balanceDue.toString());
    setCollectMethod("BANK_TRANSFER");
    setBankName("HDFC Current");
    setReferenceNo("");
    setChequeNumber("");
    setChequeBank("");
    setChequeDueDate("");
    setCollectNotes(`NEFT/RTGS payment against invoice ${item.billNumber || item.orderNumber}`);
    setFeedback(null);
  };

  const handleCollectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectTarget) return;

    const amt = parseFloat(collectAmount);
    if (isNaN(amt) || amt <= 0) {
      setFeedback({ type: "error", message: "Please enter a valid positive payment amount." });
      return;
    }

    if (amt > collectTarget.balanceDue + 0.01) {
      setFeedback({ type: "error", message: `Amount exceeds current outstanding (₹${collectTarget.balanceDue.toFixed(2)})` });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: collectTarget.id,
          billId: collectTarget.billId,
          amount: amt,
          paymentMethod: collectMethod,
          bankName: collectMethod === "BANK_TRANSFER" ? bankName : undefined,
          referenceNo: referenceNo || undefined,
          chequeNumber: collectMethod === "CHEQUE" ? chequeNumber : undefined,
          chequeBank: collectMethod === "CHEQUE" ? chequeBank : undefined,
          chequeDueDate: collectMethod === "CHEQUE" && chequeDueDate ? chequeDueDate : undefined,
          notes: collectNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to record payment");

      setFeedback({ type: "success", message: `₹${amt.toFixed(2)} recorded successfully via ${collectMethod}!` });
      setTimeout(() => {
        setCollectTarget(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  };

  const totalOutstanding = data.totalReceivables;
  const overdueSum = data.ageing.bucket16_30 + data.ageing.bucket31_60 + data.ageing.bucket60Plus;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🧾</span>
            <h1 className="text-xl font-black text-ink">B2B Accounts Receivable</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Track retailer dues, credit limits, NEFT/RTGS/Cheque/UPI collections, and ageing overdue buckets
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setViewMode("retailers")}
              className={`px-3 py-1 rounded-md transition-all ${
                viewMode === "retailers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏢 Retailer Summary ({data.retailerSummary.length})
            </button>
            <button
              onClick={() => setViewMode("invoices")}
              className={`px-3 py-1 rounded-md transition-all ${
                viewMode === "invoices" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📄 All Invoices ({data.receivablesList.length})
            </button>
          </div>
        </div>
      </div>

      {/* Ageing Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card bg-accent/5 border-accent/30 p-3">
          <div className="text-[11px] font-semibold text-accent">Total Outstanding</div>
          <div className="text-lg font-black text-accent mt-0.5">
            ₹{totalOutstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{data.receivablesList.length} unpaid invoices</div>
        </div>

        <div className="card p-3 border-l-4 border-l-good">
          <div className="text-[11px] font-semibold text-good">0–7 Days (Current)</div>
          <div className="text-base font-bold text-good mt-0.5">
            ₹{data.ageing.bucket0_7.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Within regular credit</div>
        </div>

        <div className="card p-3 border-l-4 border-l-ink">
          <div className="text-[11px] font-semibold text-ink">8–15 Days</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{data.ageing.bucket8_15.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Approaching due</div>
        </div>

        <div className="card p-3 border-l-4 border-l-warn">
          <div className="text-[11px] font-semibold text-warn">16–30 Days (Due)</div>
          <div className="text-base font-bold text-warn mt-0.5">
            ₹{data.ageing.bucket16_30.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Due for follow-up</div>
        </div>

        <div className="card p-3 border-l-4 border-l-warn">
          <div className="text-[11px] font-semibold text-warn">31–60 Days Overdue</div>
          <div className="text-base font-bold text-warn mt-0.5">
            ₹{data.ageing.bucket31_60.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Notice sent</div>
        </div>

        <div className="card p-3 border-l-4 border-l-bad bg-bad/5">
          <div className="text-[11px] font-semibold text-bad">60+ Days Overdue</div>
          <div className="text-base font-black text-bad mt-0.5">
            ₹{data.ageing.bucket60Plus.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-bad font-semibold mt-1">⚠️ High Risk / Block</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">Filter Ageing:</span>
          <button
            onClick={() => setFilterOverdue("all")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterOverdue === "all" ? "bg-surface-hi font-bold text-ink border-line" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            All Items
          </button>
          <button
            onClick={() => setFilterOverdue("overdue")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterOverdue === "overdue" ? "bg-warn/10 text-warn font-bold border-warn/30" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            Overdue Only (&gt;15d)
          </button>
          <button
            onClick={() => setFilterOverdue("critical")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterOverdue === "critical" ? "bg-bad/10 text-bad font-bold border-bad/30" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            Critical Overdue (&gt;30d)
          </button>
        </div>

        <div className="w-full sm:w-80">
          <input
            type="search"
            placeholder="Search retailer, mobile, GSTIN, invoice #..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: RETAILER-WISE GROUPED SUMMARY */}
      {viewMode === "retailers" && (
        <div className="space-y-3">
          {filteredRetailers.length === 0 ? (
            <div className="card p-8 text-center text-xs text-muted">No retailers matching filter.</div>
          ) : (
            filteredRetailers.map((ret) => {
              const isExpanded = expandedRetailer === ret.customerId;
              const creditPct = ret.creditLimit && ret.creditLimit > 0 ? (ret.totalOutstanding / ret.creditLimit) * 100 : null;
              const isOverLimit = creditPct !== null && creditPct > 100;
              const hasOverdue = ret.invoices.some((i) => i.daysOverdue > 0);

              return (
                <div
                  key={ret.customerId}
                  className={`card transition-all border ${
                    isOverLimit ? "border-bad/40 bg-bad/[0.02]" : "border-line"
                  }`}
                >
                  {/* Retailer Header Card */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="space-y-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-ink">{ret.retailerName}</span>
                        {ret.gstin && (
                          <span className="text-[10px] bg-surface-hi text-muted px-1.5 py-0.5 rounded border border-line font-mono">
                            {ret.gstin}
                          </span>
                        )}
                        {isOverLimit && (
                          <span className="text-[10px] bg-bad text-white font-bold px-2 py-0.5 rounded-full">
                            LIMIT EXCEEDED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted flex items-center gap-3">
                        <span>👤 {ret.ownerName || "Owner"}</span>
                        <span>📞 {ret.mobile || "—"}</span>
                        <span>📦 {ret.invoiceCount} open bill{ret.invoiceCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>

                    {/* Credit Limit Meter */}
                    <div className="w-48 space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted">Credit Limit</span>
                        <span className="font-semibold text-ink">
                          {ret.creditLimit ? `₹${ret.creditLimit.toLocaleString("en-IN")}` : "No Limit"}
                        </span>
                      </div>
                      {ret.creditLimit ? (
                        <div className="w-full bg-surface-hi h-2 rounded-full overflow-hidden border border-line">
                          <div
                            className={`h-full transition-all rounded-full ${
                              isOverLimit
                                ? "bg-bad"
                                : (creditPct || 0) > 80
                                ? "bg-warn"
                                : "bg-good"
                            }`}
                            style={{ width: `${Math.min(creditPct || 0, 100)}%` }}
                          />
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted italic">Uncapped B2B credit</div>
                      )}
                      {creditPct !== null && (
                        <div className="text-[10px] text-right font-semibold text-muted">
                          {creditPct.toFixed(0)}% utilized
                        </div>
                      )}
                    </div>

                    {/* Outstanding & Expand */}
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-[11px] text-muted">Total Due</div>
                        <div className="text-base font-black text-bad">
                          ₹{ret.totalOutstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-muted">
                          Paid: ₹{ret.totalPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <button
                        onClick={() => setExpandedRetailer(isExpanded ? null : ret.customerId)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface-hi hover:bg-surface border border-line text-ink flex items-center gap-1.5 transition-colors"
                      >
                        {isExpanded ? "Hide Bills ▲" : `View Bills (${ret.invoices.length}) ▼`}
                      </button>
                    </div>
                  </div>

                  {/* Expandable Bills Ledger */}
                  {isExpanded && (
                    <div className="border-t border-line bg-surface-hi/40 p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-line text-muted text-[11px] font-semibold">
                              <th className="py-2">Invoice / Bill #</th>
                              <th className="py-2">Invoice Date</th>
                              <th className="py-2">Due Date</th>
                              <th className="py-2 text-right">Invoice Amount</th>
                              <th className="py-2 text-center">Paid (Tender Breakdown)</th>
                              <th className="py-2 text-right">Outstanding</th>
                              <th className="py-2 text-center">Overdue Status</th>
                              <th className="py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line/60">
                            {ret.invoices.map((inv) => (
                              <tr key={inv.id} className="hover:bg-surface-hi transition-colors">
                                <td className="py-2.5">
                                  <div className="font-bold text-ink">{inv.orderNumber}</div>
                                  {inv.billNumber && (
                                    <div className="text-[10px] text-muted font-mono">{inv.billNumber}</div>
                                  )}
                                </td>
                                <td className="py-2.5 text-muted font-mono">{inv.invoiceDate}</td>
                                <td className="py-2.5 text-ink font-mono font-medium">{inv.dueDate}</td>
                                <td className="py-2.5 text-right font-semibold text-ink">
                                  ₹{inv.billTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 text-center">
                                  <div className="inline-flex flex-col items-center">
                                    <span className="font-bold text-good">
                                      ₹{inv.amountPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <div className="flex items-center gap-1 text-[9px] mt-0.5">
                                      {inv.tenderBreakdown.bank > 0 && (
                                        <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold" title="Bank Transfer / NEFT / RTGS">
                                          NEFT: ₹{inv.tenderBreakdown.bank}
                                        </span>
                                      )}
                                      {inv.tenderBreakdown.upi > 0 && (
                                        <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold" title="UPI Payment">
                                          UPI: ₹{inv.tenderBreakdown.upi}
                                        </span>
                                      )}
                                      {inv.tenderBreakdown.cheque > 0 && (
                                        <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold" title="Cheque">
                                          CHQ: ₹{inv.tenderBreakdown.cheque}
                                        </span>
                                      )}
                                      {inv.tenderBreakdown.cash > 0 && (
                                        <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold" title="Cash">
                                          CASH: ₹{inv.tenderBreakdown.cash}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2.5 text-right font-black text-bad">
                                  ₹{inv.balanceDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 text-center">
                                  {inv.daysOverdue > 0 ? (
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        inv.daysOverdue > 30
                                          ? "bg-bad text-white"
                                          : inv.daysOverdue > 15
                                          ? "bg-warn text-white"
                                          : "bg-warn/20 text-warn"
                                      }`}
                                    >
                                      {inv.daysOverdue} Days Overdue
                                    </span>
                                  ) : (
                                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/15 text-good">
                                      Due in {Math.abs(inv.ageDays - 15)}d
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 text-right">
                                  <button
                                    onClick={() => openCollectModal(inv)}
                                    className="px-2.5 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm transition-all"
                                  >
                                    + Collect
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW 2: ALL INVOICES FLAT BREAKDOWN */}
      {viewMode === "invoices" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line flex justify-between items-center bg-surface-hi/50">
            <div>
              <h2 className="text-sm font-bold text-ink">All Outstanding Invoices</h2>
              <p className="text-[11px] text-muted">Showing {filteredInvoices.length} invoices matching criteria</p>
            </div>
            <div className="text-xs font-semibold">
              Total Filtered Due:{" "}
              <span className="text-bad font-black">
                ₹{filteredInvoices.reduce((s, i) => s + i.balanceDue, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Retailer (Customer)</th>
                <th className="py-3 px-3">Invoice #</th>
                <th className="py-3 px-3">Invoice Date</th>
                <th className="py-3 px-3">Due Date</th>
                <th className="py-3 px-3 text-right">Invoice Amount</th>
                <th className="py-3 px-3 text-center">Paid (NEFT/RTGS/Cheque/Cash/UPI)</th>
                <th className="py-3 px-3 text-right">Outstanding</th>
                <th className="py-3 px-3 text-center">Days Overdue</th>
                <th className="py-3 px-3 text-right">Credit Limit</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No invoices found.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hi/80 transition-colors">
                    {/* Retailer */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-ink">{r.retailerName}</div>
                      <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                        <span>{r.ownerName || "Owner"}</span>
                        <span>•</span>
                        <span>{r.mobile || "—"}</span>
                      </div>
                    </td>

                    {/* Invoice */}
                    <td className="py-3 px-3">
                      <div className="font-semibold text-ink">{r.orderNumber}</div>
                      {r.billNumber && (
                        <div className="text-[10px] text-muted font-mono">{r.billNumber}</div>
                      )}
                    </td>

                    {/* Dates */}
                    <td className="py-3 px-3 text-muted font-mono">{r.invoiceDate}</td>
                    <td className="py-3 px-3 text-ink font-mono font-medium">{r.dueDate}</td>

                    {/* Invoice Amount */}
                    <td className="py-3 px-3 text-right font-semibold text-ink">
                      ₹{r.billTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Paid Breakdown */}
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className="font-bold text-good">
                          ₹{r.amountPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                        <div className="flex flex-wrap justify-center gap-1 text-[9px] mt-0.5">
                          {r.tenderBreakdown.bank > 0 && (
                            <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold" title="Bank Transfer / NEFT / RTGS">
                              NEFT: ₹{r.tenderBreakdown.bank}
                            </span>
                          )}
                          {r.tenderBreakdown.upi > 0 && (
                            <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold" title="UPI">
                              UPI: ₹{r.tenderBreakdown.upi}
                            </span>
                          )}
                          {r.tenderBreakdown.cheque > 0 && (
                            <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold" title="Cheque">
                              CHQ: ₹{r.tenderBreakdown.cheque}
                            </span>
                          )}
                          {r.tenderBreakdown.cash > 0 && (
                            <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold" title="Cash">
                              CASH: ₹{r.tenderBreakdown.cash}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Outstanding */}
                    <td className="py-3 px-3 text-right font-black text-bad">
                      ₹{r.balanceDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Days Overdue */}
                    <td className="py-3 px-3 text-center">
                      {r.daysOverdue > 0 ? (
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            r.daysOverdue > 30
                              ? "bg-bad text-white"
                              : r.daysOverdue > 15
                              ? "bg-warn text-white"
                              : "bg-warn/20 text-warn"
                          }`}
                        >
                          {r.daysOverdue}d Overdue
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/15 text-good">
                          On Track ({r.ageDays}d old)
                        </span>
                      )}
                    </td>

                    {/* Credit Limit */}
                    <td className="py-3 px-3 text-right text-muted">
                      {r.creditLimit ? (
                        <div>
                          <div className="font-semibold text-ink">₹{r.creditLimit.toLocaleString("en-IN")}</div>
                          {r.creditUsedPercent !== null && (
                            <div className={`text-[10px] font-bold ${r.creditUsedPercent > 100 ? "text-bad" : "text-muted"}`}>
                              {r.creditUsedPercent.toFixed(0)}% used
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted italic">No limit</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openCollectModal(r)}
                        className="px-2.5 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm transition-all"
                      >
                        + Collect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* QUICK PAYMENT COLLECTION MODAL */}
      {collectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Receive B2B Payment</h3>
                <p className="text-xs text-muted">
                  Record collection for <strong className="text-ink">{collectTarget.retailerName}</strong>
                </p>
              </div>
              <button
                onClick={() => setCollectTarget(null)}
                className="text-muted hover:text-ink text-sm p-1"
              >
                ✕
              </button>
            </div>

            {/* Bill Summary Banner */}
            <div className="bg-surface-hi p-3 rounded-lg border border-line text-xs grid grid-cols-3 gap-2">
              <div>
                <span className="text-muted block">Order / Bill #</span>
                <span className="font-bold text-ink">{collectTarget.orderNumber}</span>
              </div>
              <div>
                <span className="text-muted block">Total Bill</span>
                <span className="font-semibold text-ink">₹{collectTarget.billTotal.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted block">Current Outstanding</span>
                <span className="font-black text-bad">₹{collectTarget.balanceDue.toFixed(2)}</span>
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

            <form onSubmit={handleCollectSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Collection Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
                  placeholder="e.g. 5000"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Payment Method / Tender *</label>
                <select
                  value={collectMethod}
                  onChange={(e) => setCollectMethod(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs focus:outline-none focus:border-accent"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI / Digital QR</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="CASH">Physical Cash</option>
                </select>
              </div>

              {/* Method Specific Fields */}
              {collectMethod === "BANK_TRANSFER" && (
                <div className="grid grid-cols-2 gap-3 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Deposited In Bank Account</label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    >
                      <option value="HDFC Current">HDFC Current (9482)</option>
                      <option value="SBI Current">SBI Current (1102)</option>
                      <option value="ICICI Current">ICICI Current</option>
                      <option value="Axis Bank">Axis Bank</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">UTR / Ref Number</label>
                    <input
                      type="text"
                      placeholder="e.g. UTR2918491823"
                      value={referenceNo}
                      onChange={(e) => setReferenceNo(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                </div>
              )}

              {collectMethod === "UPI" && (
                <div className="bg-surface-hi p-3 rounded-lg border border-line">
                  <label className="block font-semibold text-ink mb-1">UPI Transaction / RRN Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 481928374910"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                  />
                </div>
              )}

              {collectMethod === "CHEQUE" && (
                <div className="grid grid-cols-3 gap-2 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Cheque No *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 004812"
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. PNB / Canara"
                      value={chequeBank}
                      onChange={(e) => setChequeBank(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Cheque Date</label>
                    <input
                      type="date"
                      value={chequeDueDate}
                      onChange={(e) => setChequeDueDate(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-ink mb-1">Internal Notes / Narration</label>
                <input
                  type="text"
                  value={collectNotes}
                  onChange={(e) => setCollectNotes(e.target.value)}
                  placeholder="e.g. Part payment received via RTGS"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setCollectTarget(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {submitting ? "Processing..." : "Confirm & Post Receipt Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
