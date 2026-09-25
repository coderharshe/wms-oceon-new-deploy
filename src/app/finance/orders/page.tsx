"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";
import { cacheOrderDetail, getCachedOrderDetail } from "@/lib/offline-catalog";
import { listLocalBills, subscribeSync, type LocalBill } from "@/lib/offline-bills";
import { filterSavedRows, unsyncedLocalRows, type ListRow as OrderRow } from "@/lib/offline-screens";
import { LocalBillOverlay } from "@/components/LocalBillView";

// The last list the server gave, per filter, in the bill-snapshot store — so
// with the router down the counter still sees today's bills, not an error.
type SavedList = { rows: OrderRow[]; savedAt: number };
const listKey = (params: string) => `orders-list:${params}`;

export default function OrdersListPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (since) params.set("since", new Date(since).toISOString());
  if (until) params.set("until", new Date(until).toISOString());
  const { data, error, loading, reload } = useApiGet<OrderRow[]>(`/api/finance/orders?${params}`);
  const [saved, setSaved] = useState<SavedList | null>(null);
  const [local, setLocal] = useState<LocalBill[]>([]);
  // Opened in place, not via /finance/orders/local/…: offline, that route may
  // never have been loaded in this tab and can't be reached.
  const [openLocal, setOpenLocal] = useState<string | null>(null);

  // Saved without the search text: typing would otherwise store a list per
  // keystroke. Offline, the search is applied here instead.
  const filterKey = new URLSearchParams(params);
  filterKey.delete("q");
  const savedKey = listKey(String(filterKey));
  useEffect(() => {
    if (data && !q) void cacheOrderDetail(savedKey, { rows: data, savedAt: Date.now() } satisfies SavedList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Offline: the list for these filters if it was ever loaded, else the plain list narrowed here.
  useEffect(() => {
    if (!error) return setSaved(null);
    let live = true;
    (async () => {
      const list = (await getCachedOrderDetail<SavedList>(savedKey)) ?? (await getCachedOrderDetail<SavedList>(listKey("")));
      if (live) setSaved(list && { ...list, rows: filterSavedRows(list.rows, q, status) });
    })();
    return () => {
      live = false;
    };
  }, [error, savedKey, q, status]);

  // This PC's bills follow the sync badge. When one of them reaches the
  // server it moves from the "waiting" rows into the server list, so refetch.
  const unsyncedIds = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeSync(() => {
        listLocalBills()
          .then((bills) => {
            const landed = bills.some((b) => b.state === "synced" && unsyncedIds.current.has(b.requestId));
            unsyncedIds.current = new Set(bills.filter((b) => b.state !== "synced").map((b) => b.requestId));
            setLocal(bills);
            if (landed) reload();
          })
          .catch(() => setLocal([]));
      }),
    [reload]
  );

  const showingSaved = !!error && !!saved;
  const orders = data ?? (showingSaved ? saved.rows : []);
  const waiting = unsyncedLocalRows(orders, local, q);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Orders</h1>
      {showingSaved ? (
        <div className="flex items-center justify-between rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900" role="status">
          <span>Showing saved list from {fmtDateTime(new Date(saved.savedAt))} — offline</span>
          <button type="button" className="btn text-xs" onClick={reload}>
            Try again
          </button>
        </div>
      ) : (
        error && <ErrorRetry message={error} onRetry={reload} />
      )}
      <div className="flex gap-2">
        <input
          autoFocus
          className="w-64"
          placeholder="Search order # or customer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {[
            "DRAFT",
            "BILLED",
            "PAYMENT_PENDING",
            "PAID",
            "READY_FOR_QC",
            "QC_IN_PROGRESS",
            "ADDITIONAL_PAYMENT_REQUIRED",
            "REFUND_REQUIRED",
            "READY_FOR_HANDOVER",
            "COMPLETED",
            "CANCELLED",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input type="datetime-local" aria-label="From" value={since} onChange={(e) => setSince(e.target.value)} />
        <input type="datetime-local" aria-label="To" value={until} onChange={(e) => setUntil(e.target.value)} />
        {(since || until) && (
          <button type="button" className="text-muted" onClick={() => { setSince(""); setUntil(""); }}>
            Clear dates
          </button>
        )}
      </div>
      {loading && waiting.length === 0 ? (
        <SkeletonTable rows={6} cols={7} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Bill</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((b) => (
              <tr key={b.requestId}>
                <td>{b.offlineRef}</td>
                <td>
                  <span className={`badge ${b.state === "attention" ? "bg-red-100 text-bad" : "bg-amber-100 text-amber-900"}`}>
                    {b.state === "attention" ? "Needs attention" : "Waiting to sync"}
                  </span>
                </td>
                <td>{b.display.customerName}</td>
                <td title={b.error}>{b.state === "attention" ? b.error : "On this PC"}</td>
                <td>{b.cash.length ? `Cash ₹${b.cash.reduce((s, c) => s + c.amountReceived, 0).toFixed(2)}` : ""}</td>
                <td>{fmtDateTime(b.billedAt)}</td>
                <td>
                  <button type="button" className="text-accent" onClick={() => setOpenLocal(b.requestId)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.orderNumber}</td>
                <td>{o.bill?.billNumber}</td>
                <td>{o.customer?.shopName}</td>
                <td>{o.status}</td>
                <td>{o.bill?.paymentStatus}</td>
                <td>{fmtDateTime(o.createdAt)}</td>
                <td>
                  <Link href={`/finance/orders/${o.id}`} className="text-accent">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {orders.length === 0 && waiting.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  No orders found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {openLocal && <LocalBillOverlay requestId={openLocal} onClose={() => setOpenLocal(null)} />}
    </div>
  );
}
