"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type PendingBill = {
  id: string;
  supplierId: string;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  bankDetails: string | null;
  supplierBillNo: string;
  grnNumber: string;
  poNumber: string | null;
  billDate: string;
  dueDate: string | null;
  total: number;
  paymentStatus: string;
  warehouse: string;
};

type PaymentRequest = {
  id: string;
  voucherNo: string;
  date: string;
  partyName: string;
  amount: number;
  paymentMode: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
  referenceNo: string | null;
  notes: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";
  requiresApproval: boolean;
  createdBy: { name: string; staffId: string } | null;
  approvedBy: { name: string; staffId: string } | null;
  warehouse: string;
};

type BankOutflow = {
  id: string;
  businessDate: string;
  amount: number;
  bankName: string;
  utrReference: string | null;
  partyName: string | null;
  notes: string | null;
  reconciled: boolean;
};

type SupplierPaymentsApiResponse = {
  userRole: "ADMIN" | "MANAGER" | "FINANCE" | string;
  userId: string;
  metrics: {
    totalPayableDemand: number;
    pendingBillsCount: number;
    pendingApprovalCount: number;
    pendingApprovalAmount: number;
    approvedReadyCount: number;
    approvedReadyAmount: number;
    paidCount: number;
    paidAmount: number;
    reconciledCount: number;
    unreconciledCount: number;
    thresholds: {
      directLimit: number;
      managerLimit: number;
    };
  };
  pendingBills: PendingBill[];
  paymentRequests: PaymentRequest[];
  bankOutflows: BankOutflow[];
};

