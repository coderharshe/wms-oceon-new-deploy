"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  customer: { shopName: string };
  bill: { billNumber: string; paymentStatus: string } | null;
  // Billing never refuses a bill: whatever was wrong with it was billed anyway
  // and written here. See POST /api/finance/orders.
  needsReview?: boolean;
  reviewNotes?: string | null;
};

// One flagged bill, with what went wrong and the button that says it's dealt
// with. Cleared rows stay on screen until the next load, greyed out, so the
// manager can see what they just did rather than watching rows vanish.
function IssueCell({ row, onCleared }: { row: OrderRow; onCleared: (id: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clear() {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/manager/orders/${row.id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needsReview: false }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(typeof body.error === "string" ? body.error : "Could not clear it");
    }
    onCleared(row.id);
  }

  return (
    <div className="max-w-lg border-l-2 border-bad pl-2">
      <div className="whitespace-pre-line text-xs text-bad">{row.reviewNotes || "Flagged while billing."}</div>
      {error && <div className="mt-1 text-xs text-bad">{error}</div>}
      <button className="btn mt-1 text-xs" disabled={saving} onClick={clear}>
        {saving ? "Clearing…" : "Mark resolved"}
      </button>
    </div>
  );
}

export default function ManagerOrdersPage() {
  const [q, setQ] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [cleared, setCleared] = useState<string[]>([]);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (since) params.set("since", new Date(since).toISOString());
  if (until) params.set("until", new Date(until).toISOString());
  const { data, error, loading, reload } = useApiGet<OrderRow[]>(`/api/finance/orders?${params}`);
  const all = data ?? [];
  const flagged = (o: OrderRow) => !!o.needsReview && !cleared.includes(o.id);
  const issueCount = all.filter(flagged).length;
  const orders = onlyIssues ? all.filter(flagged) : all;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Orders (this warehouse)</h1>
      <div className="flex flex-wrap gap-2">
        <input className="w-64" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="datetime-local" aria-label="From" value={since} onChange={(e) => setSince(e.target.value)} />
        <input type="datetime-local" aria-label="To" value={until} onChange={(e) => setUntil(e.target.value)} />
        {/* The counter never stops for a problem, so this is where the problems
            surface. Off by default — most bills have nothing wrong with them. */}
        <button className={onlyIssues ? "btn-primary" : "btn"} onClick={() => setOnlyIssues(!onlyIssues)}>
          Needs attention ({issueCount})
        </button>
      </div>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Date</th>
              <th>What needs sorting</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="align-top">
                <td>{o.orderNumber}</td>
                <td>{o.customer.shopName}</td>
                <td>{o.status}</td>
                <td>{o.bill?.paymentStatus}</td>
                <td>{fmtDateTime(o.createdAt)}</td>
                <td>{flagged(o) ? <IssueCell row={o} onCleared={(id) => setCleared((c) => [...c, id])} /> : null}</td>
                <td>
                  <Link href={`/manager/orders/${o.id}`} className="text-accent">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted">
                  {onlyIssues ? "No bills need attention." : "No orders."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
