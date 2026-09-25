"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type ApprovalsData = {
  purchaseOrders: {
    id: string;
    poNumber: string;
    supplier: string;
    warehouse: string;
    total: number;
    creditDays: number;
    createdAt: string;
    requestedBy: string;
    notes?: string;
    itemCount: number;
    items: { product: string; sku: string; qty: number; unit: string; rate: number; lineTotal: number }[];
  }[];
  discountApprovals: {
    id: string;
    orderNumber: string;
    customer: string;
    warehouse: string;
    discountPercent: number;
    discountAmount: number;
    billAmount: number;
    reason: string;
    createdAt: string;
    requestedBy: string;
  }[];
  stockVariances: {
    id: string;
    product: string;
    sku: string;
    warehouse: string;
    systemQty: number;
    physicalQty: number;
    varianceQty: number;
    reason: string;
    createdAt: string;
    requestedBy: string;
  }[];
  vouchers: {
    id: string;
    voucherNo: string;
    type: string;
    partyName: string;
    partyType: string;
    amount: number;
    paymentMode: string;
    referenceNo?: string;
    notes?: string;
    warehouse: string;
    createdAt: string;
    requestedBy: string;
  }[];
};

export default function AdminApprovalsPage() {
  const { data, error, loading, reload } = useApiGet<ApprovalsData>("/api/admin/approvals");
  const [activeTab, setActiveTab] = useState<"pos" | "discounts" | "variances" | "vouchers">("pos");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

  async function handleAction(type: "PO" | "DISCOUNT" | "STOCK_VARIANCE" | "VOUCHER", id: string, action: "APPROVE" | "REJECT") {
    const notes = prompt(`Optional note for ${action === "APPROVE" ? "approval" : "rejection"}:`) ?? "";
    setProcessingId(id);
    setActionMessage(null);

    try {
      const res = await fetch("/api/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, action, notes }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Action failed");
      setActionMessage(result.message || "Action completed successfully");
      reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) return <SkeletonTable rows={8} cols={6} />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const totalPending =
    data.purchaseOrders.length +
    data.discountApprovals.length +
    data.stockVariances.length +
    data.vouchers.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Central Approvals Hub (ADM-05 / ADM-07 / FIN-09)</h1>
          <p className="text-xs text-muted">
            Admin executive approval gate for high-value Purchase Orders, Discounts, Stock Variances & Vouchers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-amber-100 text-amber-900 border border-amber-300 font-semibold px-2 py-1">
            {totalPending} Total Pending Approval
          </span>
          <button onClick={reload} className="btn-secondary text-xs">
            Refresh
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-sm font-medium">
          ✅ {actionMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          onClick={() => setActiveTab("pos")}
          className={`pb-2 px-3 text-sm font-medium border-b-2 transition ${
            activeTab === "pos" ? "border-primary text-primary font-bold" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Purchase Orders ({data.purchaseOrders.length})
        </button>
        <button
          onClick={() => setActiveTab("discounts")}
          className={`pb-2 px-3 text-sm font-medium border-b-2 transition ${
            activeTab === "discounts" ? "border-primary text-primary font-bold" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Discounts &gt; 5% ({data.discountApprovals.length})
        </button>
        <button
          onClick={() => setActiveTab("variances")}
          className={`pb-2 px-3 text-sm font-medium border-b-2 transition ${
            activeTab === "variances" ? "border-primary text-primary font-bold" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Stock Count Variances ({data.stockVariances.length})
        </button>
        <button
          onClick={() => setActiveTab("vouchers")}
          className={`pb-2 px-3 text-sm font-medium border-b-2 transition ${
            activeTab === "vouchers" ? "border-primary text-primary font-bold" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Payment Vouchers ({data.vouchers.length})
        </button>
      </div>

      {/* Tab Content: Purchase Orders */}
      {activeTab === "pos" && (
        <div className="card space-y-4">
          <h2 className="text-sm font-bold text-foreground">Pending Purchase Orders (&gt; ₹50,000 / Manager Escalated)</h2>
          {data.purchaseOrders.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No purchase orders pending approval.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2">PO Number</th>
                    <th>Supplier</th>
                    <th>Warehouse</th>
                    <th>Total Value</th>
                    <th>Credit Terms</th>
                    <th>Requested By</th>
                    <th>Date</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.purchaseOrders.map((po) => (
                    <tr key={po.id} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="py-3 font-semibold text-primary">
                        <button
                          onClick={() => setExpandedPoId(expandedPoId === po.id ? null : po.id)}
                          className="hover:underline flex items-center gap-1"
                        >
                          {po.poNumber} {expandedPoId === po.id ? "▲" : "▼"}
                        </button>
                      </td>
                      <td>{po.supplier}</td>
                      <td>{po.warehouse}</td>
                      <td className="font-bold text-base">₹{po.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      <td>{po.creditDays} days</td>
                      <td className="text-xs text-muted">{po.requestedBy}</td>
                      <td className="text-xs text-muted">{new Date(po.createdAt).toLocaleDateString("en-IN")}</td>
                      <td className="text-right space-x-2">
                        <button
                          onClick={() => handleAction("PO", po.id, "APPROVE")}
                          disabled={processingId === po.id}
                          className="btn-primary py-1 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction("PO", po.id, "REJECT")}
                          disabled={processingId === po.id}
                          className="btn-secondary py-1 px-3 text-xs text-rose-600 border-rose-300 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {expandedPoId && (
                <div className="mt-4 p-4 bg-muted/20 rounded border border-border">
                  <h3 className="text-xs font-bold uppercase text-muted mb-2">PO Line Items</h3>
                  {(() => {
                    const po = data.purchaseOrders.find((p) => p.id === expandedPoId);
                    if (!po) return null;
                    return (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted">
                            <th className="py-1">Product SKU</th>
                            <th>Item Name</th>
                            <th>Quantity</th>
                            <th>Rate</th>
                            <th>Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {po.items.map((i, idx) => (
                            <tr key={idx} className="border-b border-border/30">
                              <td className="py-1 font-mono">{i.sku}</td>
                              <td>{i.product}</td>
                              <td>{i.qty} {i.unit}</td>
                              <td>₹{i.rate.toFixed(2)}</td>
                              <td className="font-semibold">₹{i.lineTotal.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Discounts */}
      {activeTab === "discounts" && (
        <div className="card space-y-4">
          <h2 className="text-sm font-bold text-foreground">Discount Approvals (&gt; 5% Threshold)</h2>
          {data.discountApprovals.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No high-value discounts pending approval.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2">Bill / Order</th>
                    <th>Customer</th>
                    <th>Warehouse</th>
                    <th>Bill Amount</th>
                    <th>Requested Discount</th>
                    <th>Discount Amount</th>
                    <th>Reason</th>
                    <th>Requested By</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.discountApprovals.map((d) => (
                    <tr key={d.id} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="py-3 font-semibold">{d.orderNumber}</td>
                      <td>{d.customer}</td>
                      <td>{d.warehouse}</td>
                      <td>₹{d.billAmount.toFixed(2)}</td>
                      <td>
                        <span className="badge bg-rose-100 text-rose-800 font-bold px-2 py-0.5">
                          {d.discountPercent}%
                        </span>
                      </td>
                      <td className="font-semibold text-rose-600">₹{d.discountAmount.toFixed(2)}</td>
                      <td className="text-xs text-muted max-w-xs truncate">{d.reason}</td>
                      <td className="text-xs text-muted">{d.requestedBy}</td>
                      <td className="text-right space-x-2">
                        <button
                          onClick={() => handleAction("DISCOUNT", d.id, "APPROVE")}
                          disabled={processingId === d.id}
                          className="btn-primary py-1 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction("DISCOUNT", d.id, "REJECT")}
                          disabled={processingId === d.id}
                          className="btn-secondary py-1 px-3 text-xs text-rose-600 border-rose-300 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Stock Variances */}
      {activeTab === "variances" && (
        <div className="card space-y-4">
          <h2 className="text-sm font-bold text-foreground">Stock Count Variances (Inventory Physical Audits)</h2>
          {data.stockVariances.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No physical stock count variances pending approval.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2">SKU & Item</th>
                    <th>Warehouse</th>
                    <th>System Qty</th>
                    <th>Physical Count</th>
                    <th>Variance</th>
                    <th>Audit Reason</th>
                    <th>Conducted By</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockVariances.map((s) => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="py-3">
                        <div className="font-semibold">{s.product}</div>
                        <div className="text-xs text-muted font-mono">{s.sku}</div>
                      </td>
                      <td>{s.warehouse}</td>
                      <td>{s.systemQty.toFixed(2)}</td>
                      <td className="font-bold">{s.physicalQty.toFixed(2)}</td>
                      <td>
                        <span
                          className={`badge font-bold px-2 py-0.5 ${
                            s.varianceQty < 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {s.varianceQty > 0 ? `+${s.varianceQty.toFixed(2)}` : s.varianceQty.toFixed(2)}
                        </span>
                      </td>
                      <td className="text-xs text-muted">{s.reason}</td>
                      <td className="text-xs text-muted">{s.requestedBy}</td>
                      <td className="text-right space-x-2">
                        <button
                          onClick={() => handleAction("STOCK_VARIANCE", s.id, "APPROVE")}
                          disabled={processingId === s.id}
                          className="btn-primary py-1 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Approve & Adjust
                        </button>
                        <button
                          onClick={() => handleAction("STOCK_VARIANCE", s.id, "REJECT")}
                          disabled={processingId === s.id}
                          className="btn-secondary py-1 px-3 text-xs text-rose-600 border-rose-300 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Payment Vouchers */}
      {activeTab === "vouchers" && (
        <div className="card space-y-4">
          <h2 className="text-sm font-bold text-foreground">High Value Payment Vouchers (&gt; ₹25,000 / Pending)</h2>
          {data.vouchers.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No vouchers pending approval.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2">Voucher No</th>
                    <th>Type</th>
                    <th>Party</th>
                    <th>Warehouse</th>
                    <th>Amount</th>
                    <th>Payment Mode</th>
                    <th>Ref No / Note</th>
                    <th>Created By</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vouchers.map((v) => (
                    <tr key={v.id} className="border-b border-border/50 hover:bg-muted/10">
                      <td className="py-3 font-semibold">{v.voucherNo}</td>
                      <td>
                        <span className="badge bg-blue-100 text-blue-800 text-xs">
                          {v.type.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <div className="font-medium">{v.partyName}</div>
                        <div className="text-xs text-muted">{v.partyType}</div>
                      </td>
                      <td>{v.warehouse}</td>
                      <td className="font-bold text-base">₹{v.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      <td>{v.paymentMode}</td>
                      <td className="text-xs text-muted">{v.referenceNo || v.notes || "—"}</td>
                      <td className="text-xs text-muted">{v.requestedBy}</td>
                      <td className="text-right space-x-2">
                        <button
                          onClick={() => handleAction("VOUCHER", v.id, "APPROVE")}
                          disabled={processingId === v.id}
                          className="btn-primary py-1 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction("VOUCHER", v.id, "REJECT")}
                          disabled={processingId === v.id}
                          className="btn-secondary py-1 px-3 text-xs text-rose-600 border-rose-300 hover:bg-rose-50"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
