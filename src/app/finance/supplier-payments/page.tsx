"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";
import { SupplierBankInfo } from "@/lib/supplier-bank";

type PendingBill = {
  id: string;
  supplierId: string;
  supplierName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  bankDetails: string | null;
  bankInfo?: SupplierBankInfo;
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

type SupplierItem = {
  id: string;
  name: string;
  category?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  gstin?: string | null;
  paymentTerms?: string | null;
  bankDetails?: string | null;
  bankInfo?: SupplierBankInfo;
  creditDays?: number;
  creditLimit?: number | null;
  active: boolean;
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
  suppliers: SupplierItem[];
  paymentRequests: PaymentRequest[];
  bankOutflows: BankOutflow[];
};

export default function SupplierPaymentsPage() {
  const [activeTab, setActiveTab] = useState<"requests" | "bills" | "suppliers" | "reconciliation">("requests");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Create Request Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestSupplier, setRequestSupplier] = useState("");
  const [requestBillNo, setRequestBillNo] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestMethod, setRequestMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [requestNotes, setRequestNotes] = useState("");

  // Searchable combobox dropdown state for supplier
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState(false);

  // Add New Supplier Modal State
  const initialNewSupplierState = {
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    gstin: "",
    address: "",
    city: "",
    state: "",
    bankName: "",
    accountNumber: "",
    ifsc: "",
    branch: "",
    accountHolder: "",
    upiId: "",
  };
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState(initialNewSupplierState);

  // Execute Disbursement Modal State
  const [executingVoucher, setExecutingVoucher] = useState<PaymentRequest | null>(null);
  const [executingSupplierInfo, setExecutingSupplierInfo] = useState<SupplierBankInfo | null>(null);
  const [execMethod, setExecMethod] = useState<"BANK_TRANSFER" | "UPI" | "CHEQUE" | "CASH">("BANK_TRANSFER");
  const [execBank, setExecBank] = useState("HDFC Current");
  const [execReference, setExecReference] = useState("");
  const [execChequeNo, setExecChequeNo] = useState("");
  const [execChequeBank, setExecChequeBank] = useState("");
  const [execChequeDate, setExecChequeDate] = useState("");
  const [execNotes, setExecNotes] = useState("");

  // Edit Supplier & Bank Info Modal State
  const [editingSupplier, setEditingSupplier] = useState<{
    id: string;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    gstin: string;
    address: string;
    city: string;
    state: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    branch: string;
    accountHolder: string;
    upiId: string;
  } | null>(null);

  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<SupplierPaymentsApiResponse>("/api/finance/supplier-payments");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { metrics, userRole } = data;
  const canApprove = userRole === "ADMIN" || userRole === "MANAGER";

  const handleCopy = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedText(`${label}: ${text}`);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Open Add Supplier Modal
  const openAddSupplierModal = (defaultName?: string) => {
    setNewSupplierForm({
      ...initialNewSupplierState,
      name: defaultName || (requestSupplier.trim() !== "" ? requestSupplier.trim() : ""),
    });
    setIsAddSupplierModalOpen(true);
    setIsSupplierDropdownOpen(false);
    setFeedback(null);
  };

  // Instant Add New Supplier
  const handleCreateNewSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierForm.name.trim()) {
      setFeedback({ type: "error", message: "Supplier name is required" });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSupplierForm.name.trim(),
          contactPerson: newSupplierForm.contactPerson.trim() || undefined,
          phone: newSupplierForm.phone.trim() || undefined,
          email: newSupplierForm.email.trim() || undefined,
          gstin: newSupplierForm.gstin.trim() ? newSupplierForm.gstin.trim().toUpperCase() : undefined,
          address: newSupplierForm.address.trim() || undefined,
          city: newSupplierForm.city.trim() || undefined,
          state: newSupplierForm.state.trim() || undefined,
          bankInfo: {
            bankName: newSupplierForm.bankName.trim() || undefined,
            accountNumber: newSupplierForm.accountNumber.trim().replace(/\s+/g, "") || undefined,
            ifsc: newSupplierForm.ifsc.trim().toUpperCase().replace(/\s+/g, "") || undefined,
            branch: newSupplierForm.branch.trim() || undefined,
            accountHolder: newSupplierForm.accountHolder.trim() || newSupplierForm.name.trim() || undefined,
            upiId: newSupplierForm.upiId.trim().replace(/\s+/g, "") || undefined,
          },
        }),
      });

      const created = await res.json();
      if (!res.ok) throw new Error(created.error || "Failed to create supplier");

      const createdName = created.name || newSupplierForm.name.trim();
      setRequestSupplier(createdName);
      setIsAddSupplierModalOpen(false);
      setNewSupplierForm(initialNewSupplierState);
      setFeedback({ type: "success", message: `Supplier "${createdName}" created and selected for payment!` });
      reload();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to register supplier" });
    } finally {
      setActionLoading(false);
    }
  };

  // Open Edit Supplier Modal from bill or supplier record
  const openEditSupplierModal = (sup: {
    supplierId?: string;
    id?: string;
    supplierName?: string;
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    bankInfo?: SupplierBankInfo;
  }) => {
    const sId = sup.supplierId || sup.id || "";
    const sName = sup.supplierName || sup.name || "";
    const bInfo = sup.bankInfo || {};

    setEditingSupplier({
      id: sId,
      name: sName,
      contactPerson: sup.contactPerson || "",
      phone: sup.phone || "",
      email: sup.email || "",
      gstin: sup.gstin || "",
      address: sup.address || "",
      city: sup.city || "",
      state: sup.state || "",
      bankName: bInfo.bankName || "",
      accountNumber: bInfo.accountNumber || "",
      ifsc: bInfo.ifsc || "",
      branch: bInfo.branch || "",
      accountHolder: bInfo.accountHolder || sName,
      upiId: bInfo.upiId || "",
    });
    setFeedback(null);
  };

  // Save Supplier & Bank Info Changes
  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/supplier-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_SUPPLIER",
          supplierId: editingSupplier.id,
          name: editingSupplier.name,
          contactPerson: editingSupplier.contactPerson,
          phone: editingSupplier.phone,
          email: editingSupplier.email,
          gstin: editingSupplier.gstin,
          address: editingSupplier.address,
          city: editingSupplier.city,
          state: editingSupplier.state,
          bankInfo: {
            bankName: editingSupplier.bankName,
            accountNumber: editingSupplier.accountNumber,
            ifsc: editingSupplier.ifsc,
            branch: editingSupplier.branch,
            accountHolder: editingSupplier.accountHolder,
            upiId: editingSupplier.upiId,
          },
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to update supplier details");

      setFeedback({ type: "success", message: `Supplier & banking details for ${editingSupplier.name} saved successfully!` });
      setTimeout(() => {
        setEditingSupplier(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to save supplier info" });
    } finally {
      setActionLoading(false);
    }
  };

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
    const matchedSupplier = (data.suppliers || []).find(
      (s) => s.name.toLowerCase() === voucher.partyName.toLowerCase()
    );
    setExecutingSupplierInfo(matchedSupplier?.bankInfo || null);
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
    b.grnNumber.toLowerCase().includes(q.toLowerCase()) ||
    (b.bankInfo?.bankName && b.bankInfo.bankName.toLowerCase().includes(q.toLowerCase())) ||
    (b.bankInfo?.accountNumber && b.bankInfo.accountNumber.includes(q)) ||
    (b.bankInfo?.ifsc && b.bankInfo.ifsc.toLowerCase().includes(q.toLowerCase()))
  );

  const filteredSuppliers = (data.suppliers || []).filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.contactPerson && s.contactPerson.toLowerCase().includes(q.toLowerCase())) ||
    (s.phone && s.phone.includes(q)) ||
    (s.gstin && s.gstin.toLowerCase().includes(q.toLowerCase())) ||
    (s.bankInfo?.bankName && s.bankInfo.bankName.toLowerCase().includes(q.toLowerCase())) ||
    (s.bankInfo?.accountNumber && s.bankInfo.accountNumber.includes(q)) ||
    (s.bankInfo?.ifsc && s.bankInfo.ifsc.toLowerCase().includes(q.toLowerCase())) ||
    (s.bankInfo?.upiId && s.bankInfo.upiId.toLowerCase().includes(q.toLowerCase()))
  );

  const matchedSupplierInRequest = (data.suppliers || []).find(
    (s) => s.name.toLowerCase() === requestSupplier.trim().toLowerCase()
  );

  const requestSupplierMatches = (data.suppliers || []).filter((s) => {
    if (!requestSupplier.trim()) return true;
    const term = requestSupplier.toLowerCase();
    const bInfo = s.bankInfo || {};
    return (
      s.name.toLowerCase().includes(term) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(term)) ||
      (s.phone && s.phone.includes(term)) ||
      (s.gstin && s.gstin.toLowerCase().includes(term)) ||
      (bInfo.bankName && bInfo.bankName.toLowerCase().includes(term)) ||
      (bInfo.accountNumber && bInfo.accountNumber.includes(term)) ||
      (bInfo.ifsc && bInfo.ifsc.toLowerCase().includes(term)) ||
      (bInfo.upiId && bInfo.upiId.toLowerCase().includes(term))
    );
  });

  const filteredOutflows = data.bankOutflows.filter((t) =>
    (t.partyName && t.partyName.toLowerCase().includes(q.toLowerCase())) ||
    (t.utrReference && t.utrReference.toLowerCase().includes(q.toLowerCase())) ||
    (t.bankName && t.bankName.toLowerCase().includes(q.toLowerCase()))
  );

  const parsedAmt = parseFloat(requestAmount);
  const exceedsThreshold = !isNaN(parsedAmt) && parsedAmt > metrics.thresholds.directLimit;

  return (
    <div className="space-y-5">
      {/* Copied Toast Notification */}
      {copiedText && (
        <div className="fixed bottom-5 right-5 z-50 bg-ink text-surface px-4 py-2 rounded-lg shadow-xl text-xs font-bold flex items-center gap-2 border border-line animate-bounce">
          <span>📋</span>
          <span>{copiedText} copied to clipboard!</span>
        </div>
      )}

      {/* Top Banner & Lifecycle Flow */}
      <div className="bg-surface-hi p-4 rounded-xl border border-line space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💸</span>
              <h1 className="text-xl font-black text-ink">Supplier Payments</h1>
            </div>

          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openAddSupplierModal()}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-surface-2 hover:bg-surface-hi border border-line text-ink flex items-center gap-1.5 transition-all shadow-xs"
            >
              <span>+</span> Add Supplier
            </button>

            <button
              onClick={() => {
                if (data.suppliers && data.suppliers.length > 0 && data.suppliers[0]) {
                  openEditSupplierModal(data.suppliers[0]);
                } else {
                  setActiveTab("suppliers");
                }
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-surface-2 hover:bg-surface-hi border border-line text-ink flex items-center gap-1.5 transition-all shadow-xs"
            >
              🏢 Manage Supplier Bank Info
            </button>

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
        </div>

        {/* Visual Lifecycle Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-line/60 text-xs">
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">Payable Inward</span>
            <span className="text-[10px] text-muted ml-auto">{metrics.pendingBillsCount} Bills</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">Request Made</span>
            <span className="text-[10px] text-muted ml-auto">Finance Team</span>
          </div>
          <div className={`p-2 rounded border flex items-center gap-2 ${metrics.pendingApprovalCount > 0 ? "bg-warn/10 border-warn/40 text-warn" : "bg-surface border-line text-ink"
            }`}>
            <span className="font-bold">Approval</span>
            <span className="text-[10px] ml-auto font-semibold">
              {metrics.pendingApprovalCount > 0 ? `${metrics.pendingApprovalCount} Pending` : "✓ Clear"}
            </span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">Disburse</span>
            <span className="text-[10px] text-muted ml-auto">NEFT/RTGS/UPI</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">Reconciliation</span>
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

        <div className={`card p-3 border-l-4 ${metrics.pendingApprovalCount > 0 ? "border-l-warn bg-warn/[0.03]" : "border-l-line"
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
              className={`px-3 py-1.5 rounded transition-all ${activeTab === "requests" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
                }`}
            >
              🛡️ Payment Requests ({data.paymentRequests.length})
            </button>
            <button
              onClick={() => setActiveTab("bills")}
              className={`px-3 py-1.5 rounded transition-all ${activeTab === "bills" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
                }`}
            >
              📄 Pending Bills & Bank Details ({data.pendingBills.length})
            </button>
            <button
              onClick={() => setActiveTab("suppliers")}
              className={`px-3 py-1.5 rounded transition-all ${activeTab === "suppliers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
                }`}
            >
              🏢 Supplier Bank Directory ({(data.suppliers || []).length})
            </button>
            <button
              onClick={() => setActiveTab("reconciliation")}
              className={`px-3 py-1.5 rounded transition-all ${activeTab === "reconciliation" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
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
            placeholder="Search supplier, bank, IFSC, account #..."
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

      {/* VIEW 2: PENDING BILLS & BANK DETAILS QUEUE */}
      {activeTab === "bills" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex flex-wrap justify-between items-center gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink">Inward Purchase Bills & Supplier Bank Account</h2>

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
                <th className="py-3 px-4">Supplier Party</th>
                <th className="py-3 px-3">Bill & GRN #</th>
                <th className="py-3 px-3">Bill Date / Due</th>
                <th className="py-3 px-3 text-right">Bill Total (₹)</th>
                <th className="py-3 px-3">Bank Details (A/C, IFSC, UPI)</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    No unpaid purchase bills found.
                  </td>
                </tr>
              ) : (
                filteredBills.map((b) => {
                  const bInfo = b.bankInfo || {};
                  const hasBank = !!(bInfo.accountNumber || bInfo.ifsc || bInfo.upiId || b.bankDetails);

                  return (
                    <tr key={b.id} className="hover:bg-surface-hi/80 transition-colors">
                      {/* Supplier & Contact */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-ink">{b.supplierName}</div>
                        {b.contactPerson && (
                          <div className="text-[11px] text-muted">{b.contactPerson}</div>
                        )}
                        {b.phone && (
                          <div className="text-[10px] text-muted font-mono">{b.phone}</div>
                        )}
                        {b.gstin && (
                          <div className="text-[10px] text-muted font-mono uppercase">GST: {b.gstin}</div>
                        )}
                      </td>

                      {/* Bill & GRN */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-ink">{b.supplierBillNo}</div>
                        <div className="text-[10px] text-muted font-mono">GRN: {b.grnNumber}</div>
                        {b.poNumber && <div className="text-[10px] text-muted font-mono">PO: {b.poNumber}</div>}
                      </td>

                      {/* Dates */}
                      <td className="py-3 px-3">
                        <div className="text-muted font-mono">{b.billDate}</div>
                        <div className="text-[10px] font-medium text-ink font-mono">
                          Due: {b.dueDate || "Immediate"}
                        </div>
                      </td>

                      {/* Total */}
                      <td className="py-3 px-3 text-right font-black text-bad text-sm">
                        ₹{b.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Structured Bank & UPI Details */}
                      <td className="py-3 px-3">
                        {hasBank ? (
                          <div className="space-y-1 text-[11px]">
                            {bInfo.bankName && (
                              <div className="font-bold text-ink flex items-center gap-1.5">
                                <span>🏦</span>
                                <span>{bInfo.bankName}</span>
                                {bInfo.branch && <span className="text-[10px] text-muted font-normal">({bInfo.branch})</span>}
                              </div>
                            )}

                            {bInfo.accountNumber ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted text-[10px]">A/C:</span>
                                <span className="font-mono font-bold text-ink">{bInfo.accountNumber}</span>
                                <button
                                  onClick={() => handleCopy(bInfo.accountNumber!, "A/C Number")}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line text-muted hover:text-ink"
                                  title="Copy Account Number"
                                >
                                  📋 Copy
                                </button>
                              </div>
                            ) : null}

                            {bInfo.ifsc ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted text-[10px]">IFSC:</span>
                                <span className="font-mono font-bold text-accent uppercase">{bInfo.ifsc}</span>
                                <button
                                  onClick={() => handleCopy(bInfo.ifsc!, "IFSC Code")}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line text-muted hover:text-ink"
                                  title="Copy IFSC Code"
                                >
                                  📋 Copy
                                </button>
                              </div>
                            ) : null}

                            {bInfo.upiId ? (
                              <div className="flex items-center gap-1.5 text-good">
                                <span className="text-[10px]">UPI:</span>
                                <span className="font-mono font-semibold">{bInfo.upiId}</span>
                                <button
                                  onClick={() => handleCopy(bInfo.upiId!, "UPI ID")}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line text-muted hover:text-ink"
                                  title="Copy UPI ID"
                                >
                                  📋 Copy
                                </button>
                              </div>
                            ) : null}

                            {!bInfo.accountNumber && !bInfo.ifsc && !bInfo.upiId && b.bankDetails && (
                              <div className="text-[10px] text-muted font-mono">{b.bankDetails}</div>
                            )}
                          </div>
                        ) : (
                          <div className="text-muted italic flex items-center gap-1.5">
                            <span>⚠️ No Bank Account Saved</span>
                            <button
                              onClick={() => openEditSupplierModal(b)}
                              className="text-[10px] font-bold text-accent hover:underline"
                            >
                              + Add
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openEditSupplierModal(b)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink flex items-center gap-1"
                            title="Edit Supplier and Bank Info"
                          >
                            <span>✏️</span> Edit Info
                          </button>
                          <button
                            onClick={() => openCreateModalForBill(b)}
                            className="px-3 py-1 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm"
                          >
                            + Pay Request
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: SUPPLIER BANK DIRECTORY TAB */}
      {activeTab === "suppliers" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex flex-wrap justify-between items-center gap-2">
            <div>
              <h2 className="text-sm font-bold text-ink">Suppliers Bank Directory</h2>
              <p className="text-[11px] text-muted">
                Maintain vendor bank account numbers, IFSC codes, UPI handles, and tax credentials for finance payouts
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted">
                Total Registered Suppliers: <strong className="text-ink">{filteredSuppliers.length}</strong>
              </div>
              <button
                type="button"
                onClick={() => openAddSupplierModal()}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/90 shadow-sm flex items-center gap-1.5"
              >
                <span>+</span> Add New Supplier
              </button>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Supplier Firm Name</th>
                <th className="py-3 px-3">Contact & Phone</th>
                <th className="py-3 px-3">GSTIN / PAN</th>
                <th className="py-3 px-3">Location</th>
                <th className="py-3 px-3">Bank Account & IFSC</th>
                <th className="py-3 px-3">UPI ID</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No suppliers found matching the search criteria.
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s) => {
                  const bInfo = s.bankInfo || {};
                  return (
                    <tr key={s.id} className="hover:bg-surface-hi/80 transition-colors">
                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-ink">{s.name}</div>
                        {s.category && <div className="text-[10px] text-muted">{s.category}</div>}
                      </td>

                      {/* Contact & Phone */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-ink">{s.contactPerson || "—"}</div>
                        {s.phone && <div className="text-[10px] text-muted font-mono">{s.phone}</div>}
                        {s.email && <div className="text-[10px] text-muted truncate max-w-xs">{s.email}</div>}
                      </td>

                      {/* GSTIN */}
                      <td className="py-3 px-3 font-mono uppercase text-muted">
                        {s.gstin || "—"}
                      </td>

                      {/* Location */}
                      <td className="py-3 px-3 text-muted">
                        <div>{s.city || "—"}</div>
                        {s.state && <div className="text-[10px]">{s.state}</div>}
                      </td>

                      {/* Bank Details */}
                      <td className="py-3 px-3">
                        {bInfo.accountNumber || bInfo.ifsc ? (
                          <div className="space-y-0.5 text-[11px]">
                            {bInfo.bankName && <div className="font-bold text-ink">🏦 {bInfo.bankName}</div>}
                            {bInfo.accountNumber && (
                              <div className="flex items-center gap-1 font-mono">
                                <span className="text-muted text-[10px]">A/C:</span>
                                <span className="font-bold">{bInfo.accountNumber}</span>
                                <button
                                  onClick={() => handleCopy(bInfo.accountNumber!, "A/C")}
                                  className="text-[10px] px-1 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line"
                                >
                                  📋
                                </button>
                              </div>
                            )}
                            {bInfo.ifsc && (
                              <div className="flex items-center gap-1 font-mono text-accent">
                                <span className="text-muted text-[10px]">IFSC:</span>
                                <span className="font-bold">{bInfo.ifsc}</span>
                                <button
                                  onClick={() => handleCopy(bInfo.ifsc!, "IFSC")}
                                  className="text-[10px] px-1 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line"
                                >
                                  📋
                                </button>
                              </div>
                            )}
                          </div>
                        ) : s.bankDetails ? (
                          <span className="font-mono text-[10px] text-muted">{s.bankDetails}</span>
                        ) : (
                          <span className="text-muted italic text-[11px]">Not configured</span>
                        )}
                      </td>

                      {/* UPI */}
                      <td className="py-3 px-3">
                        {bInfo.upiId ? (
                          <div className="flex items-center gap-1 font-mono text-good text-[11px]">
                            <span>{bInfo.upiId}</span>
                            <button
                              onClick={() => handleCopy(bInfo.upiId!, "UPI ID")}
                              className="text-[10px] px-1 py-0.5 rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink"
                            >
                              📋
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => openEditSupplierModal(s)}
                          className="px-3 py-1 text-xs font-semibold rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink shadow-xs"
                        >
                          ✏️ Edit Bank Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 4: BANK OUTFLOWS & RECONCILIATION */}
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
                className={`p-3 rounded-lg text-xs font-semibold ${feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
                  }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleCreateRequest} className="space-y-3 text-xs">
              {/* Searchable Supplier Combobox */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-ink">Supplier / Vendor *</label>
                  <button
                    type="button"
                    onClick={() => openAddSupplierModal(requestSupplier)}
                    className="text-[11px] font-bold text-accent hover:text-accent/80 flex items-center gap-1 hover:underline"
                  >
                    <span>+</span>
                    <span>Add New / Custom Supplier</span>
                  </button>
                </div>

                <div className="relative">
                  <div className="relative flex items-center">
                    <span className="absolute left-2.5 text-muted pointer-events-none text-xs">🔍</span>
                    <input
                      type="text"
                      required
                      value={requestSupplier}
                      onFocus={() => setIsSupplierDropdownOpen(true)}
                      onChange={(e) => {
                        setRequestSupplier(e.target.value);
                        setIsSupplierDropdownOpen(true);
                      }}
                      placeholder="Search or enter supplier name, phone, GSTIN..."
                      className="w-full pl-8 pr-8 py-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent text-xs font-medium"
                    />
                    {requestSupplier && (
                      <button
                        type="button"
                        onClick={() => {
                          setRequestSupplier("");
                          setIsSupplierDropdownOpen(true);
                        }}
                        className="absolute right-2.5 px-1 text-muted hover:text-ink text-xs font-bold"
                        title="Clear"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Dropdown Suggestions Menu */}
                  {isSupplierDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsSupplierDropdownOpen(false)}
                      />
                      <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-line rounded-lg shadow-2xl z-50 max-h-56 overflow-y-auto divide-y divide-line/60">
                        <div className="p-1.5 bg-surface-hi/80 text-[10px] font-bold text-muted uppercase tracking-wider flex items-center justify-between">
                          <span>Matching Suppliers ({requestSupplierMatches.length})</span>
                          <button
                            type="button"
                            onClick={() => openAddSupplierModal(requestSupplier)}
                            className="text-accent hover:underline lowercase font-semibold"
                          >
                            + add new
                          </button>
                        </div>

                        {requestSupplierMatches.length === 0 ? (
                          <div className="p-3 text-center space-y-2">
                            <div className="text-muted text-xs">
                              No registered supplier matches &ldquo;<span className="font-semibold text-ink">{requestSupplier}</span>&rdquo;
                            </div>
                            <button
                              type="button"
                              onClick={() => openAddSupplierModal(requestSupplier)}
                              className="w-full py-1.5 px-3 bg-accent text-white rounded text-xs font-bold hover:bg-accent/90 shadow-sm"
                            >
                              + Register &ldquo;{requestSupplier}&rdquo; with Bank Info
                            </button>
                          </div>
                        ) : (
                          <>
                            {requestSupplierMatches.map((sup) => {
                              const bInfo = sup.bankInfo || {};
                              const isSelected = sup.name.toLowerCase() === requestSupplier.trim().toLowerCase();

                              return (
                                <button
                                  key={sup.id}
                                  type="button"
                                  onClick={() => {
                                    setRequestSupplier(sup.name);
                                    setIsSupplierDropdownOpen(false);
                                  }}
                                  className={`w-full text-left p-2.5 hover:bg-surface-hi transition-colors flex items-start justify-between gap-2 ${isSelected ? "bg-accent/10 border-l-2 border-accent" : ""
                                    }`}
                                >
                                  <div>
                                    <div className="font-bold text-ink flex items-center gap-1.5">
                                      <span>{sup.name}</span>
                                      {isSelected && <span className="text-accent text-[10px]">✓ Selected</span>}
                                    </div>
                                    <div className="text-[11px] text-muted flex flex-wrap items-center gap-2 mt-0.5">
                                      {sup.contactPerson && <span>👤 {sup.contactPerson}</span>}
                                      {sup.phone && <span className="font-mono">📞 {sup.phone}</span>}
                                      {sup.gstin && <span className="font-mono uppercase">GST: {sup.gstin}</span>}
                                    </div>
                                  </div>
                                  <div className="text-right text-[10px] text-muted space-y-0.5 flex-shrink-0">
                                    {bInfo.bankName && (
                                      <div className="font-semibold text-ink">🏦 {bInfo.bankName}</div>
                                    )}
                                    {bInfo.accountNumber && (
                                      <div className="font-mono">A/C: ••••{bInfo.accountNumber.slice(-4)}</div>
                                    )}
                                    {bInfo.ifsc && (
                                      <div className="font-mono text-accent">{bInfo.ifsc}</div>
                                    )}
                                    {bInfo.upiId && (
                                      <div className="font-mono text-good">{bInfo.upiId}</div>
                                    )}
                                    {!bInfo.accountNumber && !bInfo.upiId && (
                                      <span className="text-muted italic">No bank info</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}

                            <div className="p-2 bg-surface-hi border-t border-line text-center">
                              <button
                                type="button"
                                onClick={() => openAddSupplierModal(requestSupplier)}
                                className="text-xs text-accent font-bold hover:underline"
                              >
                                + Add Custom / New Supplier Popup
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Selected Supplier Bank Account Preview Badge */}
                {matchedSupplierInRequest && (
                  <div className="mt-2 bg-accent/5 border border-accent/20 rounded-lg p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-accent flex items-center gap-1.5">
                        <span>🏦</span>
                        <span>Linked Supplier Bank & Payout Info</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditSupplierModal(matchedSupplierInRequest)}
                        className="text-[10px] font-bold text-accent hover:underline flex items-center gap-0.5"
                      >
                        <span>✏️</span> Edit Details
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-accent/10">
                      <div>
                        <span className="text-muted block text-[10px]">Bank & Branch</span>
                        <span className="font-semibold text-ink">
                          {matchedSupplierInRequest.bankInfo?.bankName || "Not configured"}
                          {matchedSupplierInRequest.bankInfo?.branch ? ` (${matchedSupplierInRequest.bankInfo.branch})` : ""}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">Account Number</span>
                        <span className="font-mono font-bold text-ink">
                          {matchedSupplierInRequest.bankInfo?.accountNumber || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">IFSC Code</span>
                        <span className="font-mono font-bold text-accent uppercase">
                          {matchedSupplierInRequest.bankInfo?.ifsc || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block text-[10px]">UPI Handle</span>
                        <span className="font-mono font-bold text-good">
                          {matchedSupplierInRequest.bankInfo?.upiId || "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
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

      {/* MODAL 2: EXECUTE PAYMENT DISBURSEMENT WITH BENEFICIARY BANK DETAILS */}
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

            {/* Beneficiary Bank Account Information */}
            {executingSupplierInfo && (executingSupplierInfo.accountNumber || executingSupplierInfo.ifsc || executingSupplierInfo.upiId) && (
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="font-bold text-accent flex items-center gap-1.5">
                  <span>🏦</span>
                  <span>Beneficiary Payout Account</span>
                </div>
                {executingSupplierInfo.bankName && (
                  <div className="text-muted font-semibold">{executingSupplierInfo.bankName} {executingSupplierInfo.branch ? `(${executingSupplierInfo.branch})` : ""}</div>
                )}
                {executingSupplierInfo.accountNumber && (
                  <div className="flex items-center justify-between bg-surface p-1.5 rounded border border-line">
                    <span className="text-muted">Account No: <strong className="font-mono text-ink">{executingSupplierInfo.accountNumber}</strong></span>
                    <button
                      type="button"
                      onClick={() => handleCopy(executingSupplierInfo.accountNumber!, "A/C Number")}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                    >
                      📋 Copy A/C
                    </button>
                  </div>
                )}
                {executingSupplierInfo.ifsc && (
                  <div className="flex items-center justify-between bg-surface p-1.5 rounded border border-line">
                    <span className="text-muted">IFSC Code: <strong className="font-mono text-accent uppercase">{executingSupplierInfo.ifsc}</strong></span>
                    <button
                      type="button"
                      onClick={() => handleCopy(executingSupplierInfo.ifsc!, "IFSC")}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                    >
                      📋 Copy IFSC
                    </button>
                  </div>
                )}
                {executingSupplierInfo.upiId && (
                  <div className="flex items-center justify-between bg-surface p-1.5 rounded border border-line">
                    <span className="text-muted">UPI Handle: <strong className="font-mono text-good">{executingSupplierInfo.upiId}</strong></span>
                    <button
                      type="button"
                      onClick={() => handleCopy(executingSupplierInfo.upiId!, "UPI ID")}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-surface-2 hover:bg-surface-hi border border-line"
                    >
                      📋 Copy UPI
                    </button>
                  </div>
                )}
              </div>
            )}

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
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
                    <label className="block font-semibold text-ink mb-1">Debited From Bank Account</label>
                    <select
                      value={execBank}
                      onChange={(e) => setExecBank(e.target.value)}
                      className="w-full p-1.5 rounded border border-line bg-surface text-xs"
                    >
                      <option value="HDFC Current">HDFC Current</option>
                      <option value="SBI Current">SBI Current</option>
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

      {/* MODAL 3: EDIT SUPPLIER & BANK INFO */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Edit Supplier & Banking Details</h3>
                <p className="text-xs text-muted">Update supplier master, account number, IFSC code, and tax credentials</p>
              </div>
              <button onClick={() => setEditingSupplier(null)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${feedback.type === "success" ? "bg-good/15 text-good border border-good/30" : "bg-bad/15 text-bad border border-bad/30"
                  }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleSaveSupplier} className="space-y-4 text-xs">
              {/* Section 1: Firm & Contact */}
              <div className="space-y-2">
                <h4 className="font-bold text-ink text-[11px] uppercase tracking-wider border-b border-line pb-1">
                  1. Firm Profile & Contact
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Supplier / Firm Name *</label>
                    <input
                      type="text"
                      required
                      value={editingSupplier.name}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, name: e.target.value })}
                      placeholder="e.g. MVA Enterprises"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Contact Person</label>
                    <input
                      type="text"
                      value={editingSupplier.contactPerson}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, contactPerson: e.target.value })}
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Phone / Mobile</label>
                    <input
                      type="text"
                      value={editingSupplier.phone}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
                      placeholder="e.g. 9899645151"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Email Address</label>
                    <input
                      type="email"
                      value={editingSupplier.email}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, email: e.target.value })}
                      placeholder="supplier@mail.com"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">GSTIN / PAN</label>
                    <input
                      type="text"
                      value={editingSupplier.gstin}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, gstin: e.target.value.toUpperCase() })}
                      placeholder="06ACFFM0485N1ZV"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi font-mono uppercase"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-ink mb-1">Address</label>
                    <input
                      type="text"
                      value={editingSupplier.address}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, address: e.target.value })}
                      placeholder="Plot No., Industrial Area"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">City / State</label>
                    <input
                      type="text"
                      value={editingSupplier.city}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, city: e.target.value })}
                      placeholder="e.g. Gurgaon"
                      className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Structured Banking Details */}
              <div className="space-y-2 bg-surface-hi p-3.5 rounded-xl border border-line">
                <h4 className="font-bold text-accent text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-line pb-1">
                  <span>🏦</span> 2. Banking & Payout Account Information
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={editingSupplier.bankName}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, bankName: e.target.value })}
                      placeholder="e.g. HDFC Bank, State Bank of India"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      value={editingSupplier.accountNumber}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, accountNumber: e.target.value.replace(/\s+/g, "") })}
                      placeholder="e.g. 50200012345678"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono font-bold text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">IFSC Code</label>
                    <input
                      type="text"
                      value={editingSupplier.ifsc}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, ifsc: e.target.value.toUpperCase().replace(/\s+/g, "") })}
                      placeholder="e.g. HDFC0001234"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono uppercase font-bold text-accent"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Branch Name</label>
                    <input
                      type="text"
                      value={editingSupplier.branch}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, branch: e.target.value })}
                      placeholder="e.g. MG Road Branch"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">UPI ID / VPA</label>
                    <input
                      type="text"
                      value={editingSupplier.upiId}
                      onChange={(e) => setEditingSupplier({ ...editingSupplier, upiId: e.target.value.replace(/\s+/g, "") })}
                      placeholder="e.g. supplier@okhdfcbank"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono text-good font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Account Beneficiary / Holder Name</label>
                  <input
                    type="text"
                    value={editingSupplier.accountHolder}
                    onChange={(e) => setEditingSupplier({ ...editingSupplier, accountHolder: e.target.value })}
                    placeholder="Name as printed on Passbook / Cheque"
                    className="w-full p-2 rounded-lg border border-line bg-surface"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setEditingSupplier(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Saving..." : "Save Supplier & Bank Info"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: INSTANT ADD NEW SUPPLIER & BANKING DETAILS POPUP */}
      {isAddSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink flex items-center gap-2">
                  <span>🏢</span>
                  <span>Register New Supplier & Bank Details</span>
                </h3>
                <p className="text-xs text-muted">
                  Instantly add supplier with bank credentials to database & select for payment
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddSupplierModalOpen(false)}
                className="text-muted hover:text-ink text-sm p-1"
              >
                ✕
              </button>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-semibold ${feedback.type === "success"
                  ? "bg-good/15 text-good border border-good/30"
                  : "bg-bad/15 text-bad border border-bad/30"
                  }`}
              >
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleCreateNewSupplier} className="space-y-4 text-xs">
              {/* Section 1: Business Profile */}
              <div className="space-y-2.5 bg-surface-hi/40 p-3.5 rounded-xl border border-line">
                <h4 className="font-bold text-ink text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-line pb-1">
                  <span>📋</span> 1. Supplier Profile
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Supplier / Business Name *</label>
                    <input
                      type="text"
                      required
                      value={newSupplierForm.name}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, name: e.target.value })}
                      placeholder="e.g. Apex Bio Pharma Ltd"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-semibold focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Contact Person</label>
                    <input
                      type="text"
                      value={newSupplierForm.contactPerson}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, contactPerson: e.target.value })}
                      placeholder="e.g. Rajesh Sharma"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Phone / Mobile</label>
                    <input
                      type="text"
                      value={newSupplierForm.phone}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, phone: e.target.value })}
                      placeholder="e.g. 9876543210"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Email Address</label>
                    <input
                      type="email"
                      value={newSupplierForm.email}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })}
                      placeholder="accounts@supplier.com"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">GSTIN / PAN</label>
                    <input
                      type="text"
                      value={newSupplierForm.gstin}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, gstin: e.target.value.toUpperCase() })}
                      placeholder="07AAAAA0000A1Z5"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono uppercase"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-ink mb-1">Address</label>
                    <input
                      type="text"
                      value={newSupplierForm.address}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, address: e.target.value })}
                      placeholder="Plot No., Street / Area"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">City / State</label>
                    <input
                      type="text"
                      value={newSupplierForm.city}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, city: e.target.value })}
                      placeholder="e.g. Mumbai, MH"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Structured Banking Details */}
              <div className="space-y-2.5 bg-surface-hi p-3.5 rounded-xl border border-line">
                <h4 className="font-bold text-accent text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-line pb-1">
                  <span>🏦</span> 2. Banking & Payout Account Information
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={newSupplierForm.bankName}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, bankName: e.target.value })}
                      placeholder="e.g. HDFC Bank, SBI, ICICI"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Bank Account Number</label>
                    <input
                      type="text"
                      value={newSupplierForm.accountNumber}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, accountNumber: e.target.value.replace(/\s+/g, "") })}
                      placeholder="e.g. 50200012345678"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono font-bold text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-ink mb-1">IFSC Code</label>
                    <input
                      type="text"
                      value={newSupplierForm.ifsc}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, ifsc: e.target.value.toUpperCase().replace(/\s+/g, "") })}
                      placeholder="e.g. HDFC0001234"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono uppercase font-bold text-accent"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">Branch Name</label>
                    <input
                      type="text"
                      value={newSupplierForm.branch}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, branch: e.target.value })}
                      placeholder="e.g. Fort Branch"
                      className="w-full p-2 rounded-lg border border-line bg-surface"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">UPI ID / VPA</label>
                    <input
                      type="text"
                      value={newSupplierForm.upiId}
                      onChange={(e) => setNewSupplierForm({ ...newSupplierForm, upiId: e.target.value.replace(/\s+/g, "") })}
                      placeholder="e.g. apexbiopharma@okhdfcbank"
                      className="w-full p-2 rounded-lg border border-line bg-surface font-mono text-good font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Account Beneficiary Name</label>
                  <input
                    type="text"
                    value={newSupplierForm.accountHolder}
                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, accountHolder: e.target.value })}
                    placeholder="Name as in bank record (defaults to business name)"
                    className="w-full p-2 rounded-lg border border-line bg-surface"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsAddSupplierModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md flex items-center gap-1.5"
                >
                  <span>✓</span>
                  <span>{actionLoading ? "Registering..." : "Save & Select Supplier"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
