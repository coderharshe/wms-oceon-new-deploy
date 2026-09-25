"use client";

import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditProductModal } from "@/components/EditProductModal";
import { BarcodeField } from "@/components/BarcodeField";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { useDebounced } from "@/lib/useDebounced";
import { BarcodeLabelSheet, type LabelSpec } from "@/components/BarcodeLabel";
import { readError } from "@/lib/read-error";

type Unit = { id: string; symbol: string; name: string };
type SaleUnit = { unitId: string; unit: Unit; factorToBase: string; isBaseUnit: boolean; barcode: string | null; wholesalePrice: string | null; retailPrice: string | null };
type Product = {
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
  imageKey: string | null;
  baseUnit: Unit;
  saleUnits: SaleUnit[];
};

const emptyForm = {
  sku: "",
  name: "",
  barcode: "",
  category: "",
  baseUnitId: "",
  baseUnitBarcode: "",
  wholesalePrice: "",
  retailPrice: "",
  taxPercent: "0",
  minStock: "",
};

// Turns a saved product's units into printable stickers — skipping units
// that have no barcode, since there's nothing to encode for those.
// Not exported: Next.js only permits `default` and its own reserved names as
// exports from a page file.
function labelsForProduct(p: Product): LabelSpec[] {
  return p.saleUnits
    .filter((su) => su.barcode)
    .map((su) => ({
      code: su.barcode!,
      productName: p.name,
      unitSymbol: su.unit.symbol,
      factorToBase: su.factorToBase,
      baseUnitSymbol: p.baseUnit.symbol,
    }));
}