export default function SupplierPaymentsPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "bills" | "reconciliation">("requests");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create Request Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestSupplier, setRequestSupplier] = useState("");
  const [requestBillNo, setRequestBillNo] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMethod, setRequestMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [requestNotes, setRequestNotes] = useState("");

  // Execute Disbursement Modal State
  const [executingVoucher, setExecutingVoucher] = useState<PaymentRequest | null>(null);
  const [execMethod, setExecMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [execBank, setExecBank] = useState("HDFC Current");
  const [execReference, setExecReference] = useState("");
  const [execChequeNo, setExecChequeNo] = useState("");
  const [execChequeBank, setExecChequeBank] = useState("");
  const [execChequeDate, setExecChequeDate] = useState("");
  const [execNotes, setExecNotes] = useState("");

  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<SupplierPaymentsApiResponse>("/api/finance/supplier-payments");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { metrics, userRole } = data;
  const canApprove = userRole === "ADMIN" || userRole === "MANAGER";

  // Open Create Request Modal Pre-filled
  const openCreateModalForBill = (bill: PendingBill) => {
    setRequestSupplier(bill.supplierName);
    setRequestBillNo(bill.supplierBillNo);
    setRequestAmount(bill.total.toString());
    setRequestMethod("BANK_TRANSFER");
    setRequestNotes(`Payment request against bill ${bill.supplierBillNo} (${bill.grnNumber})`);
    setIsRequestModalOpen(true);
    setFeedback(null);
  };

  // Submit New Payment Request
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(requestAmount);
    if (isNaN(amt) || amt <= 0) {
      setFeedback({ type: "error", message: "Please enter a valid amount" });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_REQUEST",
          supplierName: requestSupplier,
          supplierBillNo: requestBillNo || undefined,
          amount: amt,
          proposedMethod: requestMethod,
          notes: requestNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to create payment request");

      const statusMsg =
        resData.status === "PENDING_APPROVAL"
          ? "Payment request generated (Pending Manager Approval due to ₹25,000+ limit)"
          : "Payment request created & pre-approved for disbursement!";

      setFeedback({ type: "success", message: statusMsg });
      setTimeout(() => {
        setIsRequestModalOpen(false);
        reload();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to submit request" });
    } finally {
      setActionLoading(false);
    }
  };

  // Approve Request Action
  const handleApprove = async (voucherId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE_REQUEST",
          voucherId,
          approvalNotes: `Approved by ${userRole}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Approval failed");
      }

      reload();
    } catch (err: any) {
      alert(err.message || "Approval failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Reject Request Action
  const handleReject = async (voucherId: string) => {
    const reason = prompt("Enter reason for rejecting this payment request:");
    if (reason === null) return;

    setActionLoading(true);
    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REJECT_REQUEST",
          voucherId,
          reason,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Rejection failed");
      }

      reload();
    } catch (err: any) {
      alert(err.message || "Failed to reject request");
    } finally {
      setActionLoading(false);
    }
  };

  // Open Execute Modal
  const openExecuteModal = (voucher: PaymentRequest) => {
    setExecutingVoucher(voucher);
    setExecMethod(voucher.paymentMode || "BANK_TRANSFER");
    setExecBank("HDFC Current");
    setExecReference(voucher.referenceNo || "");
    setExecChequeNo("");
    setExecChequeBank("");
    setExecChequeDate("");
    setExecNotes(`Disbursed to ${voucher.partyName} (Voucher ${voucher.voucherNo})`);
    setFeedback(null);
  };

  // Submit Execution / Payout
  const handleExecutePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!executingVoucher) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EXECUTE_PAYMENT",
          voucherId: executingVoucher.id,
          paymentMethod: execMethod,
          bankName: execBank,
          referenceNo: execReference || undefined,
          chequeNumber: execChequeNo || undefined,
          chequeBank: execChequeBank || undefined,
          chequeDueDate: execChequeDate || undefined,
          notes: execNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Payment execution failed");

      setFeedback({
        type: "success",
        message: `Payout of ₹${executingVoucher.amount.toFixed(2)} executed via ${execMethod}! Bank outflow recorded.`,
      });

      setTimeout(() => {
        setExecutingVoucher(null);
        reload();
      }, 1200);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Payment execution failed" });
    } finally {
      setActionLoading(false);
    }
  };

  // Reconcile Bank Outflow Action
  const handleReconcileOutflow = async (bankTransactionId: string) => {
    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RECONCILE_PAYMENT",
          bankTransactionId,
        }),
      });

      if (!res.ok) throw new Error("Reconciliation failed");
      reload();
    } catch (err: any) {
      alert(err.message || "Failed to reconcile");
    }
  };

  // Filtered lists
  const filteredRequests = data.paymentRequests.filter((r) => {
    const matchesSearch =
      r.partyName.toLowerCase().includes(q.toLowerCase()) ||
      r.voucherNo.toLowerCase().includes(q.toLowerCase()) ||
      (r.referenceNo && r.referenceNo.toLowerCase().includes(q.toLowerCase()));

    if (!matchesSearch) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  });

  const filteredBills = data.pendingBills.filter((b) =>
    b.supplierName.toLowerCase().includes(q.toLowerCase()) ||
    b.supplierBillNo.toLowerCase().includes(q.toLowerCase()) ||
    b.grnNumber.toLowerCase().includes(q.toLowerCase())
  );

  const filteredOutflows = data.bankOutflows.filter((t) =>
    (t.partyName && t.partyName.toLowerCase().includes(q.toLowerCase())) ||
    (t.utrReference && t.utrReference.toLowerCase().includes(q.toLowerCase())) ||
    (t.bankName && t.bankName.toLowerCase().includes(q.toLowerCase()))
  );

  const parsedAmt = parseFloat(requestAmount);
  const exceedsThreshold = !isNaN(parsedAmt) && parsedAmt > metrics.thresholds.directLimit;

  return (
    <div className="space-y-5">
      {/* Top Banner & Lifecycle Flow */}
      <div className="bg-surface-hi p-4 rounded-xl border border-line space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💸</span>
              <h1 className="text-xl font-black text-ink">Supplier Payments Workflow</h1>
            </div>
            <p className="text-xs text-muted mt-0.5">
              End-to-end payable authorization: Request &rarr; Tiered Approval &rarr; Disbursement &rarr; Bank Reconciliation
            </p>
          </div>

          <button
            onClick={() => {
              setRequestSupplier("");
              setRequestBillNo("");
              setRequestAmount("");
              setRequestNotes("");
              setIsRequestModalOpen(true);
              setFeedback(null);
            }}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-accent text-white hover:bg-accent/90 shadow-md flex items-center gap-1.5 transition-all"
          >
            + New Payment Request
          </button>
        </div>

        {/* Visual Lifecycle Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-line/60 text-xs">
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">1️⃣ Payable Inward</span>
            <span className="text-[10px] text-muted ml-auto">{metrics.pendingBillsCount} Bills</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">2️⃣ Request Made</span>
            <span className="text-[10px] text-muted ml-auto">Finance Team</span>
          </div>
          <div className={`p-2 rounded border flex items-center gap-2 ${
            metrics.pendingApprovalCount > 0 ? "bg-warn/10 border-warn/40 text-warn" : "bg-surface border-line text-ink"
          }`}>
            <span className="font-bold">3️⃣ Approval</span>
            <span className="text-[10px] ml-auto font-semibold">
              {metrics.pendingApprovalCount > 0 ? `${metrics.pendingApprovalCount} Pending` : "✓ Clear"}
            </span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">4️⃣ Disburse</span>
            <span className="text-[10px] text-muted ml-auto">NEFT/RTGS/UPI</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">5️⃣ Reconciliation</span>
            <span className="text-[10px] text-good ml-auto font-semibold">{metrics.reconciledCount} Cleared</span>
          </div>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="card p-3">
          <div className="text-[11px] font-semibold text-muted">Total Payable Demand</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{metrics.totalPayableDemand.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{metrics.pendingBillsCount} pending purchase bills</div>
        </div>

        <div className={`card p-3 border-l-4 ${
          metrics.pendingApprovalCount > 0 ? "border-l-warn bg-warn/[0.03]" : "border-l-line"
        }`}>
          <div className="text-[11px] font-semibold text-warn">Pending Approval (&gt;₹25k)</div>
          <div className="text-lg font-black text-warn mt-0.5">
            ₹{metrics.pendingApprovalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{metrics.pendingApprovalCount} requests waiting</div>
        </div>

        <div className="card p-3 border-l-4 border-l-accent bg-accent/[0.03]">
          <div className="text-[11px] font-semibold text-accent">Ready for Disbursement</div>
          <div className="text-lg font-black text-accent mt-0.5">
            ₹{metrics.approvedReadyAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{metrics.approvedReadyCount} approved requests</div>
        </div>

        <div className="card p-3 border-l-4 border-l-good">
          <div className="text-[11px] font-semibold text-good">Paid / Settled</div>
          <div className="text-lg font-black text-good mt-0.5">
            ₹{metrics.paidAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{metrics.paidCount} vouchers paid</div>
        </div>

        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-600">Reconciliation Status</div>
          <div className="text-lg font-black text-sky-600 mt-0.5">
            {metrics.reconciledCount} / {metrics.reconciledCount + metrics.unreconciledCount}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {metrics.unreconciledCount > 0 ? `${metrics.unreconciledCount} pending statement recon` : "✓ 100% matched"}
          </div>
        </div>
      </div>

      {/* Tabs & Search Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab("requests")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "requests" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🛡️ Payment Requests & Approvals ({data.paymentRequests.length})
            </button>
            <button
              onClick={() => setActiveTab("bills")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "bills" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📄 Pending Bills Queue ({data.pendingBills.length})
            </button>
            <button
              onClick={() => setActiveTab("reconciliation")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "reconciliation" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              ⚖️ Bank Outflows & Recon ({data.bankOutflows.length})
            </button>
          </div>

          {activeTab === "requests" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs p-1.5 rounded border border-line bg-surface-hi"
            >
              <option value="all">All Request Statuses</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="APPROVED">Approved (Ready to Disburse)</option>
              <option value="PAID">Paid / Disbursed</option>
              <option value="CANCELLED">Rejected / Cancelled</option>
            </select>
          )}
        </div>

        <div className="w-full sm:w-72">
          <input
            type="search"
            placeholder="Search supplier, voucher #, bill #..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: PAYMENT REQUESTS & APPROVALS QUEUE */}
      {activeTab === "requests" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Payment Authorization & Approval Pipeline</h2>
              <p className="text-[11px] text-muted">
                Large payouts (&gt;₹25,000) require Manager/Admin sign-off prior to bank release
              </p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Threshold Limit: <strong className="text-ink">₹25,000 Direct / Manager Sign-off</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Request / Voucher #</th>
                <th className="py-3 px-3">Supplier Party</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Proposed Method</th>
                <th className="py-3 px-3 text-right">Amount (₹)</th>
                <th className="py-3 px-3 text-center">Approval Tier</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No payment requests found matching filter.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-surface-hi/80 transition-colors">
                    {/* Voucher No */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-ink">{req.voucherNo}</div>
                      {req.referenceNo && (
                        <div className="text-[10px] text-muted font-mono">Ref: {req.referenceNo}</div>
                      )}
                    </td>

                    {/* Supplier */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-ink">{req.partyName}</div>
                      <div className="text-[10px] text-muted">
                        Requested by: {req.createdBy?.name || "Finance"}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="py-3 px-3 text-muted font-mono">{req.date}</td>

                    {/* Method */}
                    <td className="py-3 px-3">
                      <span className="bg-surface-hi px-2 py-0.5 rounded border border-line text-[10px] font-semibold text-ink">
                        {req.paymentMode === "BANK_TRANSFER" ? "NEFT / RTGS" : req.paymentMode}
                      </span>
                    </td>

                    {/* Amount */}
                    <td className="py-3 px-3 text-right font-black text-ink text-sm">
                      ₹{req.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    {/* Approval Tier Flag */}
                    <td className="py-3 px-3 text-center">
                      {req.requiresApproval ? (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-700">
                          🛡️ Manager Sign-off
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-hi text-muted">
                          Standard (&le;₹25k)
                        </span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-3 text-center">
                      {req.status === "PENDING_APPROVAL" && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-warn text-white animate-pulse">
                          Pending Approval
                        </span>
                      )}
                      {req.status === "APPROVED" && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-accent text-white">
                          Ready to Disburse
                        </span>
                      )}
                      {req.status === "PAID" && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-good text-white">
                          ✓ Disbursed
                        </span>
                      )}
                      {req.status === "CANCELLED" && (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-bad/15 text-bad">
                          Rejected
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {req.status === "PENDING_APPROVAL" && canApprove && (
                          <>
                            <button
                              disabled={actionLoading}
                              onClick={() => handleApprove(req.id)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded bg-good text-white hover:bg-good/90 shadow-sm"
                            >
                              ✓ Approve
                            </button>
                            <button
                              disabled={actionLoading}
                              onClick={() => handleReject(req.id)}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-surface-hi hover:bg-bad/20 text-bad border border-bad/30"
                            >
                              ✕
                            </button>
                          </>
                        )}

                        {req.status === "PENDING_APPROVAL" && !canApprove && (
                          <span className="text-[11px] text-muted italic">Awaiting Manager</span>
                        )}

                        {req.status === "APPROVED" && (
                          <button
                            onClick={() => openExecuteModal(req)}
                            className="px-3 py-1 text-[11px] font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm"
                          >
                            💸 Disburse Payout
                          </button>
                        )}

                        {req.status === "PAID" && (
                          <span className="text-[11px] font-semibold text-good">Paid</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 2: PENDING BILLS QUEUE */}
      {activeTab === "bills" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Inward Purchase Bills Awaiting Payment Request</h2>
              <p className="text-[11px] text-muted">Generate payment requests directly against verified GRN invoices</p>
            </div>
            <div className="text-xs font-semibold">
              Total Inward Due:{" "}
              <span className="text-bad font-black">
                ₹{filteredBills.reduce((s, b) => s + b.total, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-3">Supplier Bill #</th>
                <th className="py-3 px-3">GRN Number</th>
                <th className="py-3 px-3">Bill Date</th>
                <th className="py-3 px-3">Due Date</th>
                <th className="py-3 px-3 text-right">Bill Total (₹)</th>
                <th className="py-3 px-3">Bank Details</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No unpaid purchase bills found.
                  </td>
                </tr>
              ) : (
                filteredBills.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-bold text-ink">{b.supplierName}</td>
                    <td className="py-3 px-3 font-semibold text-ink">{b.supplierBillNo}</td>
                    <td className="py-3 px-3 font-mono text-muted">{b.grnNumber}</td>
                    <td className="py-3 px-3 text-muted font-mono">{b.billDate}</td>
                    <td className="py-3 px-3 font-medium text-ink font-mono">{b.dueDate || "—"}</td>
                    <td className="py-3 px-3 text-right font-black text-bad">
                      ₹{b.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-[11px] text-muted truncate max-w-xs font-mono">
                      {b.bankDetails || "On File"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openCreateModalForBill(b)}
                        className="px-3 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm"
                      >
                        + Request Payment
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: BANK OUTFLOWS & RECONCILIATION */}
      {activeTab === "reconciliation" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Supplier Payout Bank Outflow Ledger</h2>
              <p className="text-[11px] text-muted">
                Match disbursed bank transfers and cheques with your monthly bank statements
              </p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Unreconciled Entries: <strong className="text-warn">{metrics.unreconciledCount}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-3">Bank Account</th>
                <th className="py-3 px-3">Party (Supplier)</th>
                <th className="py-3 px-3">UTR / Cheque Ref #</th>
                <th className="py-3 px-3 text-right">Debit Outflow (₹)</th>
                <th className="py-3 px-3 text-center">Reconciliation Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredOutflows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No supplier bank transactions recorded yet.
                  </td>
                </tr>
              ) : (
                filteredOutflows.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-muted">{t.businessDate}</td>
                    <td className="py-3 px-3 font-semibold text-ink">{t.bankName}</td>
                    <td className="py-3 px-3 font-bold text-ink">{t.partyName || "Supplier"}</td>
                    <td className="py-3 px-3 font-mono text-muted">{t.utrReference || "—"}</td>
                    <td className="py-3 px-3 text-right font-black text-bad">
                      -₹{t.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {t.reconciled ? (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-good/15 text-good">
                          ✓ Reconciled
                        </span>
                      ) : (
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-warn/15 text-warn">
                          ⏳ Unreconciled
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {!t.reconciled && (
                        <button
                          onClick={() => handleReconcileOutflow(t.id)}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-hi hover:bg-good/20 text-good border border-good/40 transition-colors"
                        >
                          ✓ Mark Reconciled
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: CREATE PAYMENT REQUEST */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">New Supplier Payment Request</h3>
                <p className="text-xs text-muted">Initiate vendor payout voucher for approval & disbursement</p>
              </div>
              <button onClick={() => setIsRequestModalOpen(false)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
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

            <form onSubmit={handleCreateRequest} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Supplier Name *</label>
                <input
                  type="text"
                  required
                  value={requestSupplier}
                  onChange={(e) => setRequestSupplier(e.target.value)}
                  placeholder="e.g. Acme Pharmaceuticals Pvt Ltd"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">Supplier Bill / Invoice #</label>
                  <input
                    type="text"
                    value={requestBillNo}
                    onChange={(e) => setRequestBillNo(e.target.value)}
                    placeholder="e.g. INV-9042"
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-ink mb-1">Payment Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi font-bold text-ink"
                  />
                </div>
              </div>

              {/* Threshold Warning Banner */}
              {exceedsThreshold && (
                <div className="bg-purple-500/10 border border-purple-500/30 p-2.5 rounded-lg text-purple-700 text-[11px] font-semibold flex items-center gap-2">
                  <span>🛡️</span>
                  <span>Amount exceeds ₹25,000 threshold &mdash; will automatically route to Manager / Admin for approval.</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-ink mb-1">Proposed Payment Tender *</label>
                <select
                  value={requestMethod}
                  onChange={(e) => setRequestMethod(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI / Digital Payment</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="CASH">Cash Payout</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Purpose / Notes</label>
                <textarea
                  rows={2}
                  value={requestNotes}
                  onChange={(e) => setRequestNotes(e.target.value)}
                  placeholder="e.g. Payment against invoice for raw materials received under GRN"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Submitting..." : "Create Payment Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EXECUTE PAYMENT DISBURSEMENT */}
      {executingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Disburse Supplier Payout</h3>
                <p className="text-xs text-muted">
                  Execute payment for voucher <strong className="text-ink">{executingVoucher.voucherNo}</strong>
                </p>
              </div>
              <button onClick={() => setExecutingVoucher(null)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            {/* Summary Box */}
            <div className="bg-surface-hi p-3 rounded-lg border border-line text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted block">Supplier</span>
                <span className="font-bold text-ink">{executingVoucher.partyName}</span>
              </div>
              <div>
                <span className="text-muted block">Disbursement Amount</span>
                <span className="font-black text-good text-sm">
                  ₹{executingVoucher.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
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

            <form onSubmit={handleExecutePayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Disbursement Method *</label>
                <select
                  value={execMethod}
                  onChange={(e) => setExecMethod(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI Payment</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="CASH">Cash Drawer Payout</option>
                </select>
              </div>

              {/* Bank Transfer Details */}
              {execMethod === "BANK_TRANSFER" && (
                <div className="grid grid-cols-2 gap-3 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Debited Bank Account</label>
                    <select
                      value={execBank}
                      onChange={(e) => setExecBank(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    >
                      <option value="HDFC Current">HDFC Current (9482)</option>
                      <option value="SBI Current">SBI Current (1102)</option>
                      <option value="ICICI Current">ICICI Current</option>
                      <option value="Axis Bank">Axis Bank</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank UTR / Ref Number *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. UTR9284918204"
                      value={execReference}
                      onChange={(e) => setExecReference(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                </div>
              )}

              {/* UPI Details */}
              {execMethod === "UPI" && (
                <div className="bg-surface-hi p-3 rounded-lg border border-line">
                  <label className="block font-semibold text-ink mb-1">UPI Ref / RRN Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 481928374910"
                    value={execReference}
                    onChange={(e) => setExecReference(e.target.value)}
                    className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                  />
                </div>
              )}

              {/* Cheque Details */}
              {execMethod === "CHEQUE" && (
                <div className="grid grid-cols-3 gap-2 bg-surface-hi p-3 rounded-lg border border-line">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Cheque No *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 004921"
                      value={execChequeNo}
                      onChange={(e) => setExecChequeNo(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC Bank"
                      value={execChequeBank}
                      onChange={(e) => setExecChequeBank(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Cheque Date</label>
                    <input
                      type="date"
                      value={execChequeDate}
                      onChange={(e) => setExecChequeDate(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-ink mb-1">Payment Narration</label>
                <input
                  type="text"
                  value={execNotes}
                  onChange={(e) => setExecNotes(e.target.value)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setExecutingVoucher(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-good text-white text-xs font-bold hover:bg-good/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Processing..." : "Confirm & Execute Payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
