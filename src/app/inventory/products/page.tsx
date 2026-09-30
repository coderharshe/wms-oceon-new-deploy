"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditProductModal, type EditableProduct } from "@/components/EditProductModal";
import { AddProductModal } from "@/components/AddProductModal";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { useDebounced } from "@/lib/useDebounced";
import { BarcodeLabelSheet, type LabelSpec } from "@/components/BarcodeLabel";

type Unit = { id: string; symbol: string; name: string };
type SaleUnit = {
  unitId: string;
  unit: Unit;
  factorToBase: string;
  isBaseUnit: boolean;
  isDefaultSaleUnit?: boolean;
  barcode: string | null;
  wholesalePrice: string | null;
  retailPrice: string | null;
};

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
  saleUnits: SaleUnit[];
};

function labelsForProduct(p: Product): LabelSpec[] {
  return p.saleUnits
    .filter((su) => su.barcode)
    .map((su) => ({
      code: su.barcode!,
      productName: p.name,
      unitSymbol: su.unit?.symbol || p.baseUnit?.symbol || "Unit",
      factorToBase: su.factorToBase,
      baseUnitSymbol: p.baseUnit?.symbol || "Unit",
    }));
}

export default function InventoryProductsPage() {
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(true);

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("q");
    if (from) setQ(from);
  }, []);

  const debouncedQ = useDebounced(q.trim());
  const { data: productsData, error: loadError, loading, reload: load } = useApiGet<Product[]>(
    `/api/admin/products?q=${encodeURIComponent(debouncedQ)}`
  );

  const [editing, setEditing] = useState<Product | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [printing, setPrinting] = useState<LabelSpec[] | null>(null);

  const allProducts = productsData ?? [];
  const categories = [...new Set(allProducts.map((p) => p.category).filter(Boolean))] as string[];

  const filtered = allProducts.filter((p) => {
    if (showActiveOnly && !p.active) return false;
    if (categoryFilter && p.category !== categoryFilter) return false;
    return matchesQuery(q, p.sku, p.name, p.barcode, p.category, p.brand);
  });

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Products &amp; Packaging Units</h1>
          <p className="text-xs text-muted mt-0.5">
            Manage catalogue items, assign base units, and attach packaging sale units with conversion multipliers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/inventory/units"
            className="btn text-xs font-semibold py-1.5 px-3 hover:bg-surface-hi"
          >
            📏 Units Master (UOM)
          </Link>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="btn-primary text-xs font-bold py-1.5 px-3.5 shadow-xs"
          >
            + Add New Product
          </button>

          <button
            type="button"
            onClick={load}
            className="btn text-xs font-semibold py-1.5 px-2.5"
            title="Refresh catalogue"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {loadError && <ErrorRetry message={loadError} onRetry={load} />}

      {/* Filter & Search Bar */}
      <div className="card p-3 space-y-2.5 border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
            <input
              type="text"
              className="flex-1 text-xs py-1.5 px-3 rounded border border-line"
              placeholder="Search by Product Name, SKU, Barcode, Category, Brand…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />

            <select
              className="text-xs py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-medium"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories ({categories.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-muted hover:text-ink">
              <input
                type="checkbox"
                checked={showActiveOnly}
                onChange={(e) => setShowActiveOnly(e.target.checked)}
                className="rounded text-accent"
              />
              Active Items Only
            </label>

            <span className="text-muted font-mono font-semibold">
              Showing <strong>{filtered.length}</strong> of {allProducts.length} items
            </span>
          </div>
        </div>
      </div>

      {/* Products Table */}
      {loading && allProducts.length === 0 ? (
        <SkeletonTable rows={10} cols={7} />
      ) : (
        <div className="card p-0 overflow-x-auto border border-line">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-muted uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 font-semibold">SKU / Code</th>
                <th className="py-2.5 px-3 font-semibold">Product Name</th>
                <th className="py-2.5 px-3 font-semibold">Category / Brand</th>
                <th className="py-2.5 px-3 font-semibold">Base Unit</th>
                <th className="py-2.5 px-3 font-semibold">Attached Units &amp; Factors</th>
                <th className="py-2.5 px-3 text-right font-semibold">Wholesale (₹)</th>
                <th className="py-2.5 px-3 text-right font-semibold">Retail (₹)</th>
                <th className="py-2.5 px-3 text-center font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted">
                    No products found matching your search. Click <strong>+ Add New Product</strong> to create one.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const productLabels = labelsForProduct(p);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-line/70 hover:bg-surface-2/60 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-ink">
                        <Highlight text={p.sku} q={q} />
                        {p.barcode && (
                          <div className="text-[10px] text-muted font-mono font-normal">
                            🔲 <Highlight text={p.barcode} q={q} />
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-semibold text-ink">
                        <Highlight text={p.name} q={q} />
                        {!p.active && (
                          <span className="ml-1.5 badge text-[10px] bg-bad/15 text-bad border border-bad/30">
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-muted">
                        <div>
                          {p.category ? <Highlight text={p.category} q={q} /> : "—"}
                        </div>
                        {p.brand && (
                          <div className="text-[10px] text-ink/70">
                            Brand: <Highlight text={p.brand} q={q} />
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="badge text-xs font-mono font-bold bg-surface-2 text-ink border border-line">
                          {p.baseUnit?.symbol || "—"}
                        </span>
                        <div className="text-[10px] text-muted">{p.baseUnit?.name}</div>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1 max-w-sm">
                          {p.saleUnits?.map((su) => {
                            const isBase = su.isBaseUnit || Number(su.factorToBase) === 1;
                            const isDef = su.isDefaultSaleUnit;
                            return (
                              <span
                                key={su.unitId}
                                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-mono ${
                                  isDef
                                    ? "bg-accent/10 border-accent/40 text-accent font-bold"
                                    : isBase
                                      ? "bg-surface-2 border-line text-ink font-semibold"
                                      : "bg-paper border-line text-muted font-medium"
                                }`}
                                title={`1 ${su.unit?.symbol || "unit"} = ${su.factorToBase} ${p.baseUnit?.symbol || ""}${
                                  su.wholesalePrice ? ` · Whole: ₹${su.wholesalePrice}` : ""
                                }${su.retailPrice ? ` · Ret: ₹${su.retailPrice}` : ""}`}
                              >
                                <span>{su.unit?.symbol || "Unit"}</span>
                                {!isBase && (
                                  <span className="text-[10px] text-muted">
                                    (x{Number(su.factorToBase)})
                                  </span>
                                )}
                                {su.barcode && (
                                  <span className="text-[9px] opacity-70" title={`Barcode: ${su.barcode}`}>
                                    🔲
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                        ₹{Number(p.wholesalePrice).toFixed(2)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-good">
                        ₹{Number(p.retailPrice).toFixed(2)}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(p)}
                            className="btn text-xs font-semibold py-1 px-2.5 text-accent hover:bg-accent/10 border-accent/30"
                            title="Edit product details, base unit, and attached packaging units"
                          >
                            ✏️ Edit &amp; Units
                          </button>

                          {productLabels.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setPrinting(productLabels)}
                              className="btn text-xs font-semibold py-1 px-2 hover:bg-surface-hi"
                              title="Print barcode labels for attached units"
                            >
                              🏷️ Labels
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Product & Units Modal */}
      {editing && (
        <EditProductModal
          product={editing as unknown as EditableProduct}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {/* Add New Product Modal */}
      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            load();
          }}
        />
      )}

      {/* Barcode Labels Print Preview Modal */}
      {printing && (
        <BarcodeLabelSheet labels={printing} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}
