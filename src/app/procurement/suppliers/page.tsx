"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";

type ProductComparison = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  wholesalePrice: number;
  retailPrice: number;
  minRate: number | null;
  avgRate: number | null;
  lastPurchase: {
    rate: number;
    supplier: string;
    date: string;
  } | null;
  suppliers: {
    id: string;
    supplierId: string;
    supplierName: string;
    phone: string;
    rate: number;
    moq: number;
    creditDays: number;
    schemeText: string | null;
    deliveryDays: number;
    estimatedLandedCost: number;
  }[];
};

type Supplier = { id: string; name: string };

export default function SupplierComparisonPage() {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useApiGet<ProductComparison[]>(`/api/procurement/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const { data: suppliersList } = useApiGet<Supplier[]>("/api/suppliers");

  const [selectedProduct, setSelectedProduct] = useState<ProductComparison | null>(null);
  const [showAddQuote, setShowAddQuote] = useState(false);
  const [quoteForm, setQuoteForm] = useState({
    supplierId: "",
    rate: "",
    moq: "1",
    creditDays: "0",
    schemeText: "",
    deliveryDays: "1",
  });
  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  async function handleAddQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProduct || !quoteForm.supplierId || !quoteForm.rate) return;
    setSavingQuote(true);
    setQuoteError(null);

    const res = await fetch("/api/procurement/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: selectedProduct.id,
        supplierId: quoteForm.supplierId,
        rate: parseFloat(quoteForm.rate),
        moq: parseFloat(quoteForm.moq) || 1,
        creditDays: parseInt(quoteForm.creditDays) || 0,
        schemeText: quoteForm.schemeText || undefined,
        deliveryDays: parseInt(quoteForm.deliveryDays) || 1,
      }),
    });

    setSavingQuote(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setQuoteError(b.error || "Failed to save quote");
    }

    setShowAddQuote(false);
    setQuoteForm({ supplierId: "", rate: "", moq: "1", creditDays: "0", schemeText: "", deliveryDays: "1" });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Supplier Comparison & Selection Matrix</h1>
          <p className="text-xs text-muted">Compare distributor rates, MOQ, credit terms, and calculated landed costs per SKU</p>
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
        <div className="space-y-4">
          {data.map((p) => {
            const hasQuotes = p.suppliers.length > 0;
            return (
              <div key={p.id} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between border-b border-line pb-2">
                  <div>
                    <span className="font-bold text-sm">{p.name}</span>
                    <span className="ml-2 badge bg-surface-hi text-muted text-xs">SKU: {p.sku}</span>
                    {p.category && <span className="ml-1 badge bg-surface-hi text-muted text-xs">{p.category}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div>Wholesale: <strong className="text-ink">₹{p.wholesalePrice.toFixed(2)}</strong></div>
                    <div>Retail: <strong className="text-ink">₹{p.retailPrice.toFixed(2)}</strong></div>
                    {p.lastPurchase && (
                      <div className="badge bg-surface-hi text-ink">
                        Last Purchase: ₹{p.lastPurchase.rate.toFixed(2)} ({p.lastPurchase.supplier})
                      </div>
                    )}
                    <button
                      className="btn text-xs font-semibold"
                      onClick={() => {
                        setSelectedProduct(p);
                        setShowAddQuote(true);
                      }}
                    >
                      + Add Supplier Quote
                    </button>
                  </div>
                </div>

                {!hasQuotes ? (
                  <div className="py-2 text-xs text-muted">No supplier quotes logged yet. Click "+ Add Supplier Quote" to record distributor terms.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-muted">
                          <th className="py-1">Supplier</th>
                          <th className="py-1">Quoted Rate</th>
                          <th className="py-1">MOQ</th>
                          <th className="py-1">Credit Terms</th>
                          <th className="py-1">Scheme / Discount</th>
                          <th className="py-1">Delivery</th>
                          <th className="py-1">Landed Cost Est.</th>
                          <th className="py-1">Margin vs Wholesale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.suppliers.map((s, idx) => {
                          const isLowest = s.rate === p.minRate;
                          const margin = p.wholesalePrice > 0 ? ((p.wholesalePrice - s.rate) / p.wholesalePrice) * 100 : 0;
                          return (
                            <tr key={s.id || idx} className={`border-b border-line/50 ${isLowest ? "bg-good/5 font-semibold" : ""}`}>
                              <td className="py-1.5">
                                {s.supplierName}
                                {isLowest && <span className="ml-1.5 badge bg-good text-white text-[10px]">BEST RATE</span>}
                              </td>
                              <td className="py-1.5 font-bold text-ink">₹{s.rate.toFixed(2)} / {p.baseUnit}</td>
                              <td className="py-1.5">{s.moq} {p.baseUnit}</td>
                              <td className="py-1.5">{s.creditDays > 0 ? `${s.creditDays} Days` : "Immediate Cash"}</td>
                              <td className="py-1.5 text-muted">{s.schemeText || "—"}</td>
                              <td className="py-1.5">{s.deliveryDays} Day(s)</td>
                              <td className="py-1.5 font-semibold text-ink">₹{s.estimatedLandedCost.toFixed(2)}</td>
                              <td className="py-1.5">
                                <span className={`badge text-white ${margin >= 10 ? "bg-good" : margin > 0 ? "bg-warn" : "bg-bad"}`}>
                                  {margin.toFixed(1)}%
                                </span>
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
          })}
        </div>
      )}

      {showAddQuote && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Add Supplier Quote: {selectedProduct.name}</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowAddQuote(false)}>✕</button>
            </div>

            {quoteError && <div className="text-bad text-xs">{quoteError}</div>}

            <form onSubmit={handleAddQuote} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold">Supplier / Distributor</label>
                <select
                  className="w-full"
                  value={quoteForm.supplierId}
                  onChange={(e) => setQuoteForm({ ...quoteForm, supplierId: e.target.value })}
                  required
                >
                  <option value="">Select a supplier…</option>
                  {suppliersList?.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Quoted Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 28.50"
                    className="w-full"
                    value={quoteForm.rate}
                    onChange={(e) => setQuoteForm({ ...quoteForm, rate: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">MOQ ({selectedProduct.baseUnit})</label>
                  <input
                    type="number"
                    step="1"
                    className="w-full"
                    value={quoteForm.moq}
                    onChange={(e) => setQuoteForm({ ...quoteForm, moq: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Credit Terms (Days)</label>
                  <input
                    type="number"
                    placeholder="0 for cash"
                    className="w-full"
                    value={quoteForm.creditDays}
                    onChange={(e) => setQuoteForm({ ...quoteForm, creditDays: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Delivery Timeline (Days)</label>
                  <input
                    type="number"
                    placeholder="e.g. 1"
                    className="w-full"
                    value={quoteForm.deliveryDays}
                    onChange={(e) => setQuoteForm({ ...quoteForm, deliveryDays: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold">Scheme / Promotional Terms</label>
                <input
                  type="text"
                  placeholder="e.g. Buy 10 get 1 free, or 2% cash discount"
                  className="w-full"
                  value={quoteForm.schemeText}
                  onChange={(e) => setQuoteForm({ ...quoteForm, schemeText: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setShowAddQuote(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={savingQuote}>
                  {savingQuote ? "Saving…" : "Save Quote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
