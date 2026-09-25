"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type DiscountRequest = {
  id: string;
  discountPercent: number;
  discountAmount: number;
  billAmount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  approvalNotes: string | null;
  createdAt: string;
  warehouse: { name: string; code: string };
  order: { id: string; orderNumber: string; status: string; customer: { shopName: string } | null } | null;
  requestedByUser: { name: string; staffId: string };
  approvedByUser: { name: string; staffId: string } | null;
};

export default function DiscountApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, loading, error, reload } = useApiGet<DiscountRequest[]>(`/api/billing/discounts${statusFilter ? `?status=${statusFilter}` : ""}`);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAction(id: string, newStatus: "APPROVED" | "REJECTED") {
    setActionInProgress(id);
    setActionError(null);

    const res = await fetch(`/api/billing/discounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    setActionInProgress(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setActionError(b.error || "Failed to update discount authorization");
    }

    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Discount Authorization & Approvals</h1>
          <p className="text-xs text-muted">Tiered approval controls: 0–2% Direct · 2–5% Manager Dual · 5%+ Sir/Admin Approval</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-2 text-xs">
        {[
          { label: "All Requests", value: "" },
          { label: "Pending Authorization", value: "PENDING" },
          { label: "Approved", value: "APPROVED" },
          { label: "Rejected", value: "REJECTED" },
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

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {data && data.length === 0 && (
        <div className="card text-center py-8 text-muted text-xs">
          No discount requests found matching this filter.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((req) => {
            const pct = Number(req.discountPercent);
            const isPending = req.status === "PENDING";
            return (
              <div key={req.id} className="card space-y-2">
                <div className="flex flex-wrap items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`badge text-xs font-bold ${
                      pct > 5 ? "bg-bad text-white" : pct > 2 ? "bg-warn text-white" : "bg-good text-white"
                    }`}>
                      {pct.toFixed(1)}% Discount (₹{Number(req.discountAmount).toFixed(2)})
                    </span>
                    <span className={`badge text-xs font-semibold ${
                      req.status === "PENDING" ? "bg-warn text-white" : req.status === "APPROVED" ? "bg-good text-white" : "bg-bad text-white"
                    }`}>
                      {req.status}
                    </span>
                    {req.order && (
                      <span className="text-xs font-medium text-ink">
                        Order: {req.order.orderNumber} ({req.order.customer?.shopName || "Walk-in"})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted">Bill Total: <strong>₹{Number(req.billAmount).toFixed(2)}</strong></span>
                    {isPending && (
                      <>
                        <button
                          className="btn btn-primary text-xs font-semibold"
                          disabled={actionInProgress === req.id}
                          onClick={() => handleAction(req.id, "APPROVED")}
                        >
                          ✓ Authorize
                        </button>
                        <button
                          className="btn text-xs text-bad hover:bg-bad/10"
                          disabled={actionInProgress === req.id}
                          onClick={() => handleAction(req.id, "REJECTED")}
                        >
                          ✕ Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-xs space-y-1">
                  <div><strong>Reason / Why:</strong> <span className="italic">{req.reason}</span></div>
                  <div className="flex flex-wrap gap-4 text-muted text-[11px] pt-1">
                    <span>Requested by: <strong>{req.requestedByUser.name}</strong> ({req.requestedByUser.staffId})</span>
                    <span>{fmtTime(req.createdAt)}</span>
                    {req.approvedByUser && <span>Authorized by: <strong>{req.approvedByUser.name}</strong></span>}
                    {req.approvalNotes && <span>Notes: {req.approvalNotes}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
