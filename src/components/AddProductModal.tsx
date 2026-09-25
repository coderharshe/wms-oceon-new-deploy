"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";

type UnitData = { id: string; symbol: string; name: string };

// A counter clerk mid-sale should not have to invent a SKU, so one is derived
// from the name and left editable. Matches the shape the catalogue import
// generates (upper case, hyphenated) so the two sources look alike in a list.
const skuFromName = (name: string) =>
  name.toUpperCase().replace(/\//g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function AddProductModal({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string;
  onClose: () => void;
  onCreated: (product: any) => void;
}) {
  // The unit list is fetched here rather than passed in: every caller that
  // wants this modal had to plumb the same list through otherwise, and the
  // one screen that couldn't (the inventory ProductPicker) simply went
  // without an "add product" button — which is the whole bug.
  const { data: unitsData } = useApiGet<UnitData[]>("/api/admin/units");
  const allUnits = unitsData ?? [];
  const [form, setForm] = useState({
    sku: skuFromName(initialName),
    name: initialName,
    baseUnitId: "",
    wholesalePrice: "",
    retailPrice: "",
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [skuTouched, setSkuTouched] = useState(false);
  // Units arrive after the first render, so the default is applied on the
  // render that receives them — a select whose value matches no option shows
  // blank, and "Base Unit is required" on a form that looks filled in.
  const baseUnitId = form.baseUnitId || allUnits[0]?.id || "";

  async function save() {
    setError(null);
    if (!form.sku.trim() || !form.name.trim() || !baseUnitId) {
      setError({ message: "SKU, Name, and Base Unit are required" });
      return;
    }
    if (!form.wholesalePrice || !form.retailPrice) {
      setError({ message: "Wholesale and Retail prices are required" });
      return;
    }

    setSaving(true);
    // Create the product and its default sale unit
    const reqBody = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      baseUnitId,
      wholesalePrice: Number(form.wholesalePrice),
      retailPrice: Number(form.retailPrice),
      taxPercent: 0,
      saleUnits: [
        {
          unitId: baseUnitId,
          factorToBase: 1,
          isBaseUnit: true,
          barcodeGenerated: false,
        },
      ],
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
      // Provide the fields the order screen expects so it can immediately bill it.
      // `null` = "stock not known yet", NOT zero: a brand-new product has no
      // Inventory row, and claiming 0 made the order screen treat it as out of
      // stock and silently refuse the very product the cashier just created —
      // the modal closed and nothing landed on the bill.
      available: null,
      matchedUnitId: null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Add New Product</h2>
        <p className="text-xs text-muted">
          This goes into the catalogue straight away so you can bill it now, and onto the manager&rsquo;s review list so the
          price you type here gets checked against the supplier bill.
        </p>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2">
            <ErrorNote error={error} />
          </div>
        )}

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <input
              autoFocus
              className="w-full"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value, ...(skuTouched ? {} : { sku: skuFromName(e.target.value) }) })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">SKU</label>
            <input
              className="w-full"
              value={form.sku}
              onChange={(e) => {
                setSkuTouched(true);
                setForm({ ...form, sku: e.target.value });
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Base Unit</label>
            <select
              className="w-full"
              value={baseUnitId}
              onChange={(e) => setForm({ ...form, baseUnitId: e.target.value })}
            >
              {allUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">Wholesale ₹</label>
              <input
                type="number"
                step="0.01"
                className="w-full"
                value={form.wholesalePrice}
                onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">Retail ₹</label>
              <input
                type="number"
                step="0.01"
                className="w-full"
                value={form.retailPrice}
                onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !baseUnitId}>
            {saving ? "Creating..." : "Create Product"}
          </button>
        </div>
      </div>
    </div>
  );
}
