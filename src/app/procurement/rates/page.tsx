"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";

type RateAnalytics = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  wholesalePrice: number;
  avgRate: number | null;
  minRate: number | null;
  lastPurchase: {
    rate: number;
    supplier: string;
    date: string;
  } | null;
  suppliers: {
    id: string;
    supplierName: string;
    rate: number;
    moq: number;
    creditDays: number;
    schemeText: string | null;
    deliveryDays: number;
  }[];
};

export default function RateHistoryPage() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useApiGet<RateAnalytics[]>(`/api/procurement/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Purchase Rate History & Price Trends</h1>
          <p className="text-xs text-muted">Historical rate monitoring, benchmark price tracking, and distributor quotes per SKU</p>
        </div>
        <div className="w-72">
          <input
            type="search"
            placeholder="Search SKU or product name…"
            className="w-full text-xs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading && <SkeletonTable rows={6} cols={6} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2">Product SKU</th>
                <th className="py-2">Category</th>
                <th className="py-2">Last Purchase Rate</th>
                <th className="py-2">Lowest Quote</th>
                <th className="py-2">Average Quoted</th>
                <th className="py-2">Wholesale Quoted</th>
                <th className="py-2">Active Distributors</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const hasQuotes = p.suppliers.length > 0;
                const bestQuote = p.suppliers.find((s) => s.rate === p.minRate);
                return (
                  <tr key={p.id} className="border-b border-line/50 hover:bg-surface-hi">
                    <td className="py-2 font-medium">
                      <div>{p.name}</div>
                      <div className="text-[11px] text-muted">SKU: {p.sku} ({p.baseUnit})</div>
                    </td>
                    <td className="py-2 text-muted">{p.category || "—"}</td>
                    <td className="py-2">
                      {p.lastPurchase ? (
                        <div>
                          <div className="font-bold text-ink">₹{p.lastPurchase.rate.toFixed(2)}</div>
                          <div className="text-[10px] text-muted">{p.lastPurchase.supplier}</div>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {bestQuote ? (
                        <div>
                          <div className="font-bold text-good">₹{bestQuote.rate.toFixed(2)}</div>
                          <div className="text-[10px] text-muted">{bestQuote.supplierName}</div>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-ink font-medium">
                      {p.avgRate ? `₹${p.avgRate.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 font-semibold">
                      ₹{p.wholesalePrice.toFixed(2)}
                    </td>
                    <td className="py-2">
                      {hasQuotes ? (
                        <span className="badge bg-surface-hi font-semibold text-ink">
                          {p.suppliers.length} Supplier(s)
                        </span>
                      ) : (
                        <span className="badge bg-warn/10 text-warn">No quotes</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
