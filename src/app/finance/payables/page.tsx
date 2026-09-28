"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";
import { parseSupplierBankDetails } from "@/lib/supplier-bank";

type TenderBreakdown = {
  bank: number;
  upi: number;
  cheque: number;
  cash: number;
  others: number;
};

type PayableItem = {
  id: string;
  supplierId: string;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  bankDetails: string | null;
  paymentTerms: string | null;
  supplierBillNo: string;
  grnNumber: string;
  poNumber: string | null;
  billDate: string;
  dueDate: string;
  creditDays: number;
  purchaseAmount: number;
  subtotal: number;
  gstAmount: number;
  otherCharges: number;
  amountPaid: number;
  balanceDue: number;
  overdueDays: number;
  isOverdue: boolean;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  tenderBreakdown: TenderBreakdown;
  warehouse: string;
};

type SupplierSummary = {
  supplierId: string;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  bankDetails: string | null;
  creditDays: number;
  creditLimit: number | null;
  totalPurchases: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  overdueCount: number;
  oldestOverdueDays: number;
  tenderBreakdown: TenderBreakdown;
  bills: PayableItem[];
};

type PayablesApiResponse = {
  totalPayables: number;
  totalPurchases: number;
  totalPaid: number;
  ageing: {
    notDue: number;
    overdue0_15: number;
    overdue16_30: number;
    overdue30Plus: number;
  };
  payablesList: PayableItem[];
  supplierSummary: SupplierSummary[];
};

