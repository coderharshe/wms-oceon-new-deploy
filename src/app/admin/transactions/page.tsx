"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";

type Transaction = {
  id: string;
  type: string;
  method: string;
  amount: string;
  amountReceived: string | null;
  changeGiven: string | null;
  upiReference: string | null;
  status: string;
  timestamp: string;
  clickedAt: string | null;
  recordedBy: { name: string; staffId: string } | null;
  billNumber: string | null;
  orderNumber: string | null;
  customerName: string | null;
};

// Raw per-transaction cash/UPI ledger (not the aggregate Reports view) —
// includes both the server-recorded time and the client-reported moment
// staff clicked the collect/refund button, so a disputed transaction can be
// checked against store CCTV footage for that exact time.
export default function TransactionsPage() {
  const [method, setMethod] = useState("");
  const [type, setType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const params = new URLSearchParams();
  if (method) params.set("method", method);
  if (type) params.set("type", type);
  if (since) params.set("since", new Date(since).toISOString());
  if (until) params.set("until", new Date(until).toISOString());

  const { data, error, reload, loading } = useApiGet<Transaction[]>(`/api/admin/transactions?${params}`);
  const rows = data ?? [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Transactions</h1>
      {error && <ErrorRetry message={error} onRetry={reload} />}

      <div className="card flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value="PAYMENT">Payment (in)</option>
            <option value="REFUND">Refund (out)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">From</label>
          <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">To</label>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Recorded (server)</th>
              <th>Clicked (staff)</th>
              <th>Type</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Order</th>
              <th>Customer</th>
              <th>By</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, r) => (
                <tr key={r}>
                  {Array.from({ length: 9 }).map((_, c) => (
                    <td key={c}>
                      <Skeleton className="h-3 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.timestamp)}</td>
                  <td className={t.clickedAt ? "" : "text-muted"}>{t.clickedAt ? fmtDateTime(t.clickedAt) : "—"}</td>
                  <td className={t.type === "REFUND" ? "text-bad" : "text-good"}>{t.type}</td>
                  <td>{t.method}</td>
                  <td>₹{Number(t.amount).toFixed(2)}</td>
                  <td>{t.orderNumber ?? "—"}</td>
                  <td>{t.customerName ?? "—"}</td>
                  <td>{t.recordedBy ? `${t.recordedBy.name} (${t.recordedBy.staffId})` : "—"}</td>
                  <td>{t.status}</td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted">
                  No transactions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
