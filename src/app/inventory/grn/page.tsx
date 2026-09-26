"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type GRN = {
  id: string;
  grnNumber: string;
  supplierBillNo: string;
  billDate: string;
  total: number;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string; phone: string | null };
  warehouse: { name: string; code: string };
  receivedByUser: { name: string; staffId: string };
  purchaseOrder: { id: string; poNumber: string; total: number } | null;
  items: {
    id: string;
    product: { id: string; name: string; sku: string };
    unit: { symbol: string };
    quantity: number;
    rate: number;
    amount: number;
  }[];
};

type OpenPO = {
  id: string;
  poNumber: string;
  total: number;
  supplierId: string;
  supplier: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    product: { id: string; name: string; sku: string };
    unitId: string;
    unit: { symbol: string };
    quantity: number;
    purchaseRate: number;
    receivedQty: number;
  }[];
};

type Supplier = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  sku: string;
  taxPercent?: string | number;
  wholesalePrice?: string | number;
  baseUnit: { id: string; symbol: string; name: string };
  saleUnits?: Array<{
    unitId: string;
    unit: { id: string; symbol: string; name: string };
    factorToBase: string | number;
  }>;
};

export default function GrnInwardPage() {
  const { data: grns, loading, error, reload } = useApiGet<GRN[]>("/api/inventory/grn");
  const { data: allPOs } = useApiGet<OpenPO[]>("/api/procurement/orders");
  const openPOs = (allPOs || []).filter(
    (po) => po && (po as any).status !== "CLOSED" && (po as any).status !== "CANCELLED" && (po as any).status !== "DRAFT"
  );
  const { data: suppliers } = useApiGet<Supplier[]>("/api/suppliers");
  const { data: productsData, loading: productsLoading } = useApiGet<Product[]>("/api/admin/products");
  const products = productsData || [];

  const [showNewGrn, setShowNewGrn] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierBillNo, setSupplierBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  type GrnDraftItem = {
    productId: string;
    unitId: string;
    quantity: number;
    rate: number;
  };

  const [items, setItems] = useState<GrnDraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function addProductRow() {
    if (!products || products.length === 0) return;
    const firstP = products[0];
    if (!firstP) return;
    setItems((prev) => [
      ...prev,
      {
        productId: firstP.id,
        unitId: firstP.baseUnit?.id || firstP.saleUnits?.[0]?.unitId || "",
        quantity: 1,
        rate: Number(firstP.wholesalePrice || 0),
      },
    ]);
  }

  function updateDraftItem(index: number, patch: Partial<GrnDraftItem>) {
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== index) return it;
        const updated = { ...it, ...patch };

        // If product changed, update available units and default rate
        if (patch.productId && patch.productId !== it.productId) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            updated.unitId = p.baseUnit?.id || p.saleUnits?.[0]?.unitId || "";
            updated.rate = Number(p.wholesalePrice || 0);
          }
        }
        return updated;
      })
    );
  }

  function removeDraftItem(index: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleSelectPO(poId: string) {
    setSelectedPoId(poId);
    if (!poId || !allPOs) {
      if (items.length === 0 && products.length > 0) {
        addProductRow();
      }
      return;
    }
    const po = allPOs.find((p) => p.id === poId);
    if (po) {
      setSupplierId(po.supplierId);
      if (po.items && po.items.length > 0) {
        setItems(
          po.items.map((i) => {
            const remaining = Number(i.quantity) - Number(i.receivedQty || 0);
            return {
              productId: i.productId,
              unitId: i.unitId,
              quantity: remaining > 0 ? remaining : Number(i.quantity),
              rate: Number(i.purchaseRate || 0),
            };
          })
        );
      }
    }
  }

  const grandTotal = useMemo(() => {
    return items.reduce((acc, it) => acc + Number(it.quantity || 0) * Number(it.rate || 0), 0);
  }, [items]);

  async function handleCreateGrn(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      return setFormError("Please select a supplier");
    }
    if (!supplierBillNo.trim()) {
      return setFormError("Please enter the supplier invoice / bill number");
    }
    if (items.length === 0) {
      return setFormError("Please add at least one product item to receive");
    }
    for (const it of items) {
      if (!it.productId || it.quantity <= 0 || it.rate < 0) {
        return setFormError("All items must have valid quantity and rate");
      }
    }

    setSaving(true);
    setFormError(null);

    try {
      const res = await fetch("/api/inventory/grn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: selectedPoId || undefined,
          supplierId,
          supplierBillNo: supplierBillNo.trim(),
          billDate,
          notes: notes.trim() || undefined,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: Number(i.quantity),
            unitId: i.unitId,
            rate: Number(i.rate),
          })),
        }),
      });

      setSaving(false);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        return setFormError(b.error || "Failed to process GRN");
      }

      setShowNewGrn(false);
      setSelectedPoId("");
      setSupplierBillNo("");
      setSupplierId("");
      setNotes("");
      setItems([]);
      reload();
    } catch (err: any) {
      setSaving(false);
      setFormError(err.message || "Network error while saving GRN");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-ink">Inward / Goods Receipt Note (GRN)</h1>
          <p className="text-xs text-muted">Physical stock verification, inward inspection, and purchase bill recording</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs flex items-center gap-1.5"
            onClick={() => {
              setShowNewGrn(true);
              setFormError(null);
              if (items.length === 0 && products.length > 0) {
                addProductRow();
              }
            }}
          >
            <span>+</span> New Inward / GRN Entry
          </button>
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !grns && <ErrorRetry message={error} onRetry={reload} />}

      {showNewGrn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="card w-full max-w-3xl max-h-[92vh] overflow-y-auto space-y-4 shadow-2xl border border-line">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-sm font-bold text-ink">Receive Inward Stock (GRN)</h2>
                <p className="text-[11px] text-muted">Record inward delivery, update inventory stock, and verify supplier invoices.</p>
              </div>
              <button className="text-muted hover:text-ink text-sm p-1" onClick={() => setShowNewGrn(false)}>✕</button>
            </div>

            {formError && <div className="p-2.5 rounded bg-bad/10 text-bad border border-bad/20 text-xs font-medium">{formError}</div>}

            <form onSubmit={handleCreateGrn} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-surface-2 p-3 rounded-lg border border-line">
                <div>
                  <label className="mb-1 block font-semibold text-ink">Load from Purchase Order (Optional)</label>
                  <select
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink"
                    value={selectedPoId}
                    onChange={(e) => handleSelectPO(e.target.value)}
                  >
                    <option value="">Direct / Walk-in Receipt (No PO)</option>
                    {openPOs?.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.poNumber} — {po.supplier.name} (₹{Number(po.total).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-ink">Supplier / Distributor *</label>
                  <select
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink font-medium"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    required
                  >
                    <option value="">Select supplier…</option>
                    {suppliers?.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-ink">Supplier Invoice / Bill No. *</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-9842"
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink font-mono"
                    value={supplierBillNo}
                    onChange={(e) => setSupplierBillNo(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-ink">Supplier Bill Date *</label>
                  <input
                    type="date"
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink font-mono"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Physical Stock Verification Lines Table */}
              <div className="space-y-2 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Physical Stock Verification Lines</h3>
                    <p className="text-[11px] text-muted">Add or inspect each product being physically received into the warehouse.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addProductRow}
                    className="btn text-xs py-1 px-2.5 bg-surface-2 hover:bg-surface-hi border border-line font-semibold flex items-center gap-1"
                  >
                    <span>+</span> Add Product Row
                  </button>
                </div>

                <div className="overflow-x-auto border border-line rounded">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-surface-2 border-b border-line text-[10px] text-muted uppercase">
                        <th className="py-2 px-2.5">Product SKU / Name</th>
                        <th className="py-2 px-2.5 w-28">Unit</th>
                        <th className="py-2 px-2.5 text-right w-24">Accepted Qty</th>
                        <th className="py-2 px-2.5 text-right w-28">Purchase Rate (₹)</th>
                        <th className="py-2 px-2.5 text-right w-28">Line Total (₹)</th>
                        <th className="py-2 px-2 text-center w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-6 text-muted text-xs">
                            {productsLoading ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="animate-spin">⏳</span> Loading products catalog…
                              </span>
                            ) : products.length === 0 ? (
                              <span>No products found in catalog.</span>
                            ) : (
                              <div className="space-y-1.5">
                                <div>No products added to this inward receipt yet.</div>
                                <button
                                  type="button"
                                  onClick={addProductRow}
                                  className="text-accent underline font-semibold hover:text-accent-hi"
                                >
                                  + Add first product to receive
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        items.map((item, idx) => {
                          const currentProduct = products.find((p) => p.id === item.productId);
                          const availableUnits = currentProduct
                            ? [
                                ...(currentProduct.baseUnit ? [currentProduct.baseUnit] : []),
                                ...(currentProduct.saleUnits || []).map((su) => su.unit).filter(Boolean),
                              ]
                            : [];

                          const lineTotal = Number(item.quantity || 0) * Number(item.rate || 0);

                          return (
                            <tr key={idx} className="hover:bg-surface-2/40 transition-colors">
                              <td className="p-1.5">
                                <select
                                  value={item.productId}
                                  onChange={(e) => updateDraftItem(idx, { productId: e.target.value })}
                                  className="w-full py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs font-medium"
                                >
                                  {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({p.sku})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-1.5">
                                <select
                                  value={item.unitId}
                                  onChange={(e) => updateDraftItem(idx, { unitId: e.target.value })}
                                  className="w-full py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs"
                                >
                                  {availableUnits.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.symbol} {u.name ? `(${u.name})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-1.5">
                                <input
                                  type="number"
                                  min="0.01"
                                  step="any"
                                  value={item.quantity}
                                  onChange={(e) => updateDraftItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                                  className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono font-bold"
                                  required
                                />
                              </td>
                              <td className="p-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={item.rate}
                                  onChange={(e) => updateDraftItem(idx, { rate: parseFloat(e.target.value) || 0 })}
                                  className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono"
                                  required
                                />
                              </td>
                              <td className="p-1.5 text-right font-mono font-bold text-ink">
                                ₹{lineTotal.toFixed(2)}
                              </td>
                              <td className="p-1.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeDraftItem(idx)}
                                  className="text-bad hover:text-red-700 font-bold p-1 transition-colors"
                                  title="Remove row"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {items.length > 0 && (
                  <div className="flex justify-end pt-1">
                    <div className="text-right text-xs bg-surface-2 px-3 py-1.5 rounded border border-line font-mono">
                      <span className="text-muted mr-2">Total Inward Value:</span>
                      <span className="font-bold text-sm text-accent">₹{grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block font-semibold text-ink">Receiving Notes / Gate Remarks</label>
                <input
                  type="text"
                  placeholder="e.g. 5 boxes verified intact, gate check clear, batch stamps checked"
                  className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button type="button" className="btn text-xs py-1.5 px-3" onClick={() => setShowNewGrn(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs" disabled={saving || items.length === 0}>
                  {saving ? "Recording GRN…" : "✓ Confirm Physical Inward & Update Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {grns && grns.length > 0 && (
        <div className="space-y-3">
          {grns.map((g) => (
            <div key={g.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between border-b border-line pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-ink">{g.grnNumber}</span>
                  <span className="badge bg-good/10 text-good font-semibold text-xs">
                    Supplier Bill: {g.supplierBillNo}
                  </span>
                  <span className="text-xs text-ink font-semibold">Supplier: {g.supplier.name}</span>
                  {g.purchaseOrder && (
                    <span className="badge bg-surface-hi text-muted text-xs">
                      PO: {g.purchaseOrder.poNumber}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-ink">Total Received: ₹{Number(g.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-muted text-xs">
                <span>Received by: <strong>{g.receivedByUser.name}</strong> ({fmtTime(g.createdAt)})</span>
                <span>Bill Date: <strong>{new Date(g.billDate).toLocaleDateString()}</strong></span>
                {g.notes && <span>Remarks: <em>{g.notes}</em></span>}
              </div>

              <div className="overflow-x-auto pt-1">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-1">SKU / Item</th>
                      <th className="py-1">Quantity Received</th>
                      <th className="py-1">Purchase Rate</th>
                      <th className="py-1">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((item) => (
                      <tr key={item.id} className="border-b border-line/50">
                        <td className="py-1 font-medium">{item.product.name} ({item.product.sku})</td>
                        <td className="py-1 font-bold text-good">{Number(item.quantity)} {item.unit.symbol}</td>
                        <td className="py-1 text-muted">₹{Number(item.rate).toFixed(2)}</td>
                        <td className="py-1 font-semibold">₹{Number(item.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
