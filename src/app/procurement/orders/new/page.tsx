"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";

type Supplier = { id: string; name: string; phone: string | null };
type Product = {
  id: string;
  name: string;
  sku: string;
  baseUnitId: string;
  baseUnit: { id: string; name: string; symbol: string };
  wholesalePrice: number;
  avgCost: number | null;
  taxPercent: number;
  supplierRates: { supplierId: string; rate: number; moq: number; creditDays: number; schemeText: string | null }[];
};

type PoLineItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitId: string;
  unitSymbol: string;
  purchaseRate: number;
  schemeDiscount: number;
  taxPercent: number;
  lineTotal: number;
};

export default function CreatePurchaseOrderPage() {
  const router = useRouter();
  const { data: suppliers, loading: sLoading, error: sError } = useApiGet<Supplier[]>("/api/suppliers");
  const { data: products, loading: pLoading } = useApiGet<Product[]>("/api/products");

  const [supplierId, setSupplierId] = useState("");
  const [creditDays, setCreditDays] = useState("0");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [freightCharges, setFreightCharges] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [schemeDiscount, setSchemeDiscount] = useState("0");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState<PoLineItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [lineQty, setLineQty] = useState("10");
  const [lineRate, setLineRate] = useState("");
  const [lineDiscount, setLineDiscount] = useState("0");
  const [lineTax, setLineTax] = useState("0");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleProductSelect(prodId: string) {
    setSelectedProductId(prodId);
    if (!prodId || !products) return;
    const p = products.find((x) => x.id === prodId);
    if (p) {
      // Find quote for this supplier if any
      const quote = p.supplierRates?.find((r) => r.supplierId === supplierId);
      setLineRate(quote ? String(quote.rate) : p.avgCost ? String(p.avgCost) : String(p.wholesalePrice * 0.85));
      setLineTax(String(p.taxPercent || 0));
    }
  }

  function addItem() {
    if (!selectedProductId || !products || !lineRate) return;
    const p = products.find((x) => x.id === selectedProductId);
    if (!p) return;

    const qty = parseFloat(lineQty) || 1;
    const rate = parseFloat(lineRate) || 0;
    const disc = parseFloat(lineDiscount) || 0;
    const taxPct = parseFloat(lineTax) || 0;

    const lineSub = qty * rate - disc;
    const taxAmt = (lineSub * taxPct) / 100;
    const lineTotal = lineSub + taxAmt;

    const newItem: PoLineItem = {
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      quantity: qty,
      unitId: p.baseUnitId,
      unitSymbol: p.baseUnit.symbol,
      purchaseRate: rate,
      schemeDiscount: disc,
      taxPercent: taxPct,
      lineTotal,
    };

    setItems([...items, newItem]);
    setSelectedProductId("");
    setLineRate("");
    setLineQty("10");
    setLineDiscount("0");
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.purchaseRate - i.schemeDiscount), 0);
  const totalTax = items.reduce((sum, i) => sum + ((i.quantity * i.purchaseRate - i.schemeDiscount) * i.taxPercent) / 100, 0);
  const freight = parseFloat(freightCharges) || 0;
  const other = parseFloat(otherCharges) || 0;
  const globalScheme = parseFloat(schemeDiscount) || 0;
  const grandTotal = subtotal + totalTax + freight + other - globalScheme;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) return setError("Please select a supplier");
    if (items.length === 0) return setError("Please add at least one line item");

    setSaving(true);
    setError(null);

    const res = await fetch("/api/procurement/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        creditDays: parseInt(creditDays) || 0,
        expectedDelivery: expectedDelivery || undefined,
        freightCharges: freight,
        otherCharges: other,
        schemeDiscount: globalScheme,
        notes: notes || undefined,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitId: i.unitId,
          purchaseRate: i.purchaseRate,
          schemeDiscount: i.schemeDiscount,
          taxPercent: i.taxPercent,
        })),
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(b.error || "Failed to create PO");
    }

    router.push("/procurement/orders");
  }

  if (sError) return <ErrorRetry message={sError} onRetry={() => {}} />;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div>
          <h1 className="text-lg font-bold">Create Purchase Order (PO)</h1>
          <p className="text-xs text-muted">Generate formal purchase order for distributors & suppliers</p>
        </div>
      </div>

      {error && <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="card grid grid-cols-1 gap-3 sm:grid-cols-4 text-xs">
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

          <div>
            <label className="mb-1 block font-semibold">Credit Period (Days)</label>
            <input
              type="number"
              className="w-full"
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">Expected Delivery Date</label>
            <input
              type="date"
              className="w-full"
              value={expectedDelivery}
              onChange={(e) => setExpectedDelivery(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">PO Notes / Reference</label>
            <input
              type="text"
              placeholder="e.g. Special festive stock"
              className="w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </section>

        <section className="card space-y-3">
          <h2 className="text-sm font-semibold border-b border-line pb-1">Add Order Line Items</h2>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs items-end">
            <div className="sm:col-span-2">
              <label className="mb-1 block font-semibold">Product SKU</label>
              <select
                className="w-full"
                value={selectedProductId}
                onChange={(e) => handleProductSelect(e.target.value)}
              >
                <option value="">Select product…</option>
                {products?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-semibold">Quantity</label>
              <input
                type="number"
                step="0.01"
                className="w-full"
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold">Purchase Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Rate"
                className="w-full"
                value={lineRate}
                onChange={(e) => setLineRate(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold">Scheme Disc (₹)</label>
              <input
                type="number"
                step="0.01"
                className="w-full"
                value={lineDiscount}
                onChange={(e) => setLineDiscount(e.target.value)}
              />
            </div>

            <div>
              <button
                type="button"
                className="btn btn-primary w-full text-xs font-semibold"
                onClick={addItem}
                disabled={!selectedProductId || !lineRate}
              >
                + Add Line
              </button>
            </div>
          </div>

          {items.length > 0 && (
            <div className="overflow-x-auto pt-2 border-t border-line">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-1">Product</th>
                    <th className="py-1">Qty</th>
                    <th className="py-1">Rate</th>
                    <th className="py-1">Scheme Disc</th>
                    <th className="py-1">Tax (%)</th>
                    <th className="py-1">Line Total</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="border-b border-line/50">
                      <td className="py-1.5 font-medium">{item.productName} ({item.sku})</td>
                      <td className="py-1.5">{item.quantity} {item.unitSymbol}</td>
                      <td className="py-1.5">₹{item.purchaseRate.toFixed(2)}</td>
                      <td className="py-1.5 text-muted">₹{item.schemeDiscount.toFixed(2)}</td>
                      <td className="py-1.5">{item.taxPercent}%</td>
                      <td className="py-1.5 font-bold text-ink">₹{item.lineTotal.toFixed(2)}</td>
                      <td className="py-1.5 text-right">
                        <button type="button" className="text-bad hover:underline text-xs" onClick={() => removeItem(idx)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="card space-y-2 text-xs">
            <h2 className="text-sm font-semibold">Additional Charges & Schemes</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold">Freight Charges (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full"
                  value={freightCharges}
                  onChange={(e) => setFreightCharges(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold">Other Loading Charges (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full"
                  value={otherCharges}
                  onChange={(e) => setOtherCharges(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block font-semibold">Global PO Scheme / Cash Discount (₹)</label>
              <input
                type="number"
                step="0.01"
                className="w-full"
                value={schemeDiscount}
                onChange={(e) => setSchemeDiscount(e.target.value)}
              />
            </div>
          </section>

          <section className="card space-y-2 text-xs">
            <h2 className="text-sm font-semibold">Order Summary & Approval Check</h2>
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-muted">Subtotal:</span>
              <span className="font-semibold">₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-muted">GST Tax:</span>
              <span className="font-semibold">₹{totalTax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-muted">Freight & Others:</span>
              <span className="font-semibold">₹{(freight + other).toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line text-sm font-bold text-ink">
              <span>Final PO Total:</span>
              <span className="text-primary">₹{grandTotal.toFixed(2)}</span>
            </div>

            <div className="text-[11px] text-muted pt-1">
              {grandTotal > 50000 ? (
                <span className="text-bad font-semibold">⚠️ Total exceeds ₹50,000 — requires Sir/Admin approval before sent.</span>
              ) : grandTotal > 10000 ? (
                <span className="text-warn font-semibold">⚠️ Total exceeds ₹10,000 — requires Manager dual approval.</span>
              ) : (
                <span className="text-good font-semibold">✓ Direct Procurement approval applicable (under ₹10,000).</span>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn" onClick={() => router.back()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary font-semibold text-xs px-6" disabled={saving || items.length === 0}>
            {saving ? "Creating PO…" : "Create & Submit Purchase Order"}
          </button>
        </div>
      </form>
    </div>
  );
}
