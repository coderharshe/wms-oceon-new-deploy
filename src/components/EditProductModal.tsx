"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useState, useEffect } from "react";
import { BarcodeField } from "./BarcodeField";
import { BarcodeLabelSheet, type LabelSpec } from "./BarcodeLabel";
import { saleUnitPatch } from "@/lib/product-units";
import { useApiGet } from "@/lib/useApiGet";

export type EditableProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  wholesalePrice: string | number;
  retailPrice: string | number;
  taxPercent: string | number;
  minStock?: string | number | null;
  maxStock?: string | number | null;
  active: boolean;
  baseUnit?: { id?: string; symbol: string; name?: string } | null;
  saleUnits?: {
    unitId: string;
    unit?: { id?: string; symbol: string; name?: string } | null;
    factorToBase: string | number;
    barcode: string | null;
    wholesalePrice?: string | number | null;
    retailPrice?: string | number | null;
  }[];
};

type SystemUnit = { id: string; name: string; symbol: string; type: string };

export function EditProductModal({
  product,
  onClose,
  onSaved,
}: {
  product: EditableProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saleUnits, setSaleUnits] = useState(product.saleUnits || []);
  const [baseUnitId, setBaseUnitId] = useState(product.baseUnit?.id || "");

  // Load available system units
  const { data: unitsData } = useApiGet<SystemUnit[]>("/api/admin/units");
  const systemUnits = unitsData || [];

  // If baseUnitId was not directly provided, match by symbol
  useEffect(() => {
    if (!baseUnitId && product.baseUnit?.symbol && systemUnits.length > 0) {
      const match = systemUnits.find((u) => u.symbol === product.baseUnit?.symbol);
      if (match) setBaseUnitId(match.id);
    }
  }, [baseUnitId, product.baseUnit?.symbol, systemUnits]);

  const baseUnitSymbol =
    systemUnits.find((u) => u.id === baseUnitId)?.symbol ||
    product.baseUnit?.symbol ||
    "Unit";

  const [form, setForm] = useState({
    name: product.name || "",
    barcode: product.barcode ?? "",
    category: product.category ?? "",
    brand: product.brand ?? "",
    wholesalePrice: String(product.wholesalePrice ?? ""),
    retailPrice: String(product.retailPrice ?? ""),
    taxPercent: String(product.taxPercent ?? "0"),
    minStock: product.minStock != null ? String(product.minStock) : "",
    maxStock: product.maxStock != null ? String(product.maxStock) : "",
    active: product.active ?? true,
  });

  const [unitBarcodes, setUnitBarcodes] = useState<Record<string, string>>(
    Object.fromEntries(saleUnits.map((su) => [su.unitId, su.barcode ?? ""]))
  );

  const [unitPrices, setUnitPrices] = useState<Record<string, { wholesale: string; retail: string }>>(
    Object.fromEntries(
      saleUnits.map((su) => [
        su.unitId,
        {
          wholesale: su.wholesalePrice != null ? String(su.wholesalePrice) : "",
          retail: su.retailPrice != null ? String(su.retailPrice) : "",
        },
      ])
    )
  );

  const [unitFactors, setUnitFactors] = useState<Record<string, string>>(
    Object.fromEntries(saleUnits.map((su) => [su.unitId, String(su.factorToBase)]))
  );

  const [generatedUnits, setGeneratedUnits] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState<LabelSpec[] | null>(null);

  // New packaging unit creation sub-form state
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [newUnitId, setNewUnitId] = useState("");
  const [newUnitFactor, setNewUnitFactor] = useState("12");
  const [newUnitBarcode, setNewUnitBarcode] = useState("");
  const [newUnitWholesale, setNewUnitWholesale] = useState("");
  const [newUnitRetail, setNewUnitRetail] = useState("");

  const labels: LabelSpec[] = saleUnits
    .filter((su) => unitBarcodes[su.unitId])
    .map((su) => ({
      code: unitBarcodes[su.unitId]!,
      productName: form.name || product.name,
      unitSymbol: su.unit?.symbol || "Unit",
      factorToBase: unitFactors[su.unitId] || String(su.factorToBase),
      baseUnitSymbol,
    }));

  async function handleAddPackagingUnit() {
    setError(null);
    if (!newUnitId) {
      setError({ message: "Please select a packaging unit from the list" });
      return;
    }
    const factorNum = parseFloat(newUnitFactor);
    if (isNaN(factorNum) || factorNum <= 0) {
      setError({ message: "Packaging unit multiplier must be a positive number" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: newUnitId,
          factorToBase: factorNum,
          wholesalePrice: newUnitWholesale.trim() ? parseFloat(newUnitWholesale) : null,
          retailPrice: newUnitRetail.trim() ? parseFloat(newUnitRetail) : null,
        }),
      });

      if (!res.ok) {
        setSaving(false);
        setError(await readError(res, "Could not add packaging unit"));
        return;
      }

      const addedUnit = await res.json();
      setSaleUnits((prev) => [...prev, addedUnit]);
      setUnitFactors((prev) => ({ ...prev, [newUnitId]: String(factorNum) }));
      if (newUnitBarcode) {
        setUnitBarcodes((prev) => ({ ...prev, [newUnitId]: newUnitBarcode }));
      }
      setIsAddingUnit(false);
      setNewUnitId("");
      setNewUnitFactor("12");
      setNewUnitBarcode("");
      setNewUnitWholesale("");
      setNewUnitRetail("");
      setSaving(false);
      onSaved();
    } catch (e: any) {
      setSaving(false);
      setError({ message: e.message || "Failed to add unit" });
    }
  }

  async function handleDetachUnit(unitId: string, unitSymbol: string) {
    if (!confirm(`Are you sure you want to remove the ${unitSymbol} packaging unit from this product?`)) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}/units/${unitId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        setSaving(false);
        setError(await readError(res, "Could not remove unit"));
        return;
      }

      setSaleUnits((prev) => prev.filter((su) => su.unitId !== unitId));
      setSaving(false);
      onSaved();
    } catch (e: any) {
      setSaving(false);
      setError({ message: e.message || "Failed to detach unit" });
    }
  }

  async function save() {
    setError(null);

    const entered = saleUnits.map((su) => unitBarcodes[su.unitId]).filter(Boolean);
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
        baseUnitId: baseUnitId || undefined,
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

    // Save each unit's barcodes, factors, and price overrides
    for (const su of saleUnits) {
      const next = unitBarcodes[su.unitId] ?? "";
      const price = unitPrices[su.unitId] ?? { wholesale: "", retail: "" };
      const factor = parseFloat(unitFactors[su.unitId] || String(su.factorToBase));

      const patch = saleUnitPatch(
        {
          barcode: su.barcode,
          wholesalePrice: su.wholesalePrice != null ? String(su.wholesalePrice) : null,
          retailPrice: su.retailPrice != null ? String(su.retailPrice) : null,
        },
        {
          barcode: next,
          barcodeGenerated: generatedUnits[su.unitId] ?? false,
          wholesale: price.wholesale,
          retail: price.retail,
        }
      );

      if (!isNaN(factor) && factor !== Number(su.factorToBase)) {
        patch.factorToBase = factor;
      }

      if (Object.keys(patch).length === 0) continue;

      const unitRes = await fetch(`/api/admin/products/${product.id}/units/${su.unitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!unitRes.ok) {
        setSaving(false);
        const symbol = su.unit?.symbol || "Unit";
        const failed = await readError(unitRes, `Could not save the ${symbol} unit`);
        setError({ ...failed, message: `${symbol}: ${failed.message}` });
        onSaved();
        return;
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3 bg-surface border border-line shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 className="text-base font-bold text-ink">
            Edit {product.sku} — {product.name}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink font-bold text-sm">
            ✕
          </button>
        </div>

        {/* Product Basic Fields */}
        <div className="space-y-2 text-xs">
          <div>
            <label className="mb-1 block font-semibold text-muted">Product Name *</label>
            <input className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-medium" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-semibold text-muted">Category</label>
              <input className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Brand / Manufacturer</label>
              <input className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
          </div>

          {/* Base Unit Selector */}
          <div className="p-2.5 rounded bg-surface-2 border border-line space-y-1">
            <label className="block font-bold text-ink">
              Base Unit of Measure (Primary Inventory Unit) *
            </label>
            <div className="flex items-center gap-2">
              <select
                value={baseUnitId}
                onChange={(e) => setBaseUnitId(e.target.value)}
                className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink font-semibold"
              >
                <option value="">Select Base Unit…</option>
                {systemUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.symbol} — {u.name} ({u.type})
                  </option>
                ))}
              </select>
              <span className="badge bg-surface text-ink font-mono font-bold px-2 py-1 border border-line">
                {baseUnitSymbol}
              </span>
            </div>
            <p className="text-[10px] text-muted">
              Inventory quantities and ledger stock counts are tracked in this unit.
            </p>
          </div>

          {/* Pricing & Tax */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block font-semibold text-muted">Wholesale ₹</label>
              <input type="number" step="any" className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-mono" value={form.wholesalePrice} onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Retail ₹</label>
              <input type="number" step="any" className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-mono" value={form.retailPrice} onChange={(e) => setForm({ ...form, retailPrice: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">GST Tax %</label>
              <input type="number" className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-mono" value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
            </div>
          </div>

          {/* Stock Thresholds & Active */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <div>
              <label className="mb-1 block font-semibold text-muted">Min stock</label>
              <input type="number" className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-mono" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-muted">Max stock</label>
              <input type="number" className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-mono" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })} />
            </div>
            <label className="flex items-center gap-1.5 self-end pb-2 text-xs font-semibold cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active Item
            </label>
          </div>

          {/* Barcode Field */}
          <div>
            <label className="mb-1 block font-semibold text-muted">Product Master Barcode</label>
            <BarcodeField
              value={form.barcode}
              onChange={(code) => setForm((f) => ({ ...f, barcode: code }))}
              showGenerate={false}
              placeholder="Scan or type barcode"
            />
          </div>
        </div>

        {/* Packaging / Sale Units Section */}
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
                📦 Additional Packaging Units
              </h3>
              <p className="text-[10px] text-muted">
                Configure packaging e.g. Box = 12 × {baseUnitSymbol}, Peti = 24 × {baseUnitSymbol}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddingUnit((v) => !v)}
              className="btn text-xs py-1 px-2.5 bg-surface-2 hover:bg-surface-hi border border-line font-semibold text-accent"
            >
              {isAddingUnit ? "Cancel" : "+ Add Packaging Unit"}
            </button>
          </div>

          {/* Add Packaging Unit Inline Form */}
          {isAddingUnit && (
            <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg space-y-2 text-xs">
              <div className="font-bold text-accent">Attach New Unit:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-muted mb-0.5">Select Packaging Unit *</label>
                  <select
                    value={newUnitId}
                    onChange={(e) => setNewUnitId(e.target.value)}
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink text-xs font-semibold"
                  >
                    <option value="">Choose Unit…</option>
                    {systemUnits
                      .filter((u) => u.id !== baseUnitId && !saleUnits.some((su) => su.unitId === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.symbol} — {u.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted mb-0.5">
                    Conversion Multiplier (1 Unit = X {baseUnitSymbol}) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 12"
                    value={newUnitFactor}
                    onChange={(e) => setNewUnitFactor(e.target.value)}
                    className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink text-xs font-mono font-bold"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleAddPackagingUnit}
                  disabled={saving || !newUnitId}
                  className="btn-primary text-xs py-1 px-3 font-semibold"
                >
                  {saving ? "Attaching…" : "Attach Unit"}
                </button>
              </div>
            </div>
          )}

          {/* Existing Sale Units List */}
          <div className="space-y-2">
            {saleUnits.length === 0 ? (
              <div className="p-2 text-center text-muted text-xs bg-surface-2 rounded border border-line">
                No additional packaging units attached yet.
              </div>
            ) : (
              saleUnits.map((su) => (
                <div key={su.unitId} className="p-2 rounded bg-surface-2 border border-line space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink flex items-center gap-1.5">
                      <span className="badge bg-surface text-ink border border-line font-bold">
                        {su.unit?.symbol || "Unit"}
                      </span>
                      <span className="text-muted">
                        = {unitFactors[su.unitId] || su.factorToBase} × {baseUnitSymbol}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDetachUnit(su.unitId, su.unit?.symbol || "Unit")}
                      className="text-bad hover:text-red-700 font-bold text-xs p-1"
                      title="Remove packaging unit"
                    >
                      ✕ Detach
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                    <div>
                      <label className="text-[10px] text-muted block mb-0.5">Multiplier (×)</label>
                      <input
                        type="number"
                        step="any"
                        value={unitFactors[su.unitId] ?? String(su.factorToBase)}
                        onChange={(e) =>
                          setUnitFactors((prev) => ({
                            ...prev,
                            [su.unitId]: e.target.value,
                          }))
                        }
                        className="w-full py-1 px-1.5 text-xs font-mono rounded border border-line bg-surface text-ink font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted block mb-0.5">Wholesale Override ₹</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="derived"
                        value={unitPrices[su.unitId]?.wholesale ?? ""}
                        onChange={(e) =>
                          setUnitPrices((p) => ({
                            ...p,
                            [su.unitId]: { ...p[su.unitId]!, wholesale: e.target.value },
                          }))
                        }
                        className="w-full py-1 px-1.5 text-xs font-mono rounded border border-line bg-surface text-ink"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted block mb-0.5">Retail Override ₹</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="derived"
                        value={unitPrices[su.unitId]?.retail ?? ""}
                        onChange={(e) =>
                          setUnitPrices((p) => ({
                            ...p,
                            [su.unitId]: { ...p[su.unitId]!, retail: e.target.value },
                          }))
                        }
                        className="w-full py-1 px-1.5 text-xs font-mono rounded border border-line bg-surface text-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-muted block mb-0.5">Unit Barcode</label>
                    <BarcodeField
                      value={unitBarcodes[su.unitId] ?? ""}
                      onChange={(code) => {
                        setUnitBarcodes((prev) => ({ ...prev, [su.unitId]: code }));
                        setGeneratedUnits((prev) => ({ ...prev, [su.unitId]: false }));
                      }}
                      onGenerated={() => setGeneratedUnits((prev) => ({ ...prev, [su.unitId]: true }))}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <ErrorNote error={error} />

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button
            type="button"
            className="btn text-xs py-1.5 px-3"
            disabled={labels.length === 0}
            onClick={() => setPrinting(labels)}
          >
            🖨️ Labels ({labels.length})
          </button>
          <button type="button" className="btn text-xs py-1.5 px-3" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs"
            disabled={saving || !form.name}
            onClick={save}
          >
            {saving ? "Saving Changes…" : "Save Product & Units"}
          </button>
        </div>
      </div>

      {printing && <BarcodeLabelSheet labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
