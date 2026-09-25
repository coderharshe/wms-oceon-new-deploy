"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";
import Link from "next/link";

type PurchaseOrder = {
  id: string;
  poNumber: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";
  subtotal: number;
  gstAmount: number;
  freightCharges: number;
  total: number;
  creditDays: number;
  expectedDelivery: string | null;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null };
  warehouse: { name: string; code: string };
  createdByUser: { name: string; staffId: string };
  approvedByUser: { name: string; staffId: string } | null;
  items: {
    id: string;
    product: { name: string; sku: string };
    unit: { symbol: string };
    quantity: number;
    purchaseRate: number;
    lineTotal: number;
    receivedQty: number;
  }[];
  purchaseBills: { id: string; grnNumber: string; total: number; createdAt: string }[];
};

export default function PurchaseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, loading, error, reload } = useApiGet<PurchaseOrder[]>(`/api/procurement/orders${statusFilter ? `?status=${statusFilter}` : ""}`);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleStatusChange(poId: string, newStatus: string) {
    setActionInProgress(poId);
    setActionError(null);

    const res = await fetch(`/api/procurement/orders/${poId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    setActionInProgress(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setActionError(b.error || "Failed to update PO status");
    }

    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Purchase Orders (PO)</h1>
          <p className="text-xs text-muted">Purchase orders lifecycle, tiered approvals, and receipt verification</p>
        </div>
        <div className="flex gap-2">
          <Link href="/procurement/orders/new" className="btn btn-primary font-semibold text-xs">
            + Create New PO
          </Link>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-2 text-xs">
        {[
          { label: "All POs", value: "" },
          { label: "Pending Approval", value: "PENDING_APPROVAL" },
          { label: "Approved", value: "APPROVED" },
          { label: "Sent to Supplier", value: "SENT" },
          { label: "Received", value: "RECEIVED" },
          { label: "Closed", value: "CLOSED" },
        ].map((tab) => (
          <button
            key={tab.value}
            className={`rounded px-3 py-1 font-medium ${statusFilter === tab.value ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">
          {actionError}
        </div>
      )}

      {loading && <SkeletonTable rows={6} cols={6} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {data && data.length === 0 && (
        <div className="card text-center py-8 text-muted text-xs">
          No purchase orders found matching this filter.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-4">
          {data.map((po) => {
            const isPendingApproval = po.status === "PENDING_APPROVAL";
            const isApproved = po.status === "APPROVED";
            const isSent = po.status === "SENT";

            return (
              <div key={po.id} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink">{po.poNumber}</span>
                    <span className={`badge text-xs font-semibold ${
                      po.status === "PENDING_APPROVAL" ? "bg-warn text-white" :
                      po.status === "APPROVED" ? "bg-good text-white" :
                      po.status === "SENT" ? "bg-accent text-white" :
                      po.status === "RECEIVED" ? "bg-good text-white" : "bg-muted text-white"
                    }`}>
                      {po.status}
                    </span>
                    <span className="text-xs font-semibold text-ink">Supplier: {po.supplier.name}</span>
                    {po.creditDays > 0 && <span className="badge bg-surface-hi text-muted text-xs">Credit: {po.creditDays}d</span>}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink">Total: ₹{Number(po.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    {isPendingApproval && (
                      <button
                        className="btn btn-primary text-xs font-semibold"
                        disabled={actionInProgress === po.id}
                        onClick={() => handleStatusChange(po.id, "APPROVED")}
                      >
                        ✓ Approve PO
                      </button>
                    )}
                    {isApproved && (
                      <button
                        className="btn text-xs font-semibold"
                        disabled={actionInProgress === po.id}
                        onClick={() => handleStatusChange(po.id, "SENT")}
                      >
                        📤 Mark as Sent
                      </button>
                    )}
                    {isSent && (
                      <span className="text-xs text-muted">Awaiting GRN receipt in Inventory</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-muted">
                  <span>Created by: <strong>{po.createdByUser.name}</strong> ({fmtTime(po.createdAt)})</span>
                  {po.approvedByUser && <span>Approved by: <strong>{po.approvedByUser.name}</strong></span>}
                  {po.expectedDelivery && <span>Expected Delivery: <strong>{new Date(po.expectedDelivery).toLocaleDateString()}</strong></span>}
                  {po.notes && <span>Notes: <em>{po.notes}</em></span>}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-muted">
                        <th className="py-1">SKU / Product</th>
                        <th className="py-1">Ordered Qty</th>
                        <th className="py-1">Rate</th>
                        <th className="py-1">Line Total</th>
                        <th className="py-1">Received Qty (GRN)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item) => (
                        <tr key={item.id} className="border-b border-line/50">
                          <td className="py-1.5 font-medium">{item.product.name} ({item.product.sku})</td>
                          <td className="py-1.5">{Number(item.quantity)} {item.unit.symbol}</td>
                          <td className="py-1.5">₹{Number(item.purchaseRate).toFixed(2)}</td>
                          <td className="py-1.5 font-bold">₹{Number(item.lineTotal).toFixed(2)}</td>
                          <td className="py-1.5">
                            <span className={Number(item.receivedQty) >= Number(item.quantity) ? "text-good font-semibold" : "text-muted"}>
                              {Number(item.receivedQty)} / {Number(item.quantity)} {item.unit.symbol}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {po.purchaseBills && po.purchaseBills.length > 0 && (
                  <div className="pt-2 border-t border-line text-xs">
                    <span className="text-muted">Linked GRN Receipts: </span>
                    {po.purchaseBills.map((pb) => (
                      <span key={pb.id} className="ml-1 badge bg-good/10 text-good font-semibold">
                        {pb.grnNumber} (₹{Number(pb.total).toFixed(2)})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
