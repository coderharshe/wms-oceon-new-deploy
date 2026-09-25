"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type ReceivablesData = {
  totalReceivables: number;
  ageing: {
    bucket0_7: number;
    bucket8_15: number;
    bucket16_30: number;
    bucket31_60: number;
    bucket60Plus: number;
  };
  receivablesList: {
    id: string;
    orderNumber: string;
    billNumber: string | null;
    customerName: string;
    ownerName: string | null;
    mobile: string | null;
    creditLimit: number | null;
    billTotal: number;
    amountPaid: number;
    balanceDue: number;
    ageDays: number;
    createdAt: string;
    warehouse: string;
  }[];
};

export default function ReceivablesPage() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useApiGet<ReceivablesData>("/api/finance/receivables");

  if (loading) return <SkeletonStats count={5} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const filtered = data.receivablesList.filter(
    (r) =>
      r.customerName.toLowerCase().includes(q.toLowerCase()) ||
      (r.mobile && r.mobile.includes(q)) ||
      (r.orderNumber && r.orderNumber.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Customer Receivables & Ageing Analysis</h1>
          <p className="text-xs text-muted">Outstanding invoices, credit limits, and collection ageing buckets</p>
        </div>
        <div className="w-72">
          <input
            type="search"
            placeholder="Search customer, mobile, order no…"
            className="w-full text-xs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="card">
          <div className="text-[11px] text-muted">0–7 Days</div>
          <div className="text-lg font-bold text-good">₹{data.ageing.bucket0_7.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">8–15 Days</div>
          <div className="text-lg font-bold text-ink">₹{data.ageing.bucket8_15.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">16–30 Days</div>
          <div className="text-lg font-bold text-warn">₹{data.ageing.bucket16_30.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">31–60 Days</div>
          <div className="text-lg font-bold text-warn">₹{data.ageing.bucket31_60.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">60+ Days Overdue</div>
          <div className="text-lg font-bold text-bad">₹{data.ageing.bucket60Plus.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex justify-between items-center pb-2 border-b border-line text-xs font-semibold">
          <span>Outstanding Invoices ({filtered.length})</span>
          <span>Total Balance Due: <strong className="text-bad">₹{data.totalReceivables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2">Order / Bill</th>
              <th className="py-2">Customer Shop</th>
              <th className="py-2">Contact</th>
              <th className="py-2">Bill Total</th>
              <th className="py-2">Paid</th>
              <th className="py-2">Balance Due</th>
              <th className="py-2">Ageing</th>
              <th className="py-2">Credit Limit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-line/50 hover:bg-surface-hi">
                <td className="py-2">
                  <div className="font-semibold text-ink">{r.orderNumber}</div>
                  {r.billNumber && <div className="text-[10px] text-muted">{r.billNumber}</div>}
                </td>
                <td className="py-2 font-medium">
                  <div>{r.customerName}</div>
                  {r.ownerName && <div className="text-[10px] text-muted">{r.ownerName}</div>}
                </td>
                <td className="py-2 text-muted">{r.mobile || "—"}</td>
                <td className="py-2 font-medium">₹{r.billTotal.toFixed(2)}</td>
                <td className="py-2 text-good">₹{r.amountPaid.toFixed(2)}</td>
                <td className="py-2 font-bold text-bad">₹{r.balanceDue.toFixed(2)}</td>
                <td className="py-2">
                  <span className={`badge text-xs font-semibold ${
                    r.ageDays > 30 ? "bg-bad text-white" : r.ageDays > 15 ? "bg-warn text-white" : "bg-surface-hi text-ink"
                  }`}>
                    {r.ageDays} Days
                  </span>
                </td>
                <td className="py-2 text-muted">
                  {r.creditLimit ? `₹${r.creditLimit.toFixed(2)}` : "No limit"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