export default function AccountsPayablePage() {
  const [viewMode, setViewMode] = useState<"suppliers" | "invoices">("suppliers");
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "overdue" | "critical">("all");
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  // Pay Supplier Modal State
  const [payTarget, setPayTarget] = useState<PayableItem | null>(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [bankAccount, setBankAccount] = useState<string>("HDFC Current");
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [chequeNumber, setChequeNumber] = useState<string>("");
  const [chequeBank, setChequeBank] = useState<string>("");
  const [chequeDueDate, setChequeDueDate] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<PayablesApiResponse>("/api/finance/payables");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  // Filtering Invoices
  const filteredInvoices = data.payablesList.filter((p) => {
    const matchesSearch =
      p.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      (p.contactPerson && p.contactPerson.toLowerCase().includes(q.toLowerCase())) ||
      (p.phone && p.phone.includes(q)) ||
      p.supplierBillNo.toLowerCase().includes(q.toLowerCase()) ||
      p.grnNumber.toLowerCase().includes(q.toLowerCase()) ||
      (p.poNumber && p.poNumber.toLowerCase().includes(q.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterStatus === "pending") return p.balanceDue > 0;
    if (filterStatus === "overdue") return p.isOverdue;
    if (filterStatus === "critical") return p.overdueDays > 15;
    return true;
  });

  // Filtering Suppliers
  const filteredSuppliers = data.supplierSummary.filter((sup) => {
    const matchesSearch =
      sup.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      (sup.contactPerson && sup.contactPerson.toLowerCase().includes(q.toLowerCase())) ||
      (sup.phone && sup.phone.includes(q)) ||
      (sup.gstin && sup.gstin.toLowerCase().includes(q.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterStatus === "pending") return sup.totalOutstanding > 0;
    if (filterStatus === "overdue") return sup.overdueCount > 0;
    if (filterStatus === "critical") return sup.oldestOverdueDays > 15;
    return true;
  });

  const openPayModal = (item: PayableItem) => {
    setPayTarget(item);
    setPayAmount(item.balanceDue > 0 ? item.balanceDue.toString() : item.purchaseAmount.toString());
    setPayMethod("BANK_TRANSFER");
    setBankAccount("HDFC Current");
    setReferenceNo("");
    setChequeNumber("");
    setChequeBank("");
    setChequeDueDate("");
    setPayNotes(`Vendor payout for Bill #${item.supplierBillNo} (${item.supplierName})`);
    setFeedback(null);
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;

    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      setFeedback({ type: "error", message: "Please enter a valid positive payment amount." });
      return;
    }

    if (payTarget.balanceDue > 0 && amt > payTarget.balanceDue + 0.01) {
      setFeedback({ type: "error", message: `Payment exceeds remaining balance due (₹${payTarget.balanceDue.toFixed(2)})` });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/payables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseBillId: payTarget.id,
          supplierId: payTarget.supplierId,
          amount: amt,
          paymentMethod: payMethod,
          bankName: payMethod === "BANK_TRANSFER" ? bankAccount : undefined,
          referenceNo: referenceNo || undefined,
          chequeNumber: payMethod === "CHEQUE" ? chequeNumber : undefined,
          chequeBank: payMethod === "CHEQUE" ? chequeBank : undefined,
          chequeDueDate: payMethod === "CHEQUE" && chequeDueDate ? chequeDueDate : undefined,
          notes: payNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to record payment");

      setFeedback({ type: "success", message: `₹${amt.toFixed(2)} payout recorded via ${payMethod}! Payment Voucher created.` });
      setTimeout(() => {
        setPayTarget(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Banner Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🤝</span>
            <h1 className="text-xl font-black text-ink">Accounts Payable & Supplier Dues</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Track vendor purchase bills, credit terms, NEFT/RTGS/Cheque/UPI payouts, and overdue commitments
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setViewMode("suppliers")}
              className={`px-3 py-1 rounded-md transition-all ${
                viewMode === "suppliers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏢 Supplier-wise ({data.supplierSummary.length})
            </button>
            <button
              onClick={() => setViewMode("invoices")}
              className={`px-3 py-1 rounded-md transition-all ${
                viewMode === "invoices" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📄 All Invoices ({data.payablesList.length})
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card bg-accent/5 border-accent/30 p-3">
          <div className="text-[11px] font-semibold text-accent">Total Outstanding</div>
          <div className="text-lg font-black text-bad mt-0.5">
            ₹{data.totalPayables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Pending vendor dues</div>
        </div>

        <div className="card p-3">
          <div className="text-[11px] font-semibold text-ink">Total Purchases</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{data.totalPurchases.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Total inward billed</div>
        </div>

        <div className="card p-3 border-l-4 border-l-good">
          <div className="text-[11px] font-semibold text-good">Not Yet Due</div>
          <div className="text-base font-bold text-good mt-0.5">
            ₹{data.ageing.notDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Within credit days</div>
        </div>

        <div className="card p-3 border-l-4 border-l-warn">
          <div className="text-[11px] font-semibold text-warn">Overdue (1–15 Days)</div>
          <div className="text-base font-bold text-warn mt-0.5">
            ₹{data.ageing.overdue0_15.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Priority for payment</div>
        </div>

        <div className="card p-3 border-l-4 border-l-warn">
          <div className="text-[11px] font-semibold text-warn">Overdue (16–30 Days)</div>
          <div className="text-base font-bold text-warn mt-0.5">
            ₹{data.ageing.overdue16_30.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Delayed vendor payout</div>
        </div>

        <div className="card p-3 border-l-4 border-l-bad bg-bad/5">
          <div className="text-[11px] font-semibold text-bad">Overdue (&gt;30 Days)</div>
          <div className="text-base font-black text-bad mt-0.5">
            ₹{data.ageing.overdue30Plus.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-bad font-semibold mt-1">⚠️ Critical Due / Hold</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">Filter Bills:</span>
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterStatus === "all" ? "bg-surface-hi font-bold text-ink border-line" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            All Bills
          </button>
          <button
            onClick={() => setFilterStatus("pending")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterStatus === "pending" ? "bg-accent/10 text-accent font-bold border-accent/30" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            Outstanding Only
          </button>
          <button
            onClick={() => setFilterStatus("overdue")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterStatus === "overdue" ? "bg-warn/10 text-warn font-bold border-warn/30" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            Overdue Only
          </button>
          <button
            onClick={() => setFilterStatus("critical")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              filterStatus === "critical" ? "bg-bad/10 text-bad font-bold border-bad/30" : "text-muted hover:text-ink border-transparent"
            }`}
          >
            Critical Overdue (&gt;15d)
          </button>
        </div>

        <div className="w-full sm:w-80">
          <input
            type="search"
            placeholder="Search supplier, contact, bill #, GRN..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: SUPPLIER-WISE SUMMARY */}
      {viewMode === "suppliers" && (
        <div className="space-y-3">
          {filteredSuppliers.length === 0 ? (
            <div className="card p-8 text-center text-xs text-muted">No suppliers matching filter criteria.</div>
          ) : (
            filteredSuppliers.map((sup) => {
              const isExpanded = expandedSupplier === sup.supplierId;
              const hasOverdue = sup.overdueCount > 0;

              return (
                <div
                  key={sup.supplierId}
                  className={`card transition-all border ${
                    hasOverdue ? "border-warn/40 bg-warn/[0.01]" : "border-line"
                  }`}
                >
                  {/* Supplier Header Row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="space-y-1 min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-ink">{sup.supplierName}</span>
                        {sup.gstin && (
                          <span className="text-[10px] bg-surface-hi text-muted px-1.5 py-0.5 rounded border border-line font-mono">
                            {sup.gstin}
                          </span>
                        )}
                        {hasOverdue && (
                          <span className="text-[10px] bg-warn text-white font-bold px-2 py-0.5 rounded-full">
                            {sup.overdueCount} Overdue
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted flex flex-wrap items-center gap-3">
                        <span>👤 {sup.contactPerson || "Contact Person"}</span>
                        <span>📞 {sup.phone || "—"}</span>
                        <span>⏱️ Credit: <strong className="text-ink">{sup.creditDays} Days</strong></span>
                        <span>📦 {sup.invoiceCount} bill{sup.invoiceCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>

                    {/* Paid & Tender Breakdown Badges */}
                    <div className="text-center space-y-1">
                      <div className="text-[11px] text-muted">Total Paid</div>
                      <div className="text-sm font-bold text-good">
                        ₹{sup.totalPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </div>
                      <div className="flex flex-wrap justify-center gap-1 text-[9px]">
                        {sup.tenderBreakdown.bank > 0 && (
                          <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold">
                            NEFT: ₹{sup.tenderBreakdown.bank.toLocaleString("en-IN")}
                          </span>
                        )}
                        {sup.tenderBreakdown.cheque > 0 && (
                          <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold">
                            CHQ: ₹{sup.tenderBreakdown.cheque.toLocaleString("en-IN")}
                          </span>
                        )}
                        {sup.tenderBreakdown.upi > 0 && (
                          <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold">
                            UPI: ₹{sup.tenderBreakdown.upi.toLocaleString("en-IN")}
                          </span>
                        )}
                        {sup.tenderBreakdown.cash > 0 && (
                          <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold">
                            CASH: ₹{sup.tenderBreakdown.cash.toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Outstanding Dues & Actions */}
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-[11px] text-muted">Outstanding Due</div>
                        <div className="text-base font-black text-bad">
                          ₹{sup.totalOutstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-muted">
                          Purchases: ₹{sup.totalPurchases.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <button
                        onClick={() => setExpandedSupplier(isExpanded ? null : sup.supplierId)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface-hi hover:bg-surface border border-line text-ink flex items-center gap-1.5 transition-colors"
                      >
                        {isExpanded ? "Hide Bills ▲" : `View Bills (${sup.bills.length}) ▼`}
                      </button>
                    </div>
                  </div>

                  {/* Expandable Bills for this Supplier */}
                  {isExpanded && (
                    <div className="border-t border-line bg-surface-hi/40 p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-line text-muted text-[11px] font-semibold">
                              <th className="py-2">Supplier Bill / Invoice #</th>
                              <th className="py-2">GRN Number</th>
                              <th className="py-2">Bill Date</th>
                              <th className="py-2">Due Date</th>
                              <th className="py-2 text-center">Credit Days</th>
                              <th className="py-2 text-right">Purchase Amount</th>
                              <th className="py-2 text-center">Paid / Tenders</th>
                              <th className="py-2 text-right">Outstanding</th>
                              <th className="py-2 text-center">Due Status</th>
                              <th className="py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line/60">
                            {sup.bills.map((bill) => (
                              <tr key={bill.id} className="hover:bg-surface-hi transition-colors">
                                <td className="py-2.5">
                                  <div className="font-bold text-ink">{bill.supplierBillNo}</div>
                                  {bill.poNumber && (
                                    <div className="text-[10px] text-muted">PO: {bill.poNumber}</div>
                                  )}
                                </td>
                                <td className="py-2.5 text-muted font-mono">{bill.grnNumber}</td>
                                <td className="py-2.5 text-muted font-mono">{bill.billDate}</td>
                                <td className="py-2.5 text-ink font-mono font-medium">{bill.dueDate}</td>
                                <td className="py-2.5 text-center font-semibold text-muted">{bill.creditDays}d</td>
                                <td className="py-2.5 text-right font-semibold text-ink">
                                  ₹{bill.purchaseAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 text-center">
                                  <div className="inline-flex flex-col items-center">
                                    <span className="font-bold text-good">
                                      ₹{bill.amountPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                    </span>
                                    <div className="flex items-center gap-1 text-[9px] mt-0.5">
                                      {bill.tenderBreakdown.bank > 0 && (
                                        <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold">
                                          NEFT: ₹{bill.tenderBreakdown.bank}
                                        </span>
                                      )}
                                      {bill.tenderBreakdown.cheque > 0 && (
                                        <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold">
                                          CHQ: ₹{bill.tenderBreakdown.cheque}
                                        </span>
                                      )}
                                      {bill.tenderBreakdown.upi > 0 && (
                                        <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold">
                                          UPI: ₹{bill.tenderBreakdown.upi}
                                        </span>
                                      )}
                                      {bill.tenderBreakdown.cash > 0 && (
                                        <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold">
                                          CASH: ₹{bill.tenderBreakdown.cash}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2.5 text-right font-black text-bad">
                                  ₹{bill.balanceDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                </td>
                                <td className="py-2.5 text-center">
                                  {bill.balanceDue <= 0 ? (
                                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-good/15 text-good">
                                      ✓ Settled
                                    </span>
                                  ) : bill.isOverdue ? (
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        bill.overdueDays > 30
                                          ? "bg-bad text-white"
                                          : bill.overdueDays > 15
                                          ? "bg-warn text-white"
                                          : "bg-warn/20 text-warn"
                                      }`}
                                    >
                                      {bill.overdueDays}d Overdue
                                    </span>
                                  ) : (
                                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/15 text-good">
                                      On Track
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 text-right">
                                  <button
                                    onClick={() => openPayModal(bill)}
                                    className="px-2.5 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm transition-all"
                                  >
                                    + Pay Vendor
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

      {/* VIEW 2: ALL PURCHASE INVOICES FLAT BREAKDOWN */}
      {viewMode === "invoices" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line flex justify-between items-center bg-surface-hi/50">
            <div>
              <h2 className="text-sm font-bold text-ink">All Purchase Bills & Payables</h2>
              <p className="text-[11px] text-muted">Showing {filteredInvoices.length} purchase invoices</p>
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
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-3">Supplier Invoice</th>
                <th className="py-3 px-3">GRN #</th>
                <th className="py-3 px-3 text-right">Purchase (₹)</th>
                <th className="py-3 px-3 text-center">Paid (NEFT/RTGS/Cheque/Cash/UPI)</th>
                <th className="py-3 px-3 text-right">Outstanding (₹)</th>
                <th className="py-3 px-3 text-center">Due Date</th>
                <th className="py-3 px-3 text-center">Credit Days</th>
                <th className="py-3 px-3 text-center">Overdue Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted">
                    No purchase invoices matching filter criteria.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-hi/80 transition-colors">
                    {/* Supplier */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-ink">{p.supplierName}</div>
                      <div className="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                        <span>{p.contactPerson || "Vendor"}</span>
                        <span>•</span>
                        <span>{p.phone || "—"}</span>
                      </div>
                    </td>

                    {/* Invoice */}
                    <td className="py-3 px-3 font-semibold text-ink">
                      <div>{p.supplierBillNo}</div>
                      {p.poNumber && <div className="text-[10px] text-muted font-mono">{p.poNumber}</div>}
                    </td>

                    {/* GRN */}
                    <td className="py-3 px-3 text-muted font-mono">{p.grnNumber}</td>

                    {/* Purchase Amount */}
                    <td className="py-3 px-3 text-right font-bold text-ink">
                      ₹{p.purchaseAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Paid Breakdown */}
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className="font-bold text-good">
                          ₹{p.amountPaid.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                        <div className="flex flex-wrap justify-center gap-1 text-[9px] mt-0.5">
                          {p.tenderBreakdown.bank > 0 && (
                            <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold">
                              NEFT: ₹{p.tenderBreakdown.bank}
                            </span>
                          )}
                          {p.tenderBreakdown.cheque > 0 && (
                            <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold">
                              CHQ: ₹{p.tenderBreakdown.cheque}
                            </span>
                          )}
                          {p.tenderBreakdown.upi > 0 && (
                            <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold">
                              UPI: ₹{p.tenderBreakdown.upi}
                            </span>
                          )}
                          {p.tenderBreakdown.cash > 0 && (
                            <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold">
                              CASH: ₹{p.tenderBreakdown.cash}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Outstanding */}
                    <td className="py-3 px-3 text-right font-black text-bad">
                      ₹{p.balanceDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Due Date */}
                    <td className="py-3 px-3 text-center font-mono font-medium text-ink">
                      {p.dueDate}
                    </td>

                    {/* Credit Days */}
                    <td className="py-3 px-3 text-center text-muted font-semibold">
                      {p.creditDays} Days
                    </td>

                    {/* Overdue Status */}
                    <td className="py-3 px-3 text-center">
                      {p.balanceDue <= 0 ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-good/15 text-good">
                          ✓ Settled
                        </span>
                      ) : p.isOverdue ? (
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            p.overdueDays > 30
                              ? "bg-bad text-white"
                              : p.overdueDays > 15
                              ? "bg-warn text-white"
                              : "bg-warn/20 text-warn"
                          }`}
                        >
                          {p.overdueDays}d Overdue
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-good/15 text-good">
                          On Track
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openPayModal(p)}
                        className="px-2.5 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm transition-all"
                      >
                        + Pay
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* QUICK SUPPLIER PAYOUT MODAL */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Record Supplier Payout</h3>
                <p className="text-xs text-muted">
                  Issue payment to <strong className="text-ink">{payTarget.supplierName}</strong>
                </p>
              </div>
              <button
                onClick={() => setPayTarget(null)}
                className="text-muted hover:text-ink text-sm p-1"
              >
                ✕
              </button>
            </div>

            {/* Bill Summary Banner */}
            <div className="bg-surface-hi p-3 rounded-lg border border-line text-xs grid grid-cols-3 gap-2">
              <div>
                <span className="text-muted block">Supplier Bill #</span>
                <span className="font-bold text-ink">{payTarget.supplierBillNo}</span>
              </div>
              <div>
                <span className="text-muted block">Purchase Amount</span>
                <span className="font-semibold text-ink">₹{payTarget.purchaseAmount.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted block">Outstanding Due</span>
                <span className="font-black text-bad">₹{payTarget.balanceDue.toFixed(2)}</span>
              </div>
            </div>

            {/* Beneficiary Banking & Payout Account */}
            {payTarget.bankDetails && (() => {
              const b = parseSupplierBankDetails(payTarget.bankDetails);
              return (
                <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 space-y-1 text-xs">
                  <div className="font-bold text-accent flex items-center gap-1.5">
                    <span>🏦</span>
                    <span>Beneficiary Payout Details</span>
                  </div>
                  {b.bankName && <div className="font-semibold text-ink">{b.bankName} {b.branch ? `(${b.branch})` : ""}</div>}
                  {b.accountNumber && (
                    <div className="flex items-center justify-between bg-surface p-1 rounded border border-line">
                      <span className="text-muted">A/C: <strong className="font-mono text-ink">{b.accountNumber}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(b.accountNumber!);
                          alert(`Copied A/C: ${b.accountNumber}`);
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                      >
                        📋 Copy A/C
                      </button>
                    </div>
                  )}
                  {b.ifsc && (
                    <div className="flex items-center justify-between bg-surface p-1 rounded border border-line">
                      <span className="text-muted">IFSC: <strong className="font-mono text-accent uppercase">{b.ifsc}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(b.ifsc!);
                          alert(`Copied IFSC: ${b.ifsc}`);
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                      >
                        📋 Copy IFSC
                      </button>
                    </div>
                  )}
                  {b.upiId && (
                    <div className="flex items-center justify-between bg-surface p-1 rounded border border-line">
                      <span className="text-muted">UPI: <strong className="font-mono text-good">{b.upiId}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(b.upiId!);
                          alert(`Copied UPI: ${b.upiId}`);
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                      >
                        📋 Copy UPI
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${
                  feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
                }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handlePaySubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Payout Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full text-sm font-bold p-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
                  placeholder="e.g. 25000"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Payment Method / Tender *</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs focus:outline-none focus:border-accent"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI / Corporate QR</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="CASH">Physical Cash</option>
                </select>
              </div>

              {/* Bank Transfer Details */}
              {payMethod === "BANK_TRANSFER" && (
                <div className="grid grid-cols-2 gap-3 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Debited From Bank Account</label>
                    <select
                      value={bankAccount}
                      onChange={(e) => setBankAccount(e.target.value)}
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
                      placeholder="e.g. UTR8491823901"
                      value={referenceNo}
                      onChange={(e) => setReferenceNo(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                </div>
              )}

              {/* UPI */}
              {payMethod === "UPI" && (
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

              {/* Cheque */}
              {payMethod === "CHEQUE" && (
                <div className="grid grid-cols-3 gap-2 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Cheque No *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 003921"
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC Bank"
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
                <label className="block font-semibold text-ink mb-1">Notes / Voucher Narration</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Paid in full via NEFT against purchase invoice"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {submitting ? "Processing..." : "Confirm & Issue Payment Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
