"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type PayablesData = {
  totalPayables: number;
  ageing: {
    currentDue: number;
    overdue0_15: number;
    overdue16_30: number;
    overdue30Plus: number;
  };
  payablesList: {
    id: string;
    grnNumber: string;
    supplierBillNo: string;
    supplierName: string;
    contactPerson: string | null;
    phone: string | null;
    billDate: string;
    dueDate: string;
    amount: number;
    paymentStatus: string;
    overdueDays: number;
    poNumber: string | null;
    warehouse: string;
  }[];
};

export default function PayablesPage() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useApiGet<PayablesData>("/api/finance/payables");

  if (loading) return <SkeletonStats count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const filtered = data.payablesList.filter(
    (p) =>
      p.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      p.supplierBillNo.toLowerCase().includes(q.toLowerCase()) ||
      p.grnNumber.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Supplier Payables & Dues Tracker</h1>
          <p className="text-xs text-muted">Upcoming supplier invoices, overdue payments, and credit period tracking</p>
        </div>
        <div className="w-72">
          <input
            type="search"
            placeholder="Search supplier, bill no, GRN…"
            className="w-full text-xs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="card">
          <div className="text-[11px] text-muted">Current / Not Yet Due</div>
          <div className="text-lg font-bold text-good">₹{data.ageing.currentDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">Overdue (0–15 Days)</div>
          <div className="text-lg font-bold text-warn">₹{data.ageing.overdue0_15.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">Overdue (16–30 Days)</div>
          <div className="text-lg font-bold text-bad">₹{data.ageing.overdue16_30.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="card">
          <div className="text-[11px] text-muted">Overdue (30+ Days)</div>
          <div className="text-lg font-bold text-bad">₹{data.ageing.overdue30Plus.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="flex justify-between items-center pb-2 border-b border-line text-xs font-semibold">
          <span>Supplier Bills Payable ({filtered.length})</span>
          <span>Total Outstanding: <strong className="text-bad">₹{data.totalPayables.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2">Supplier</th>
              <th className="py-2">Supplier Bill No.</th>
              <th className="py-2">GRN Number</th>
              <th className="py-2">Bill Date</th>
              <th className="py-2">Payment Due Date</th>
              <th className="py-2">Amount Payable</th>
              <th className="py-2">Due Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isOverdue = p.overdueDays > 0;
              return (
                <tr key={p.id} className="border-b border-line/50 hover:bg-surface-hi">
                  <td className="py-2 font-medium">
                    <div>{p.supplierName}</div>
                    {p.phone && <div className="text-[10px] text-muted">{p.phone}</div>}
                  </td>
                  <td className="py-2 font-semibold text-ink">{p.supplierBillNo}</td>
                  <td className="py-2 text-muted">{p.grnNumber}</td>
                  <td className="py-2 text-muted">{new Date(p.billDate).toLocaleDateString()}</td>
                  <td className="py-2 font-medium">{new Date(p.dueDate).toLocaleDateString()}</td>
                  <td className="py-2 font-bold text-ink">₹{p.amount.toFixed(2)}</td>
                  <td className="py-2">
                    <span className={`badge text-xs font-semibold ${
                      isOverdue ? "bg-bad text-white" : "bg-good text-white"
                    }`}>
                      {isOverdue ? `${p.overdueDays}d Overdue` : "On Schedule"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
