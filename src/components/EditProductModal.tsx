"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useState } from "react";
import { BarcodeField } from "./BarcodeField";
import { BarcodeLabelSheet, type LabelSpec } from "./BarcodeLabel";
import { saleUnitPatch } from "@/lib/product-units";

export type EditableProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  wholesalePrice: string;
  retailPrice: string;
  taxPercent: string;
  minStock: string | null;
  maxStock: string | null;
  active: boolean;
  baseUnit: { symbol: string };
  saleUnits: {
    unitId: string;
    unit: { symbol: string };
    factorToBase: string;
    barcode: string | null;
    // Set only when this unit's rate is NOT base price × factorToBase — a peti
    // quoted whole. Null means "derive it", the common case.
    wholesalePrice: string | null;
    retailPrice: string | null;
  }[];
};

// Shared by Admin's and Manager's Products pages — both PATCH the same
// /api/admin/products/[id] route (opened to MANAGER alongside ADMIN).
export function EditProductModal({ product, onClose, onSaved }: { product: EditableProduct; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: product.name,
    barcode: product.barcode ?? "",
    category: product.category ?? "",
    brand: product.brand ?? "",
    wholesalePrice: product.wholesalePrice,
    retailPrice: product.retailPrice,
    taxPercent: product.taxPercent,
    minStock: product.minStock ?? "",
    maxStock: product.maxStock ?? "",
    active: product.active,
  });
  // Per-unit barcodes live on ProductUnit rows, so they save through a
  // different endpoint than the product's own fields — tracked separately
  // and only PATCHed where actually changed.
  const [unitBarcodes, setUnitBarcodes] = useState<Record<string, string>>(
    Object.fromEntries(product.saleUnits.map((su) => [su.unitId, su.barcode ?? ""]))
  );
  // Same story for a unit's own rate: it overrides the product price below, so
  // without it here, editing a product priced per peti did nothing visible.
  const [unitPrices, setUnitPrices] = useState<Record<string, { wholesale: string; retail: string }>>(
    Object.fromEntries(product.saleUnits.map((su) => [su.unitId, { wholesale: su.wholesalePrice ?? "", retail: su.retailPrice ?? "" }]))
  );
  const [generatedUnits, setGeneratedUnits] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState<LabelSpec[] | null>(null);

  const labels: LabelSpec[] = product.saleUnits
    .filter((su) => unitBarcodes[su.unitId])
    .map((su) => ({
      code: unitBarcodes[su.unitId]!,
      productName: form.name || product.name,
      unitSymbol: su.unit.symbol,
      factorToBase: su.factorToBase,
      baseUnitSymbol: product.baseUnit.symbol,
    }));

  async function save() {
    setError(null);

    // Catch a code typed twice across this product's own units before
    // sending — each row is unique in the DB so Postgres wouldn't object,
    // but it's always a slip.
    const entered = product.saleUnits.map((su) => unitBarcodes[su.unitId]).filter(Boolean);
    if (new Set(entered).size !== entered.length) {
      setError({ message: "The same barcode is used on more than one unit of this product" });
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/admin/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        barcode: form.barcode || null,
        // null, not undefined — see the route's schema: undefined means
        // "leave it", so an emptied box would never clear the stored value.
        category: form.category.trim() || null,
        brand: form.brand.trim() || null,
        wholesalePrice: Number(form.wholesalePrice),
        retailPrice: Number(form.retailPrice),
        taxPercent: Number(form.taxPercent),
        minStock: form.minStock.trim() === "" ? null : Number(form.minStock),
        maxStock: form.maxStock.trim() === "" ? null : Number(form.maxStock),
        active: form.active,
      }),
    });
    if (!res.ok) {
      setSaving(false);
      setError(await readError(res, "Could not save product"));
      return;
    }

    // Sequential, not Promise.all: a duplicate-barcode 409 should stop and
    // report rather than leave a half-applied set of unit updates.
    for (const su of product.saleUnits) {
      const next = unitBarcodes[su.unitId] ?? "";
      const price = unitPrices[su.unitId] ?? { wholesale: "", retail: "" };
      const patch = saleUnitPatch(su, {
        barcode: next,
        barcodeGenerated: generatedUnits[su.unitId] ?? false,
        wholesale: price.wholesale,
        retail: price.retail,
      });
      if (Object.keys(patch).length === 0) continue;
      const unitRes = await fetch(`/api/admin/products/${product.id}/units/${su.unitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!unitRes.ok) {
        setSaving(false);
        const failed = await readError(unitRes, `Could not save the ${su.unit.symbol} unit`);
        setError({ ...failed, message: `${su.unit.symbol}: ${failed.message}` });
        onSaved(); // the product's own fields did save — reflect that
        return;
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">
          Edit {product.sku} — {product.name}
        </h2>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Name</label>
            <input className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Category</label>
            <input className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Brand</label>
            <input className="w-full" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Wholesale ₹</label>
            <input type="number" className="w-24" value={form.wholesalePrice} onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Retail ₹</label>
            <input type="number" className="w-24" value={form.retailPrice} onChange={(e) => setForm({ ...form, retailPrice: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Tax %</label>
            <input type="number" className="w-16" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Min stock</label>
            <input type="number" className="w-20" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Max stock</label>
            <input type="number" className="w-20" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })} />
          </div>
          <label className="flex items-center gap-1 self-end pb-1.5 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
        </div>

        <div className="space-y-2 border-t border-line pt-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Product barcode (manufacturer&apos;s)</label>
            <BarcodeField
              value={form.barcode}
              onChange={(code) => setForm((f) => ({ ...f, barcode: code }))}
              showGenerate={false}
              placeholder="Scan the pack"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-muted">
              Per unit — a box scans differently than a loose piece, and can be priced whole. Leave a rate blank to derive it from the
              price above × the factor.
            </p>
            <div className="space-y-2">
              {product.saleUnits.map((su) => (
                <div key={su.unitId} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-sm">
                    {su.unit.symbol}
                    <span className="text-muted"> ×{Number(su.factorToBase)}</span>
                  </span>
                  <input
                    type="number"
                    className="w-24"
                    min="0"
                    step="any"
                    placeholder="wholesale"
                    value={unitPrices[su.unitId]?.wholesale ?? ""}
                    onChange={(e) => setUnitPrices((p) => ({ ...p, [su.unitId]: { ...p[su.unitId]!, wholesale: e.target.value } }))}
                  />
                  <input
                    type="number"
                    className="w-24"
                    min="0"
                    step="any"
                    placeholder="retail"
                    value={unitPrices[su.unitId]?.retail ?? ""}
                    onChange={(e) => setUnitPrices((p) => ({ ...p, [su.unitId]: { ...p[su.unitId]!, retail: e.target.value } }))}
                  />
                  <BarcodeField
                    value={unitBarcodes[su.unitId] ?? ""}
                    onChange={(code) => {
                      setUnitBarcodes((prev) => ({ ...prev, [su.unitId]: code }));
                      setGeneratedUnits((prev) => ({ ...prev, [su.unitId]: false }));
                    }}
                    onGenerated={() => setGeneratedUnits((prev) => ({ ...prev, [su.unitId]: true }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn" disabled={labels.length === 0} onClick={() => setPrinting(labels)} title={labels.length ? "Print barcode labels" : "No unit has a barcode yet"}>
            Labels
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving || !form.name} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {printing && <BarcodeLabelSheet labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
