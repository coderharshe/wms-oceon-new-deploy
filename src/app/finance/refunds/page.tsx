"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type PendingAdjustment = {
  id: string;
  billId: string;
  orderId: string;
  orderNumber: string;
  billNumber: string | null;
  customerName: string;
  customerMobile: string | null;
  previousTotal: number;
  newTotal: number;
  difference: number;
  refundDue: number;
  notes: string | null;
  createdAt: string;
  warehouse: string;
  qcDetails: {
    inspector: string;
    adjustments: {
      product: string;
      originalQty: number;
      finalQty: number;
      action: string;
      reason: string | null;
    }[];
  } | null;
};

type ResolvedRefund = {
  id: string;
  orderNumber: string;
  billNumber: string | null;
  customerName: string;
  customerMobile: string | null;
  refundAmount: number;
  resolutionType: "CASH_REFUND" | "UPI_REFUND" | "CUSTOMER_CREDIT" | "MANAGER_ADJUSTMENT";
  notes: string | null;
  resolvedAt: string;
  warehouse: string;
};

type EligibleOrder = {
  id: string;
  orderNumber: string;
  billNumber: string | null;
  customerName: string;
  mobile: string | null;
  status: string;
  total: number;
  amountPaid: number;
  itemsCount: number;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
  }[];
  createdAt: string;
};

type ReturnMovement = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  movementType: "RETURN" | "QC_ADJUSTMENT" | "DAMAGE";
  loggedBy: string;
  timestamp: string;
};

type RefundsApiResponse = {
  userRole: "ADMIN" | "MANAGER" | "FINANCE" | string;
  userId: string;
  summary: {
    totalRefundedAmount: number;
    cashRefundTotal: number;
    upiRefundTotal: number;
    creditNoteTotal: number;
    managerAdjTotal: number;
    pendingRefundCount: number;
    pendingRefundAmount: number;
    resolvedCount: number;
    restockedUnits: number;
    damagedUnits: number;
  };
  pendingAdjustments: PendingAdjustment[];
  resolvedRefunds: ResolvedRefund[];
  eligibleOrders: EligibleOrder[];
  returnMovements: ReturnMovement[];
};

