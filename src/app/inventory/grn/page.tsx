"use client";

import { useState } from "react";
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
type Product = { id: string; name: string; sku: string; baseUnitId: string; baseUnit: { symbol: string }; avgCost: number | null; wholesalePrice: number };

export default function GrnInwardPage() {
  const { data: grns, loading, error, reload } = useApiGet<GRN[]>("/api/inventory/grn");
  const { data: openPOs } = useApiGet<OpenPO[]>("/api/procurement/orders?status=SENT");
  const { data: suppliers } = useApiGet<Supplier[]>("/api/suppliers");
  const { data: products } = useApiGet<Product[]>("/api/products");

  const [showNewGrn, setShowNewGrn] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierBillNo, setSupplierBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<{ productId: string; name: string; sku: string; unitId: string; unitSymbol: string; quantity: number; rate: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleSelectPO(poId: string) {
    setSelectedPoId(poId);
    if (!poId || !openPOs) return;
    const po = openPOs.find((p) => p.id === poId);
    if (po) {
      setSupplierId(po.supplierId);
      setItems(
        po.items.map((i) => {
          const remaining = Number(i.quantity) - Number(i.receivedQty);
          return {
            productId: i.productId,
            name: i.product.name,
            sku: i.product.sku,
            unitId: i.unitId,
            unitSymbol: i.unit.symbol,
            quantity: remaining > 0 ? remaining : Number(i.quantity),
            rate: Number(i.purchaseRate),
          };
        })
      );
    }
  }

  async function handleCreateGrn(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId || !supplierBillNo || items.length === 0) {
      return setFormError("Please fill supplier invoice number and add line items");
    }

    setSaving(true);
    setFormError(null);

    const res = await fetch("/api/inventory/grn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseOrderId: selectedPoId || undefined,
        supplierId,
        supplierBillNo,
        billDate,
        notes: notes || undefined,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitId: i.unitId,
          rate: i.rate,
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
    setItems([]);
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Inward / Goods Receipt Note (GRN)</h1>
          <p className="text-xs text-muted">Physical stock verification, inward inspection, and purchase bill recording</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            onClick={() => setShowNewGrn(true)}
          >
            + New Inward / GRN Entry
          </button>
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !grns && <ErrorRetry message={error} onRetry={reload} />}

      {showNewGrn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Receive Inward Stock (GRN)</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowNewGrn(false)}>✕</button>
            </div>

            {formError && <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">{formError}</div>}

            <form onSubmit={handleCreateGrn} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">Load from Purchase Order (Optional)</label>
                  <select
                    className="w-full"
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
                  <label className="mb-1 block font-semibold">Supplier / Distributor *</label>
                  <select
                    className="w-full"
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-semibold">Supplier Invoice / Bill No. *</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-9842"
                    className="w-full"
                    value={supplierBillNo}
                    onChange={(e) => setSupplierBillNo(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Supplier Bill Date *</label>
                  <input
                    type="date"
                    className="w-full"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="border-t border-line pt-2 space-y-2">
                <h3 className="font-semibold text-ink">Physical Stock Verification Lines</h3>
                {items.length === 0 ? (
                  <div className="text-muted italic py-2">Select a PO above or add products to receive.</div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-muted">
                        <th className="py-1">Product SKU</th>
                        <th className="py-1">Accepted Qty</th>
                        <th className="py-1">Purchase Rate (₹)</th>
                        <th className="py-1">Line Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx} className="border-b border-line/50">
                          <td className="py-1.5 font-medium">{item.name} ({item.sku})</td>
                          <td className="py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              className="w-24 text-xs font-bold"
                              value={item.quantity}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const updated = items.map((it, i) => i === idx ? { ...it, quantity: val } : it);
                                setItems(updated);
                              }}
                            />{" "}
                            {item.unitSymbol}
                          </td>
                          <td className="py-1.5 text-muted">
                            ₹{item.rate.toFixed(2)}
                          </td>
                          <td className="py-1.5 font-bold text-ink">
                            ₹{(item.quantity * item.rate).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <label className="mb-1 block font-semibold">Receiving Notes / Gate Remarks</label>
                <input
                  type="text"
                  placeholder="e.g. 5 boxes verified intact, gate check clear"
                  className="w-full"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setShowNewGrn(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || items.length === 0}>
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
