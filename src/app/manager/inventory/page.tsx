"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { isNegativeStock } from "@/lib/stock";

type Row = {
  productId: string;
  sku: string;
  product: string;
  onHand: string;
  reserved: string;
  available: string;
  minStock: string | null;
  level: "ok" | "near" | "low";
};

type Unit = { id: string; symbol: string };
type SaleUnit = {
  unit: Unit;
  isBaseUnit: boolean;
  isDefaultSaleUnit: boolean;
  factorToBase: string | number;
  wholesalePrice: string | number | null;
  retailPrice: string | number | null;
};
type Product = { id: string; sku: string; name: string; baseUnit: Unit; saleUnits: SaleUnit[] };

async function fetchProduct(sku: string, productId: string): Promise<Product | null> {
  const res = await fetch(`/api/admin/products?q=${encodeURIComponent(sku)}`);
  const body = await res.json().catch(() => null);
  return (Array.isArray(body) ? body.find((p: { id: string }) => p.id === productId) : null) ?? null;
}

function StockRow({ row, q }: { row: Row; q: string }) {
  const [units, setUnits] = useState<Product | null>(null);
  const [showUnits, setShowUnits] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);

  const negative = isNegativeStock(Number(row.onHand), Number(row.available));
  const onHand = Number(row.onHand);
  const reserved = Number(row.reserved);
  const available = Number(row.available);

  async function toggleUnits() {
    if (!showUnits && !units) {
      setLoadingUnits(true);
      const found = await fetchProduct(row.sku, row.productId);
      if (found) setUnits(found);
      setLoadingUnits(false);
    }
    setShowUnits((prev) => !prev);
  }

  return (
    <>
      <tr className={`border-b border-line/70 hover:bg-surface-2/60 transition-colors ${negative ? "bg-bad/5" : ""}`}>
        <td className="py-2.5 px-3 font-mono font-bold text-ink">
          <Highlight text={row.sku} q={q} />
        </td>

        <td className={`py-2.5 px-3 font-semibold ${negative ? "text-bad" : "text-ink"}`}>
          <Highlight text={row.product} q={q} />
        </td>

        <td className="py-2.5 px-3 whitespace-nowrap">
          <button
            type="button"
            className="btn text-xs py-1 px-2 font-mono flex items-center gap-1 hover:bg-surface-hi"
            onClick={toggleUnits}
            title="View attached sale packaging units and multipliers"
          >
            <span>{units ? units.saleUnits.map((su) => su.unit.symbol).join(", ") || "Base Unit" : "Units"}</span>
            <span className="text-[10px] text-muted">{showUnits ? "▲" : "▼"}</span>
          </button>
        </td>

        <td
          className={`py-2.5 px-3 font-mono font-bold text-right ${
            onHand < 0 || row.level === "low" ? "text-bad" : row.level === "near" ? "text-warn" : "text-ink"
          }`}
        >
          {onHand.toFixed(2)}
        </td>

        <td className="py-2.5 px-3 font-mono text-muted text-right">
          {reserved.toFixed(2)}
        </td>

        <td
          className={`py-2.5 px-3 font-mono font-bold text-right ${
            available < 0 ? "text-bad" : available === 0 ? "text-muted" : "text-good"
          }`}
        >
          {available.toFixed(2)}
        </td>

        <td className="py-2.5 px-3 font-mono text-muted text-right">
          {row.minStock == null ? "—" : Number(row.minStock).toFixed(2)}
        </td>

        <td className="py-2.5 px-3 text-center">
          {negative ? (
            <span className="badge text-xs font-bold bg-bad text-white">NEGATIVE</span>
          ) : row.level === "low" ? (
            <span className="badge text-xs font-bold bg-bad text-white">LOW STOCK</span>
          ) : row.level === "near" ? (
            <span className="badge text-xs font-bold bg-warn text-white">NEAR MIN</span>
          ) : (
            <span className="badge text-xs font-semibold bg-good/15 text-good border border-good/30">OK</span>
          )}
        </td>
      </tr>

      {showUnits && (
        <tr className="bg-surface-2/80 border-b border-line">
          <td colSpan={8} className="p-3 pl-8">
            {loadingUnits ? (
              <span className="text-xs text-muted">Loading unit breakdown…</span>
            ) : units && units.saleUnits.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-ink uppercase tracking-wider">
                  Attached Packaging &amp; Sale Units ({units.sku})
                </div>
                <div className="flex flex-wrap gap-2">
                  {units.saleUnits.map((su) => (
                    <div
                      key={su.unit.id}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border font-mono ${
                        su.isDefaultSaleUnit
                          ? "bg-accent/10 border-accent/40 text-accent font-bold"
                          : su.isBaseUnit
                            ? "bg-paper border-line text-ink font-semibold"
                            : "bg-surface-hi border-line text-muted"
                      }`}
                    >
                      <span className="font-bold text-ink">{su.unit.symbol}</span>
                      <span className="text-muted ml-1.5">
                        (= {su.factorToBase} {units.baseUnit?.symbol || "base"})
                      </span>
                      {su.wholesalePrice && (
                        <span className="ml-2 text-ink">Wholesale: ₹{Number(su.wholesalePrice).toFixed(2)}</span>
                      )}
                      {su.retailPrice && (
                        <span className="ml-2 text-good">Retail: ₹{Number(su.retailPrice).toFixed(2)}</span>
                      )}
                      {su.isDefaultSaleUnit && (
                        <span className="ml-1.5 text-[10px] uppercase font-bold text-accent">[Default]</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <span className="text-xs text-muted">No additional packaging units attached to this product.</span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function ManagerInventoryPage() {
  const { data, error, loading, reload } = useApiGet<{ items: Row[] }>("/api/admin/reports?type=inventory");
  const allItems = useMemo(() => data?.items ?? [], [data]);

  const [filter, setFilter] = useState<"all" | "low" | "negative">("all");
  useEffect(() => {
    if (window.location.hash === "#low") setFilter("low");
    if (window.location.hash === "#negative") setFilter("negative");
  }, []);

  const [q, setQ] = useState("");
  const items = allItems.filter(
    (i) =>
      (filter === "all" || (filter === "low" ? i.level !== "ok" : isNegativeStock(Number(i.onHand), Number(i.available)))) &&
      matchesQuery(q, i.product, i.sku)
  );

  const lowCount = allItems.filter((i) => i.level === "low").length;
  const nearCount = allItems.filter((i) => i.level === "near").length;
  const negCount = allItems.filter((i) => isNegativeStock(Number(i.onHand), Number(i.available))).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Inventory &amp; Stock Oversight</h1>
          <p className="text-xs text-muted">
            Live warehouse stock levels, reserved quantities, and threshold monitors across all product lines.
          </p>
        </div>
        <button type="button" onClick={reload} className="btn text-xs font-semibold">
          🔄 Refresh Stock
        </button>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {loading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : (
        <div className="card p-4 space-y-4 border border-line shadow-sm" id="low">
          {/* Filters and Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="w-64 text-xs font-semibold"
                placeholder="Search product name or SKU…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                type="button"
                className={`btn text-xs font-semibold ${filter === "all" ? "bg-surface-2 border-accent text-accent" : ""}`}
                onClick={() => setFilter("all")}
              >
                All Products ({allItems.length})
              </button>
              <button
                type="button"
                className={`btn text-xs font-semibold ${filter === "low" ? "bg-warn/15 border-warn text-warn" : ""}`}
                onClick={() => setFilter("low")}
              >
                Low Stock Only ({lowCount + nearCount})
              </button>
              <button
                type="button"
                className={`btn text-xs font-semibold ${filter === "negative" ? "bg-bad/15 border-bad text-bad" : negCount > 0 ? "text-bad" : ""}`}
                onClick={() => setFilter("negative")}
              >
                Negative Stock ({negCount})
              </button>
            </div>

            <div className="text-xs text-muted">
              {negCount > 0 && <span className="font-bold text-bad">{negCount} negative stock</span>}
              {negCount > 0 && lowCount > 0 && " · "}
              {lowCount > 0 && <span className="font-semibold text-bad">{lowCount} critically low</span>}
              {lowCount > 0 && nearCount > 0 && " · "}
              {nearCount > 0 && <span className="text-warn">{nearCount} near minimum</span>}
            </div>
          </div>

          {/* Stock Table */}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="bg-surface-hi/70 text-ink border-b border-line font-bold">
                <tr>
                  <th className="py-2.5 px-3 text-left">SKU</th>
                  <th className="py-2.5 px-3 text-left">Product</th>
                  <th className="py-2.5 px-3 text-left">Units Breakdown</th>
                  <th className="py-2.5 px-3 text-right">On Hand</th>
                  <th className="py-2.5 px-3 text-right">Reserved</th>
                  <th className="py-2.5 px-3 text-right">Available</th>
                  <th className="py-2.5 px-3 text-right">Safety Minimum</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <StockRow key={i.productId} row={i} q={q} />
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted">
                      {filter === "low"
                        ? "No products below minimum threshold — all inventory is fully stocked."
                        : filter === "negative"
                          ? "No products currently have negative stock."
                          : "No products found matching your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