export default function RefundsPage() {
  const [activeTab, setActiveTab] = useState<"pending" | "orders" | "resolved" | "stock">("pending");
  const [q, setQ] = useState("");

  // Resolve Refund Modal State
  const [targetAdj, setTargetAdj] = useState<PendingAdjustment | null>(null);
  const [resolutionType, setResolutionType] = useState<"CASH_REFUND" | "UPI_REFUND" | "CUSTOMER_CREDIT" | "MANAGER_ADJUSTMENT">("CASH_REFUND");
  const [payoutAccount, setPayoutAccount] = useState("Cash Drawer");
  const [referenceNo, setReferenceNo] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");

  // Initiate Return Modal State
  const [targetOrder, setTargetOrder] = useState<EligibleOrder | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [restockItems, setRestockItems] = useState(true);

  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, reload } = useApiGet<RefundsApiResponse>("/api/finance/refunds");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { summary } = data;

  const openResolveModal = (adj: PendingAdjustment) => {
    setTargetAdj(adj);
    setResolutionType("CASH_REFUND");
    setPayoutAccount("Cash Drawer");
    setReferenceNo("");
    setResolveNotes(`Refund settlement for order ${adj.orderNumber}`);
    setFeedback(null);
  };

  const openReturnModal = (ord: EligibleOrder) => {
    setTargetOrder(ord);
    setReturnReason("Customer Return / Damaged Goods");
    setRestockItems(true);
    setFeedback(null);
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAdj) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RESOLVE_REFUND",
          adjustmentId: targetAdj.id,
          resolutionType,
          payoutAccount: resolutionType === "UPI_REFUND" ? "UPI Settlement" : payoutAccount,
          referenceNo: referenceNo || undefined,
          notes: resolveNotes,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to resolve refund");

      setFeedback({
        type: "success",
        message: `Refund of ₹${targetAdj.refundDue.toFixed(2)} resolved via ${resolutionType}!`,
      });

      setTimeout(() => {
        setTargetAdj(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Something went wrong" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitiateReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetOrder) return;

    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/finance/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "INITIATE_RETURN",
          orderId: targetOrder.id,
          returnReason,
          restockItems,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to initiate return");

      setFeedback({
        type: "success",
        message: `Return recorded for order ${targetOrder.orderNumber}! Stock restocked & refund queued.`,
      });

      setTimeout(() => {
        setTargetOrder(null);
        reload();
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message || "Failed to initiate return" });
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered lists
  const filteredPending = data.pendingAdjustments.filter((p) =>
    p.customerName.toLowerCase().includes(q.toLowerCase()) ||
    p.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
    (p.billNumber && p.billNumber.toLowerCase().includes(q.toLowerCase()))
  );

  const filteredOrders = data.eligibleOrders.filter((o) =>
    o.customerName.toLowerCase().includes(q.toLowerCase()) ||
    o.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
    (o.mobile && o.mobile.includes(q))
  );

  const filteredResolved = data.resolvedRefunds.filter((r) =>
    r.customerName.toLowerCase().includes(q.toLowerCase()) ||
    r.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
    (r.billNumber && r.billNumber.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="space-y-5">
      {/* Top Banner & Lifecycle Flow */}
      <div className="bg-surface-hi p-4 rounded-xl border border-line space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🔄</span>
              <h1 className="text-xl font-black text-ink">Refunds & Credit Notes Management</h1>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Connected Billing Lifecycle: Sale &rarr; Return &rarr; QC Inspection &rarr; Refund Approval &rarr; Cash/Bank/UPI/Credit &rarr; Inventory Restock
            </p>
          </div>

          <button
            onClick={() => setActiveTab("orders")}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-accent text-white hover:bg-accent/90 shadow-md flex items-center gap-1.5 transition-all"
          >
            + Initiate Customer Return
          </button>
        </div>

        {/* Visual Workflow Steps */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t border-line/60 text-xs">
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">1️⃣ Sale</span>
            <span className="text-[10px] text-muted ml-auto">Billed</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">2️⃣ Return</span>
            <span className="text-[10px] text-muted ml-auto">Customer Request</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">3️⃣ QC Check</span>
            <span className="text-[10px] text-muted ml-auto">Inspection</span>
          </div>
          <div className={`p-2 rounded border flex items-center gap-2 ${
            summary.pendingRefundCount > 0 ? "bg-warn/10 border-warn/40 text-warn font-bold" : "bg-surface border-line text-ink"
          }`}>
            <span>4️⃣ Approval</span>
            <span className="text-[10px] ml-auto">
              {summary.pendingRefundCount > 0 ? `${summary.pendingRefundCount} Due` : "✓ Clear"}
            </span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-ink">5️⃣ Refund Payout</span>
            <span className="text-[10px] text-muted ml-auto">Cash / UPI / Credit</span>
          </div>
          <div className="p-2 rounded bg-surface border border-line flex items-center gap-2">
            <span className="font-bold text-good">6️⃣ Restock</span>
            <span className="text-[10px] text-good ml-auto font-semibold">+{summary.restockedUnits} Units</span>
          </div>
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className={`card p-3 border-l-4 ${
          summary.pendingRefundCount > 0 ? "border-l-warn bg-warn/[0.03]" : "border-l-line"
        }`}>
          <div className="text-[11px] font-semibold text-warn">Pending Refund Due</div>
          <div className="text-lg font-black text-warn mt-0.5">
            ₹{summary.pendingRefundAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{summary.pendingRefundCount} orders awaiting resolution</div>
        </div>

        <div className="card p-3">
          <div className="text-[11px] font-semibold text-ink">Total Refunded</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.totalRefundedAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{summary.resolvedCount} refunds settled</div>
        </div>

        <div className="card p-3 border-l-4 border-l-emerald-500">
          <div className="text-[11px] font-semibold text-emerald-600">💵 Cash Refund</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.cashRefundTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Paid at counter</div>
        </div>

        <div className="card p-3 border-l-4 border-l-purple-500">
          <div className="text-[11px] font-semibold text-purple-600">📱 UPI Refund</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.upiRefundTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Direct digital transfer</div>
        </div>

        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-600">🧾 Credit Notes Issued</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.creditNoteTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Credited to customer ledger</div>
        </div>

        <div className="card p-3 border-l-4 border-l-good bg-good/[0.03]">
          <div className="text-[11px] font-semibold text-good">📦 Units Restocked</div>
          <div className="text-base font-black text-good mt-0.5">
            {summary.restockedUnits} Items
          </div>
          <div className="text-[10px] text-muted mt-1">Returned to inventory</div>
        </div>
      </div>

      {/* Tabs & Search Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
          <button
            onClick={() => setActiveTab("pending")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "pending" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            ⏳ Pending Refund Approvals ({data.pendingAdjustments.length})
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "orders" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            📦 Eligible Orders for Return ({data.eligibleOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("resolved")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "resolved" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            ✓ Settled Refunds & Credits ({data.resolvedRefunds.length})
          </button>
          <button
            onClick={() => setActiveTab("stock")}
            className={`px-3 py-1.5 rounded transition-all ${
              activeTab === "stock" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            🔄 Restock Movements ({data.returnMovements.length})
          </button>
        </div>

        <div className="w-full sm:w-72">
          <input
            type="search"
            placeholder="Search customer, order #, bill #..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: PENDING REFUND APPROVALS */}
      {activeTab === "pending" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Pending Refund / Credit Approvals</h2>
              <p className="text-[11px] text-muted">
                Orders with customer returns or QC adjustments awaiting finance disbursement resolution
              </p>
            </div>
            <div className="text-xs font-semibold">
              Total Refund Due:{" "}
              <span className="text-bad font-black">
                ₹{filteredPending.reduce((s, p) => s + p.refundDue, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Order / Bill #</th>
                <th className="py-3 px-3">Customer Shop</th>
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3 text-right">Original Billed</th>
                <th className="py-3 px-3 text-right">Revised Total</th>
                <th className="py-3 px-3 text-right">Refund Due (₹)</th>
                <th className="py-3 px-3">QC & Return Notes</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredPending.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No pending refund approvals found. All returns are settled!
                  </td>
                </tr>
              ) : (
                filteredPending.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-ink">{p.orderNumber}</div>
                      {p.billNumber && (
                        <div className="text-[10px] text-muted font-mono">{p.billNumber}</div>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-bold text-ink">{p.customerName}</div>
                      {p.customerMobile && (
                        <div className="text-[10px] text-muted">{p.customerMobile}</div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-muted font-mono text-[11px]">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-3 text-right font-medium text-ink">
                      ₹{p.previousTotal.toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-right font-medium text-muted">
                      ₹{p.newTotal.toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-right font-black text-bad text-sm">
                      ₹{p.refundDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-3">
                      <div className="text-[11px] text-ink">{p.notes || "QC adjustment refund"}</div>
                      {p.qcDetails && (
                        <div className="text-[10px] text-muted mt-0.5">
                          QC: {p.qcDetails.inspector} ({p.qcDetails.adjustments.length} items checked)
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openResolveModal(p)}
                        className="px-3 py-1.5 text-xs font-bold rounded bg-accent text-white hover:bg-accent/90 shadow-sm"
                      >
                        💸 Resolve Refund
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 2: ELIGIBLE ORDERS FOR RETURN */}
      {activeTab === "orders" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Billed Orders Eligible for Return / Cancellation</h2>
              <p className="text-[11px] text-muted">Initiate return request and automatically restock items to inventory</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Showing {filteredOrders.length} orders
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Order Number</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-3">Order Date</th>
                <th className="py-3 px-3 text-center">Items Count</th>
                <th className="py-3 px-3 text-right">Bill Total (₹)</th>
                <th className="py-3 px-3 text-right">Amount Paid</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No orders matching search.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-bold text-ink">
                      <div>{ord.orderNumber}</div>
                      {ord.billNumber && (
                        <div className="text-[10px] text-muted font-mono">{ord.billNumber}</div>
                      )}
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-bold text-ink">{ord.customerName}</div>
                      {ord.mobile && <div className="text-[10px] text-muted">{ord.mobile}</div>}
                    </td>

                    <td className="py-3 px-3 text-muted font-mono text-[11px]">
                      {new Date(ord.createdAt).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-3 text-center font-semibold text-muted">
                      {ord.itemsCount} products
                    </td>

                    <td className="py-3 px-3 text-right font-bold text-ink">
                      ₹{ord.total.toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-right font-bold text-good">
                      ₹{ord.amountPaid.toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span className="text-[10px] bg-surface-hi px-2 py-0.5 rounded border border-line font-semibold text-ink">
                        {ord.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => openReturnModal(ord)}
                        className="px-3 py-1 text-xs font-bold rounded bg-bad/10 text-bad hover:bg-bad/20 border border-bad/30"
                      >
                        ↩️ Return Order
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: SETTLED REFUNDS & CREDIT NOTES LEDGER */}
      {activeTab === "resolved" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Settled Refunds & Credit Notes Ledger</h2>
              <p className="text-[11px] text-muted">History of payouts disbursed via Cash, UPI, and Customer Ledger Credits</p>
            </div>
            <div className="text-xs font-semibold">
              Total Settled:{" "}
              <span className="text-good font-black">
                ₹{filteredResolved.reduce((s, r) => s + r.refundAmount, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Settlement Date</th>
                <th className="py-3 px-3">Order / Bill #</th>
                <th className="py-3 px-3">Customer Shop</th>
                <th className="py-3 px-3 text-center">Resolution Mode</th>
                <th className="py-3 px-3 text-right">Refund Amount (₹)</th>
                <th className="py-3 px-4">Notes & Narration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredResolved.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    No resolved refunds found.
                  </td>
                </tr>
              ) : (
                filteredResolved.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-muted text-[11px]">
                      {new Date(r.resolvedAt).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-3 font-semibold text-ink">
                      <div>{r.orderNumber}</div>
                      {r.billNumber && (
                        <div className="text-[10px] text-muted font-mono">{r.billNumber}</div>
                      )}
                    </td>

                    <td className="py-3 px-3 font-bold text-ink">{r.customerName}</td>

                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          r.resolutionType === "CASH_REFUND"
                            ? "bg-emerald-500/15 text-emerald-700"
                            : r.resolutionType === "UPI_REFUND"
                            ? "bg-purple-500/15 text-purple-700"
                            : r.resolutionType === "CUSTOMER_CREDIT"
                            ? "bg-sky-500/15 text-sky-700"
                            : "bg-amber-500/15 text-amber-700"
                        }`}
                      >
                        {r.resolutionType.replace(/_/g, " ")}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right font-black text-bad text-sm">
                      -₹{r.refundAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-4 text-muted text-[11px]">{r.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 4: RETURN INVENTORY MOVEMENTS */}
      {activeTab === "stock" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Stock Restock & Return Movements</h2>
              <p className="text-[11px] text-muted">Audited inventory restock adjustments for returned orders</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Total Movements: <strong className="text-ink">{data.returnMovements.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-3">Product Name</th>
                <th className="py-3 px-3">SKU</th>
                <th className="py-3 px-3 text-center">Movement Type</th>
                <th className="py-3 px-3 text-right">Quantity</th>
                <th className="py-3 px-4">Inspected / Logged By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.returnMovements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
                    No return inventory movements recorded yet.
                  </td>
                </tr>
              ) : (
                data.returnMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-muted">
                      {new Date(m.timestamp).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    <td className="py-3 px-3 font-bold text-ink">{m.productName}</td>

                    <td className="py-3 px-3 font-mono text-[11px] text-muted">{m.sku}</td>

                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.movementType === "RETURN"
                            ? "bg-good/15 text-good"
                            : m.movementType === "QC_ADJUSTMENT"
                            ? "bg-amber-500/15 text-amber-700"
                            : "bg-bad/15 text-bad"
                        }`}
                      >
                        {m.movementType}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right font-black text-good">
                      +{m.quantity}
                    </td>

                    <td className="py-3 px-4 text-ink font-medium">{m.loggedBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: RESOLVE & DISBURSE REFUND */}
      {targetAdj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Resolve & Disburse Refund</h3>
                <p className="text-xs text-muted">
                  Order <strong className="text-ink">{targetAdj.orderNumber}</strong> ({targetAdj.customerName})
                </p>
              </div>
              <button onClick={() => setTargetAdj(null)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            {/* Refund Banner */}
            <div className="bg-surface-hi p-3 rounded-lg border border-line text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted block">Original Total</span>
                <span className="font-semibold text-ink">₹{targetAdj.previousTotal.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted block">Refund Due Amount</span>
                <span className="font-black text-bad text-base">₹{targetAdj.refundDue.toFixed(2)}</span>
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
                <label className="block font-semibold text-ink mb-1">Refund Resolution Mode *</label>
                <select
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value as any)}
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                >
                  <option value="CASH_REFUND">💵 Cash Refund (Physical Cash Drawer Outflow)</option>
                  <option value="UPI_REFUND">📱 UPI Refund (Digital QR / UPI Payout)</option>
                  <option value="CUSTOMER_CREDIT">🧾 Customer Credit Note (Credit to B2B Ledger)</option>
                  <option value="MANAGER_ADJUSTMENT">🛡️ Manager Adjustment (Special Waiver)</option>
                </select>
              </div>

              {resolutionType === "UPI_REFUND" && (
                <div>
                  <label className="block font-semibold text-ink mb-1">UPI Ref / RRN Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 481928374910"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-ink mb-1">Settlement Notes / Narration</label>
                <input
                  type="text"
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  placeholder="e.g. Returned 2 damaged packets, full cash refund issued"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setTargetAdj(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Processing..." : "Confirm & Disburse Refund"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: INITIATE CUSTOMER RETURN */}
      {targetOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg bg-surface border border-line p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="text-base font-bold text-ink">Initiate Customer Return</h3>
                <p className="text-xs text-muted">
                  Order <strong className="text-ink">{targetOrder.orderNumber}</strong> ({targetOrder.customerName})
                </p>
              </div>
              <button onClick={() => setTargetOrder(null)} className="text-muted hover:text-ink text-sm p-1">
                ✕
              </button>
            </div>

            <div className="bg-surface-hi p-3 rounded-lg border border-line text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted block">Order Total</span>
                <span className="font-semibold text-ink">₹{targetOrder.total.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted block">Amount Paid</span>
                <span className="font-bold text-good">₹{targetOrder.amountPaid.toFixed(2)}</span>
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

            <form onSubmit={handleInitiateReturnSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Reason for Return *</label>
                <input
                  type="text"
                  required
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="e.g. Expired batch delivered / Damaged goods / Retailer cancellation"
                  className="w-full p-2 rounded-lg border border-line bg-surface-hi"
                />
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-hi border border-line">
                <input
                  type="checkbox"
                  id="restockCheck"
                  checked={restockItems}
                  onChange={(e) => setRestockItems(e.target.checked)}
                  className="rounded border-line text-accent focus:ring-accent"
                />
                <label htmlFor="restockCheck" className="text-xs text-ink font-medium">
                  Automatically restock returned items to warehouse on-hand inventory
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setTargetOrder(null)}
                  className="px-4 py-2 rounded-lg border border-line text-xs font-semibold hover:bg-surface-hi"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-lg bg-bad text-white text-xs font-bold hover:bg-bad/90 disabled:opacity-50 shadow-md"
                >
                  {actionLoading ? "Processing..." : "Confirm Return & Queue Refund"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
