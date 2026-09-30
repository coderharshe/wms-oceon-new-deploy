"use client";

import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { useDebounced } from "@/lib/useDebounced";

type Unit = { id: string; symbol: string };
type Product = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  wholesalePrice: string;
  retailPrice: string;
  taxPercent: string;
  minStock: string | null;
  maxStock: string | null;
  active: boolean;
  imageKey: string | null;
  baseUnit: Unit;
  saleUnits: { unitId: string; unit: Unit; factorToBase: string; barcode: string | null; wholesalePrice: string | null; retailPrice: string | null }[];
};

export default function ManagerProductsPage() {
  const [q, setQ] = useState("");
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("q");
    if (from) setQ(from);
  }, []);

  const debouncedQ = useDebounced(q.trim());
  const { data, error, loading, reload: load } = useApiGet<Product[]>(`/api/admin/products?q=${encodeURIComponent(debouncedQ)}`);
  const list = (data ?? []).filter((p) => matchesQuery(q, p.sku, p.name, p.barcode, p.category, p.brand));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Product Catalog (Oversight View)</h1>
          <p className="text-xs text-muted">
            Catalog specifications, attached packaging units, tax rates, and active pricing.
          </p>
        </div>
        <button type="button" onClick={load} className="btn text-xs font-semibold">
          🔄 Refresh
        </button>
      </div>

      {error && <ErrorRetry message={error} onRetry={load} />}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-72 text-xs font-semibold"
          placeholder="Search SKU / product name / barcode / brand…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-muted">
          Showing {list.length} {list.length === 1 ? "product" : "products"}
        </span>
      </div>

      {loading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : (
        <div className="card p-4 border border-line shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-hi/70 text-ink border-b border-line font-bold">
              <tr>
                <th className="py-2.5 px-3 text-left">Product / SKU</th>
                <th className="py-2.5 px-3 text-left">Category &amp; Brand</th>
                <th className="py-2.5 px-3 text-left">Base Unit</th>
                <th className="py-2.5 px-3 text-left">Attached Sale Units</th>
                <th className="py-2.5 px-3 text-left">MFD / Expiry</th>
                <th className="py-2.5 px-3 text-right">Wholesale Rate</th>
                <th className="py-2.5 px-3 text-right">Retail Rate</th>
                <th className="py-2.5 px-3 text-center">GST Tax</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const isExpired = p.expiryDate && new Date(p.expiryDate).getTime() < Date.now();
                const isNearExpiry =
                  p.expiryDate && !isExpired && new Date(p.expiryDate).getTime() < Date.now() + 60 * 24 * 60 * 60 * 1000;

                return (
                  <tr key={p.id} className="border-b border-line/70 hover:bg-surface-2/60 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-ink">
                        <Highlight text={p.name} q={q} />
                      </div>
                      <div className="font-mono text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
                        <Highlight text={p.sku} q={q} />
                        {p.barcode && (
                          <span className="opacity-75">
                            · 🔲 <Highlight text={p.barcode} q={q} />
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-muted">
                      <div>{p.category ? <Highlight text={p.category} q={q} /> : "—"}</div>
                      {p.brand && (
                        <div className="text-[10px] text-ink/70">
                          Brand: <Highlight text={p.brand} q={q} />
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <span className="badge text-xs font-mono font-bold bg-surface-2 text-ink border border-line">
                        {p.baseUnit.symbol}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {p.saleUnits?.map((su) => (
                          <span
                            key={su.unitId}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-line bg-paper font-mono text-muted"
                            title={`1 ${su.unit.symbol} = ${su.factorToBase} ${p.baseUnit.symbol}`}
                          >
                            <span>{su.unit.symbol}</span>
                            <span className="opacity-70">(x{su.factorToBase})</span>
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="text-xs space-y-0.5">
                        {p.mfgDate && (
                          <div className="text-[11px] text-muted">
                            MFD: <span className="font-mono text-ink">{p.mfgDate.split("T")[0]}</span>
                          </div>
                        )}
                        {p.expiryDate ? (
                          <div className="text-[11px]">
                            {isExpired ? (
                              <span className="text-bad font-bold">EXP: {p.expiryDate.split("T")[0]} (Expired)</span>
                            ) : isNearExpiry ? (
                              <span className="text-warn font-medium">EXP: {p.expiryDate.split("T")[0]} (Near)</span>
                            ) : (
                              <span className="text-good">EXP: {p.expiryDate.split("T")[0]}</span>
                            )}
                          </div>
                        ) : (
                          !p.mfgDate && <span className="text-[11px] text-muted/60 italic">—</span>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                      ₹{Number(p.wholesalePrice).toFixed(2)}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono font-bold text-good">
                      ₹{Number(p.retailPrice).toFixed(2)}
                    </td>

                    <td className="py-2.5 px-3 text-center font-mono font-semibold text-muted">
                      {p.taxPercent}%
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`badge text-[10px] font-bold px-2 py-0.5 ${
                          p.active
                            ? "bg-good/15 text-good border border-good/30"
                            : "bg-bad/15 text-bad border border-bad/30"
                        }`}
                      >
                        {p.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted">
                    No products found matching your search.
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
