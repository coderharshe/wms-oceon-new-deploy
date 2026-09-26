"use client";

import { useState } from "react";
import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useApiGet } from "@/lib/useApiGet";
import { BarcodeField } from "./BarcodeField";

type SystemUnit = { id: string; symbol: string; name: string; type?: string };

const skuFromName = (name: string) =>
  name
    .toUpperCase()
    .replace(/\//g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

const generateRandomSku = () => {
  const rand = Math.floor(1000 + Math.random() * 9000);
  const prefix = "SKU";
  return `${prefix}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${rand}`;
};

export function AddProductModal({
  initialName = "",
  onClose,
  onCreated,
}: {
  initialName?: string;
  onClose: () => void;
  onCreated: (product: any) => void;
}) {
  const { data: unitsData } = useApiGet<SystemUnit[]>("/api/admin/units");
  const allUnits = unitsData ?? [];

  const [form, setForm] = useState({
    sku: skuFromName(initialName),
    name: initialName,
    barcode: "",
    category: "",
    brand: "",
    baseUnitId: "",
    wholesalePrice: "",
    retailPrice: "",
    taxPercent: "0",
    minStock: "",
    maxStock: "",
  });

  const [skuTouched, setSkuTouched] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  // Additional Packaging / Sale Units
  const [extraUnits, setExtraUnits] = useState<
    Array<{
      unitId: string;
      factorToBase: string;
      barcode: string;
      wholesalePrice: string;
      retailPrice: string;
    }>
  >([]);

  // Default base unit to the first unit if not explicitly chosen
  const baseUnitId = form.baseUnitId || allUnits[0]?.id || "";
  const baseUnit = allUnits.find((u) => u.id === baseUnitId);
  const baseUnitSymbol = baseUnit?.symbol || "Unit";

  function addExtraUnit() {
    const availableUnit = allUnits.find(
      (u) => u.id !== baseUnitId && !extraUnits.some((eu) => eu.unitId === u.id)
    );
    if (!availableUnit) return;
    setExtraUnits((prev) => [
      ...prev,
      {
        unitId: availableUnit.id,
        factorToBase: "10",
        barcode: "",
        wholesalePrice: "",
        retailPrice: "",
      },
    ]);
  }

  function removeExtraUnit(index: number) {
    setExtraUnits((prev) => prev.filter((_, i) => i !== index));
  }

  function updateExtraUnit(index: number, field: string, value: string) {
    setExtraUnits((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError({ message: "Product Name is required" });
      return;
    }
    const finalSku = form.sku.trim() || skuFromName(form.name) || generateRandomSku();
    if (!finalSku) {
      setError({ message: "Product SKU is required" });
      return;
    }
    if (!baseUnitId) {
      setError({ message: "Base Unit of Measure is required" });
      return;
    }
    if (form.wholesalePrice === "" || isNaN(Number(form.wholesalePrice)) || Number(form.wholesalePrice) < 0) {
      setError({ message: "Please enter a valid Wholesale Price" });
      return;
    }
    if (form.retailPrice === "" || isNaN(Number(form.retailPrice)) || Number(form.retailPrice) < 0) {
      setError({ message: "Please enter a valid Retail / MRP Price" });
      return;
    }

    setSaving(true);

    const saleUnits = [
      {
        unitId: baseUnitId,
        factorToBase: 1,
        isBaseUnit: true,
        barcode: form.barcode.trim() || undefined,
        barcodeGenerated: false,
      },
      ...extraUnits
        .filter((u) => u.unitId && Number(u.factorToBase) > 0)
        .map((u) => ({
          unitId: u.unitId,
          factorToBase: Number(u.factorToBase),
          isBaseUnit: false,
          barcode: u.barcode.trim() || undefined,
          barcodeGenerated: false,
        })),
    ];

    const reqBody = {
      sku: finalSku,
      name: form.name.trim(),
      barcode: form.barcode.trim() || undefined,
      category: form.category.trim() || undefined,
      brand: form.brand.trim() || undefined,
      baseUnitId,
      wholesalePrice: Number(form.wholesalePrice),
      retailPrice: Number(form.retailPrice),
      taxPercent: Number(form.taxPercent) || 0,
      minStock: form.minStock !== "" ? Number(form.minStock) : undefined,
      maxStock: form.maxStock !== "" ? Number(form.maxStock) : undefined,
      saleUnits,
    };

    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      setSaving(false);
      setError(await readError(res, "Could not create product"));
      return;
    }

    const created = await res.json();
    setSaving(false);
    onCreated({
      ...created,
      available: null,
      matchedUnitId: null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl space-y-4 my-8 max-h-[90vh] flex flex-col shadow-2xl border-line"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📦</span>
              <h2 className="text-lg font-bold text-ink">Add New Product</h2>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Create a new master catalog SKU with unit pricing, tax rates, and stock reorder alerts.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink text-lg px-2 py-0.5 rounded hover:bg-surface-2 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="space-y-4 overflow-y-auto pr-1 flex-1">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50/80 dark:bg-red-950/30 p-3">
              <ErrorNote error={error} />
            </div>
          )}

          {/* Section 1: Identification */}
          <div className="space-y-3 bg-surface-2/40 p-3 rounded-lg border border-line">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <span>🏷️</span> Product Identification
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Product Name */}
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Product Name <span className="text-rose-500">*</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Basmati Rice Royal 5kg or Tata Salt 1kg"
                  className="input w-full font-medium"
                  value={form.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm({
                      ...form,
                      name: val,
                      ...(skuTouched ? {} : { sku: skuFromName(val) }),
                    });
                  }}
                />
              </div>

              {/* SKU */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ink">
                    SKU Code <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setSkuTouched(true);
                      setForm({ ...form, sku: generateRandomSku() });
                    }}
                    className="text-[10px] text-accent font-semibold hover:underline"
                  >
                    🎲 Auto-generate
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. RICE-BASMATI-5KG"
                  className="input w-full font-mono uppercase text-xs"
                  value={form.sku}
                  onChange={(e) => {
                    setSkuTouched(true);
                    setForm({ ...form, sku: e.target.value.toUpperCase() });
                  }}
                />
              </div>

              {/* Master Barcode */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Master Barcode / EAN
                </label>
                <BarcodeField
                  value={form.barcode}
                  onChange={(code) => setForm({ ...form, barcode: code })}
                  placeholder="Scan or generate barcode"
                  className="w-full"
                />
              </div>

              {/* Category */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Category</label>
                <input
                  type="text"
                  placeholder="e.g. Grains, Beverages, Dairy, Snacks"
                  className="input w-full text-xs"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>

              {/* Brand */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Brand / Manufacturer</label>
                <input
                  type="text"
                  placeholder="e.g. Fortune, Nestlé, Amul, ITC"
                  className="input w-full text-xs"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Unit of Measure & Pricing */}
          <div className="space-y-3 bg-surface-2/40 p-3 rounded-lg border border-line">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <span>⚖️</span> Base Unit & Pricing (Primary)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Base Unit */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Base Unit <span className="text-rose-500">*</span>
                </label>
                <select
                  className="input w-full text-xs font-semibold"
                  value={baseUnitId}
                  onChange={(e) => setForm({ ...form, baseUnitId: e.target.value })}
                >
                  {allUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted mt-0.5">Stock is counted in this unit</p>
              </div>

              {/* Wholesale Price */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Wholesale Price ₹ <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-muted font-bold">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="input w-full pl-6 text-xs font-mono font-bold"
                    value={form.wholesalePrice}
                    onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
                  />
                </div>
                <p className="text-[10px] text-muted mt-0.5">Per {baseUnitSymbol}</p>
              </div>

              {/* Retail / MRP Price */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Retail / MRP Price ₹ <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-muted font-bold">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="input w-full pl-6 text-xs font-mono font-bold"
                    value={form.retailPrice}
                    onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
                  />
                </div>
                <p className="text-[10px] text-muted mt-0.5">Per {baseUnitSymbol}</p>
              </div>

              {/* GST Tax Rate */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">GST Tax Rate (%)</label>
                <select
                  className="input w-full text-xs font-semibold"
                  value={form.taxPercent}
                  onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}
                >
                  <option value="0">0% (Tax Exempt / Nil)</option>
                  <option value="5">5% (GST)</option>
                  <option value="12">12% (GST)</option>
                  <option value="18">18% (GST Standard)</option>
                  <option value="28">28% (GST Luxury/High)</option>
                </select>
                <p className="text-[10px] text-muted mt-0.5">Applicable tax bracket</p>
              </div>
            </div>
          </div>

          {/* Section 3: Stock Thresholds */}
          <div className="space-y-3 bg-surface-2/40 p-3 rounded-lg border border-line">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <span>🔔</span> Stock Thresholds & Reorder Limits
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Min Stock / Reorder Point ({baseUnitSymbol})
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 10 (Alerts if below this)"
                  className="input w-full text-xs font-mono"
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                />
                <p className="text-[10px] text-muted mt-0.5">Flags item as Low Stock in Ledger</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Max Stock Limit ({baseUnitSymbol})
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 500 (Alerts if overstocked)"
                  className="input w-full text-xs font-mono"
                  value={form.maxStock}
                  onChange={(e) => setForm({ ...form, maxStock: e.target.value })}
                />
                <p className="text-[10px] text-muted mt-0.5">Flags excess stock holding</p>
              </div>
            </div>
          </div>

          {/* Section 4: Secondary Packaging Units (Boxes, Peti, Cartons) */}
          <div className="space-y-3 bg-surface-2/40 p-3 rounded-lg border border-line">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <span>📦</span> Multi-pack Units (Optional)
              </h3>
              <button
                type="button"
                onClick={addExtraUnit}
                className="text-xs text-accent font-semibold hover:underline flex items-center gap-1 bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded"
              >
                + Add Packaging Unit (Box, Carton)
              </button>
            </div>

            {extraUnits.length === 0 ? (
              <p className="text-xs text-muted italic">
                No extra packaging units configured. The product will be sold and inwarded primarily in{" "}
                <span className="font-semibold text-ink">{baseUnitSymbol}</span>.
              </p>
            ) : (
              <div className="space-y-2">
                {extraUnits.map((eu, idx) => (
                  <div
                    key={idx}
                    className="bg-surface p-2.5 rounded-lg border border-line grid grid-cols-1 sm:grid-cols-4 gap-2 items-center"
                  >
                    <div>
                      <label className="text-[10px] font-semibold text-muted block mb-0.5">Unit</label>
                      <select
                        className="input w-full text-xs py-1"
                        value={eu.unitId}
                        onChange={(e) => updateExtraUnit(idx, "unitId", e.target.value)}
                      >
                        {allUnits
                          .filter((u) => u.id !== baseUnitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.symbol})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-muted block mb-0.5">
                        Contains ({baseUnitSymbol})
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className="input w-full text-xs py-1 font-mono"
                        placeholder="e.g. 12"
                        value={eu.factorToBase}
                        onChange={(e) => updateExtraUnit(idx, "factorToBase", e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-muted block mb-0.5">
                        Pack Barcode
                      </label>
                      <input
                        type="text"
                        className="input w-full text-xs py-1 font-mono"
                        placeholder="Scan or type barcode"
                        value={eu.barcode}
                        onChange={(e) => updateExtraUnit(idx, "barcode", e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-1 pt-3">
                      <button
                        type="button"
                        onClick={() => removeExtraUnit(idx)}
                        className="text-rose-600 hover:text-rose-700 text-xs font-semibold px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20"
                      >
                        🗑️ Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 border-t border-line pt-3">
          <button
            type="button"
            className="btn-secondary text-xs px-4 py-2 font-medium"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary text-xs px-5 py-2 font-semibold flex items-center gap-1.5 shadow-sm"
            onClick={save}
            disabled={saving || !baseUnitId}
          >
            {saving ? (
              <>
                <span className="animate-spin text-sm">⏳</span>
                <span>Saving Product...</span>
              </>
            ) : (
              <>
                <span>💾</span>
                <span>Save & Add Product</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