export default function ProductsPage() {
  // The search has to reach the server: /api/admin/products returns 200 rows
  // and the catalogue is several times that, so filtering only what was
  // loaded made most of it unreachable. The client filter stays as a second
  // pass — it also narrows on barcode/category/brand, which the server's
  // name/sku query doesn't cover.
  const [q, setQ] = useState("");
  // Arriving from an error's "Find it" button (?q=<barcode|sku>) opens on that
  // one product instead of the whole catalogue. Read after mount rather than
  // via useSearchParams, which would force the page behind a Suspense boundary
  // for one optional flag — same reasoning as Inventory's #low.
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("q");
    if (from) setQ(from);
  }, []);
  const debouncedQ = useDebounced(q.trim());
  const { data: productsData, error: loadError, loading, reload: load } = useApiGet<Product[]>(`/api/admin/products?q=${encodeURIComponent(debouncedQ)}`);
  const list = (productsData ?? []).filter((p) => matchesQuery(q, p.sku, p.name, p.barcode, p.category, p.brand));
  const { data: unitsData } = useApiGet<Unit[]>("/api/admin/units");
  const units = unitsData ?? [];
  const [form, setForm] = useState(emptyForm);
  const [extraUnits, setExtraUnits] = useState<{ unitId: string; factorToBase: string; barcode: string; barcodeGenerated: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [printing, setPrinting] = useState<LabelSpec[] | null>(null);
  // Tracks which barcodes came from the Generate button rather than a scan,
  // so the server can tell an internal code from a manufacturer's one.
  const [baseUnitGenerated, setBaseUnitGenerated] = useState(false);

  async function create() {
    setError(null);
    if (!form.baseUnitId) return setError("Select a base unit");
    const saleUnits = [
      {
        unitId: form.baseUnitId,
        factorToBase: 1,
        isBaseUnit: true,
        barcode: form.baseUnitBarcode || undefined,
        barcodeGenerated: baseUnitGenerated,
      },
      ...extraUnits
        .filter((u) => u.unitId && u.factorToBase)
        .map((u) => ({
          unitId: u.unitId,
          factorToBase: Number(u.factorToBase),
          isBaseUnit: false,
          barcode: u.barcode || undefined,
          barcodeGenerated: u.barcodeGenerated,
        })),
    ];
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: form.sku,
        name: form.name,
        barcode: form.barcode || undefined,
        category: form.category || undefined,
        baseUnitId: form.baseUnitId,
        wholesalePrice: Number(form.wholesalePrice),
        retailPrice: Number(form.retailPrice),
        taxPercent: Number(form.taxPercent),
        minStock: form.minStock ? Number(form.minStock) : undefined,
        saleUnits,
      }),
    });
    if (!res.ok) {
      const err = await readError(res, "Could not create product");
      return setError(err.message);
    }
    // Offer the labels straight away — the codes only exist for certain once
    // the row is saved, and this is the moment someone is standing there
    // ready to stick them on the goods.
    const created: Product = await res.json();
    const labels = labelsForProduct(created);
    if (labels.length) setPrinting(labels);
    setForm(emptyForm);
    setExtraUnits([]);
    setBaseUnitGenerated(false);
    load();
  }

  async function uploadImage(productId: string, file: File) {
    setError(null);
    const body = new FormData();
    body.set("file", file);
    const res = await fetch(`/api/admin/products/${productId}/image`, { method: "POST", body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return setError(typeof err.error === "string" ? err.error : "Could not upload image");
    }
    load();
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Products</h1>
      {loadError && <ErrorRetry message={loadError} onRetry={load} />}
      <div className="card space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">SKU</label>
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Category</label>
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
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
            <label className="mb-1 block text-xs text-muted">Base unit</label>
            <select value={form.baseUnitId} onChange={(e) => setForm({ ...form, baseUnitId: e.target.value })}>
              <option value="">Select…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Base unit barcode</label>
            <BarcodeField
              value={form.baseUnitBarcode}
              onChange={(code) => {
                setForm((f) => ({ ...f, baseUnitBarcode: code }));
                setBaseUnitGenerated(false);
              }}
              onGenerated={() => setBaseUnitGenerated(true)}
            />
          </div>
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
          <div>
            <label className="mb-1 block text-xs text-muted">Min stock</label>
            <input type="number" className="w-20" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Additional sale units (optional — e.g. box = 12 × base unit)</label>
          {extraUnits.map((u, idx) => (
            <div key={idx} className="mb-1 flex flex-wrap items-center gap-2">
              <select
                value={u.unitId}
                onChange={(e) => setExtraUnits((prev) => prev.map((x, i) => (i === idx ? { ...x, unitId: e.target.value } : x)))}
              >
                <option value="">Unit…</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.symbol}
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted">= </span>
              <input
                type="number"
                className="w-24"
                placeholder="factor"
                value={u.factorToBase}
                onChange={(e) => setExtraUnits((prev) => prev.map((x, i) => (i === idx ? { ...x, factorToBase: e.target.value } : x)))}
              />
              <span className="text-sm text-muted">× base unit</span>
              <BarcodeField
                value={u.barcode}
                onChange={(code) => setExtraUnits((prev) => prev.map((x, i) => (i === idx ? { ...x, barcode: code, barcodeGenerated: false } : x)))}
                onGenerated={() => setExtraUnits((prev) => prev.map((x, i) => (i === idx ? { ...x, barcodeGenerated: true } : x)))}
              />
              <button className="text-bad" onClick={() => setExtraUnits((prev) => prev.filter((_, i) => i !== idx))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => setExtraUnits((prev) => [...prev, { unitId: "", factorToBase: "", barcode: "", barcodeGenerated: false }])}>
            + Add unit
          </button>
        </div>

        <button className="btn-primary" disabled={!form.sku || !form.name || !form.baseUnitId} onClick={create}>
          Add Product
        </button>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : (
      <div className="card">
        <input className="mb-2 w-64" placeholder="Search SKU / name / barcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        <table>
          <thead>
            <tr>
              <th>Image</th>
              <th>SKU</th>
              <th>Name</th>
              <th>Base unit</th>
              <th>Wholesale</th>
              <th>Retail</th>
              <th>Tax</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="flex items-center gap-2">
                    {p.imageKey && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${p.imageKey}`} alt="" className="h-8 w-8 rounded object-cover" />
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="w-32 text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadImage(p.id, file);
                      }}
                    />
                  </div>
                </td>
                <td><Highlight text={p.sku} q={q} /></td>
                <td><Highlight text={p.name} q={q} /></td>
                <td>
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="badge bg-surface-2 text-ink font-semibold">{p.baseUnit.symbol}</span>
                    {p.saleUnits
                      .filter((su) => !su.isBaseUnit && Number(su.factorToBase) !== 1)
                      .map((su) => (
                        <span key={su.unitId} className="badge bg-surface-hi text-muted text-[10px]" title={`1 ${su.unit.symbol} = ${Number(su.factorToBase)} ${p.baseUnit.symbol}`}>
                          {su.unit.symbol} (×{Number(su.factorToBase)})
                        </span>
                      ))}
                  </div>
                </td>
                <td>₹{Number(p.wholesalePrice).toFixed(2)}</td>
                <td>₹{Number(p.retailPrice).toFixed(2)}</td>
                <td>{p.taxPercent}%</td>
                <td>{p.active ? "Active" : "Inactive"}</td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button
                      className="btn"
                      disabled={!p.saleUnits.some((su) => su.barcode)}
                      title={p.saleUnits.some((su) => su.barcode) ? "Print barcode labels" : "No unit has a barcode yet"}
                      onClick={() => setPrinting(labelsForProduct(p))}
                    >
                      Labels
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {editing && <EditProductModal product={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {printing && <BarcodeLabelSheet labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
