"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { SkeletonTable } from "@/components/Skeleton";
import ReceiveStock from "@/components/ReceiveStock";
import { ProductPicker } from "@/components/ProductPicker";
import { EditProductModal, type EditableProduct } from "@/components/EditProductModal";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { isNegativeStock } from "@/lib/stock";

type Row = { productId: string; sku: string; product: string; onHand: string; reserved: string; available: string; minStock: string | null; level: "ok" | "near" | "low" };
type Unit = { id: string; symbol: string };
type SaleUnit = {
  unit: Unit;
  isBaseUnit: boolean;
  isDefaultSaleUnit: boolean;
  // Decimals come back over JSON as strings from both Prisma and Drizzle.
  factorToBase: string | number;
  wholesalePrice: string | number | null;
  retailPrice: string | number | null;
};
type Product = { id: string; sku: string; name: string; baseUnit: Unit; saleUnits: SaleUnit[] };
type FullUnit = { id: string; name: string; symbol: string; type: string };

const emptyUnitForm = { name: "", symbol: "", type: "COUNT" };

// One unit, editable in place. A rename lands on every past bill and label
// too, since documents reference units by id — a symbol is a display name, so
// correcting a typo is meant to correct it everywhere.
function UnitRow({ unit, reloadUnits }: { unit: FullUnit; reloadUnits: () => void }) {
  const [form, setForm] = useState({ name: unit.name, symbol: unit.symbol, type: unit.type });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const dirty = form.name !== unit.name || form.symbol !== unit.symbol || form.type !== unit.type;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/units/${unit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not save the unit"));
    }
    reloadUnits();
  }

  async function remove() {
    if (!confirm(`Delete the unit "${unit.symbol}"? This only works if nothing uses it.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/units/${unit.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not delete the unit"));
    }
    reloadUnits();
  }

  return (
    <tr>
      <td>
        <input className="w-20" aria-label={`Symbol for ${unit.name}`} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
      </td>
      <td>
        <input className="w-36" aria-label={`Name for ${unit.name}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </td>
      <td>
        <select aria-label={`Type for ${unit.name}`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="WEIGHT">Weight</option>
          <option value="VOLUME">Volume</option>
          <option value="COUNT">Count</option>
          <option value="CUSTOM">Custom</option>
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <button className="btn text-xs" disabled={busy || !dirty || !form.name.trim() || !form.symbol.trim()} onClick={save}>
            Save
          </button>
          <button className="btn text-xs text-bad" disabled={busy} onClick={remove}>
            Delete
          </button>
          <ErrorNote error={error} />
        </div>
      </td>
    </tr>
  );
}

// New packaging/measure unit (e.g. "box of 24") — a product still needs its
// own sale-unit entry added separately (below, "Attach unit to product")
// before this shows up as a receivable unit; this just adds it to the
// shared unit list.
function AddUnitForm({ units, reloadUnits }: { units: FullUnit[]; reloadUnits: () => void }) {
  const [form, setForm] = useState(emptyUnitForm);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/admin/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not add unit"));
    }
    setForm(emptyUnitForm);
    reloadUnits();
  }

  return (
    <div className="card space-y-2">
      <h2 className="text-sm font-semibold">Units</h2>
      {units.length === 0 ? (
        <p className="text-xs text-muted">No units yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <UnitRow key={u.id} unit={u} reloadUnits={reloadUnits} />
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Name</label>
          <input className="w-32" placeholder="box of 24" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Symbol</label>
          <input className="w-20" placeholder="box24" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="WEIGHT">Weight</option>
            <option value="VOLUME">Volume</option>
            <option value="COUNT">Count</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </div>
        <button className="btn-primary" disabled={saving || !form.name || !form.symbol} onClick={submit}>
          {saving ? "Adding…" : "Add unit"}
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

// A blank price means "derive this unit's rate from the base price ×
// factorToBase" (resolveUnitPrice), so blank must send null, not 0.
const priceOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

// The one product behind a row, with its units attached. Both screens that
// need it (the Stock table, built from the inventory report's bare figures,
// and the attach form) hold a SKU and an id but no units, so both look it up
// the same way — the admin route, which is uncached and lists inactive
// products too, unlike /api/products.
async function fetchProduct(sku: string, productId: string): Promise<Product | null> {
  const res = await fetch(`/api/admin/products?q=${encodeURIComponent(sku)}`);
  const body = await res.json().catch(() => null);
  return (Array.isArray(body) ? body.find((p: { id: string }) => p.id === productId) : null) ?? null;
}

// Every sale unit of one product: its size, its own rates, which one a bill
// opens on, and the way off the product.
function SaleUnitTable({ product, reload }: { product: Product; reload: () => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Unit</th>
          <th>= base units</th>
          <th>Wholesale</th>
          <th>Retail</th>
          <th>Default</th>
          <th>Base</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {product.saleUnits.map((su) => (
          <SaleUnitRow key={su.unit.id} productId={product.id} su={su} reloadProducts={reload} />
        ))}
        {product.saleUnits.length === 0 && (
          <tr>
            <td colSpan={7} className="text-muted">
              No units attached yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// One attached sale unit, editable in place. Inputs are seeded once from the
// row and left alone afterwards — a reload right after a save carries back
// exactly what was typed, so re-seeding would only fight the typist.
function SaleUnitRow({ productId, su, reloadProducts }: { productId: string; su: SaleUnit; reloadProducts: () => void }) {
  const [factor, setFactor] = useState(String(su.factorToBase));
  const [wholesale, setWholesale] = useState(su.wholesalePrice == null ? "" : String(su.wholesalePrice));
  const [retail, setRetail] = useState(su.retailPrice == null ? "" : String(su.retailPrice));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/products/${productId}/units/${su.unit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not save unit"));
    }
    reloadProducts();
  }

  // Rescales every quantity, level and price on the product — see
  // planBaseUnitChange. Confirmed first because it rewrites stock figures.
  async function makeBase() {
    const factor = Number(su.factorToBase);
    const warning =
      factor === 1
        ? `Count ${su.unit.symbol} instead of the current base unit? Both are the same size, so no quantity changes.`
        : `Count this product's stock in ${su.unit.symbol} instead? Every quantity on hand is divided by ${factor} and the prices multiplied by it.`;
    if (!confirm(warning)) return;
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/products/${productId}/base-unit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: su.unit.id }),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not change the base unit"));
    }
    reloadProducts();
  }

  async function detach() {
    const base = su.isBaseUnit
      ? ` The stock stays counted in ${su.unit.symbol} — you just won't be able to bill, sell or receive in it until you attach it again.`
      : "";
    if (!confirm(`Remove "${su.unit.symbol}" from this product?${base} The unit itself stays available for other products.`)) return;
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/products/${productId}/units/${su.unit.id}`, { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not remove unit"));
    }
    reloadProducts();
  }

  return (
    <tr>
      <td>{su.unit.symbol}</td>
      <td>
        {su.isBaseUnit ? (
          <span className="text-muted">1 (base)</span>
        ) : (
          <input type="number" className="w-20" min="0" step="any" value={factor} onChange={(e) => setFactor(e.target.value)} />
        )}
      </td>
      <td>
        <input type="number" className="w-24" min="0" step="any" placeholder="derived" value={wholesale} onChange={(e) => setWholesale(e.target.value)} />
      </td>
      <td>
        <input type="number" className="w-24" min="0" step="any" placeholder="derived" value={retail} onChange={(e) => setRetail(e.target.value)} />
      </td>
      <td>
        {su.isDefaultSaleUnit ? (
          <span className="badge">DEFAULT</span>
        ) : (
          <button className="btn text-xs" disabled={saving} onClick={() => save({ isDefaultSaleUnit: true })}>
            Make default
          </button>
        )}
      </td>
      <td>
        {su.isBaseUnit ? (
          <span className="badge">BASE</span>
        ) : (
          <button className="btn text-xs" disabled={saving} onClick={makeBase} title="Count this product's stock in this unit instead — quantities and prices are rescaled to match">
            Make base
          </button>
        )}
      </td>
      <td>
        <div className="flex items-center gap-1">
          <button
            className="btn-primary text-xs"
            disabled={saving || (!su.isBaseUnit && !factor)}
            onClick={() =>
              save({
                ...(su.isBaseUnit ? {} : { factorToBase: Number(factor) }),
                wholesalePrice: priceOrNull(wholesale),
                retailPrice: priceOrNull(retail),
              })
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {/* Every unit can go, the base one included — the stock stays counted
              in it either way (Product.baseUnitId outlives the row). The two
              cases that are genuinely refused (a live order billed in it, the
              product's last unit) are refused by the route, with the reason
              shown below: a button that explains beats a button that is dead. */}
          <button className="btn text-xs text-bad" disabled={saving} onClick={detach}>
            Remove
          </button>
        </div>
        <ErrorNote error={error} />
      </td>
    </tr>
  );
}

// Wires an already-existing unit onto an already-existing product's sellable
// units — closes the gap where a manager could add a unit above but had no
// way to make any product actually receivable in it (previously admin-only,
// and only at product-creation time; see api/admin/products/[id]/units).
function AttachUnitForm({ units }: { units: FullUnit[] }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [unitId, setUnitId] = useState("");
  const [factor, setFactor] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [retail, setRetail] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  const alreadyAttached = !!product?.saleUnits.some((su) => su.unit.id === unitId);

  // The units table below is this component's own copy, so a save/detach/attach
  // has to re-read the one product rather than a catalogue-wide list reload.
  async function refreshProduct() {
    if (!product) return;
    const found = await fetchProduct(product.sku, product.id);
    if (found) setProduct(found);
  }

  async function attach() {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/products/${product!.id}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId,
        factorToBase: Number(factor),
        isDefaultSaleUnit: makeDefault,
        wholesalePrice: priceOrNull(wholesale),
        retailPrice: priceOrNull(retail),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not attach unit"));
    }
    setUnitId("");
    setFactor("");
    setWholesale("");
    setRetail("");
    setMakeDefault(false);
    refreshProduct();
  }

  return (
    <div className="card space-y-2" id="attach">
      <h2 className="text-sm font-semibold">Attach unit to product</h2>
      <p className="text-xs text-muted">Makes a unit added above actually usable for Receive Stock on a specific product.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Product</label>
          <ProductPicker
            value={product}
            onChange={(p) => {
              setProduct(p);
              setUnitId("");
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Unit</label>
          <select className="w-20" value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!product}>
            <option value="">…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.symbol}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">= how many base units</label>
          <input type="number" className="w-24" min="0" step="any" placeholder="factor" value={factor} onChange={(e) => setFactor(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Wholesale rate</label>
          <input type="number" className="w-24" min="0" step="any" placeholder="derived" value={wholesale} onChange={(e) => setWholesale(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Retail rate</label>
          <input type="number" className="w-24" min="0" step="any" placeholder="derived" value={retail} onChange={(e) => setRetail(e.target.value)} />
        </div>
        <label className="mb-1 flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          Default sale unit
        </label>
        <button className="btn-primary" disabled={saving || !product || !unitId || !factor || alreadyAttached} onClick={attach}>
          {saving ? "Attaching…" : "Attach"}
        </button>
      </div>
      {alreadyAttached && <p className="text-xs text-warn">Already attached to this product</p>}
      <ErrorNote error={error} />
      {product && (
        <>
          <h3 className="pt-2 text-sm font-semibold">Units on {product.sku}</h3>
          <p className="text-xs text-muted">
            Leave a rate blank to derive it from the base price × factor. The base unit&rsquo;s factor is fixed at 1 — stock is stored in it, so changing it would rescale every quantity on hand.
          </p>
          <SaleUnitTable product={product} reload={refreshProduct} />
        </>
      )}
    </div>
  );
}

// A stock line, and the two things a manager needs to do to it without
// leaving the screen: correct what the shelf actually holds, and edit the
// product behind it. Counting is inline rather than in a modal — the whole
// point is comparing the typed figure against the row it belongs to.
const REASONS = [
  ["STOCK_COUNT_ADJUSTMENT", "Stock count"],
  ["DAMAGE", "Damaged"],
  ["EXPIRY", "Expired"],
  ["MANUAL_ADJUSTMENT", "Other correction"],
] as const;

function StockRow({ row, q, onDone, onEdit }: { row: Row; q: string; onDone: () => void; onEdit: () => void }) {
  // The units of this one product, fetched only when the cell is opened —
  // the Stock table is the whole catalogue, and pulling every product's units
  // on every page load to fill a column most rows never expand is not worth
  // the wait.
  const [units, setUnits] = useState<Product | null>(null);
  const [showUnits, setShowUnits] = useState(false);
  const [unitsError, setUnitsError] = useState<ApiError | null>(null);
  const [counting, setCounting] = useState(false);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState<string>(REASONS[0][0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  const negative = isNegativeStock(Number(row.onHand), Number(row.available));
  const onHand = Number(row.onHand);
  // Live delta: what pressing Save will actually move. A manager typing 12
  // into a row showing 17 should see "−5" before committing, not after.
  const delta = counted.trim() === "" || Number.isNaN(Number(counted)) ? null : Number(counted) - onHand;

  function start() {
    setCounted(onHand.toFixed(2));
    setError(null);
    setCounting(true);
  }

  async function loadUnits() {
    setUnitsError(null);
    const found = await fetchProduct(row.sku, row.productId);
    if (!found) return setUnitsError({ message: `Could not load the units of ${row.sku}.` });
    setUnits(found);
  }

  function toggleUnits() {
    setShowUnits((open) => !open);
    if (!units) loadUnits();
  }

  async function save() {
    if (delta == null || delta === 0) return setCounting(false);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: row.productId,
        countedQty: Number(counted),
        expectedOnHand: onHand,
        movementType: reason,
        note: note.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not adjust stock"));
    }
    setCounting(false);
    setNote("");
    onDone();
  }

  // Reserved is edited in place like a count: click the figure, type, Enter.
  // Holds left by orders that will never finish are the usual reason.
  const [reservedInput, setReservedInput] = useState<string | null>(null);
  const [reservedError, setReservedError] = useState<ApiError | null>(null);

  async function saveReserved() {
    const qty = Number(reservedInput);
    if (reservedInput == null || reservedInput.trim() === "" || !(qty >= 0)) {
      return setReservedError({ message: "Reserved must be a number, 0 or more" });
    }
    if (qty === Number(row.reserved)) return setReservedInput(null);
    setSaving(true);
    setReservedError(null);
    const res = await fetch("/api/inventory/reserved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: row.productId, reservedQty: qty, expectedReserved: row.reserved }),
    });
    setSaving(false);
    if (!res.ok) return setReservedError(await readError(res, "Could not change reserved"));
    setReservedInput(null);
    onDone();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setCounting(false);
      setError(null);
    }
  }

  return (
    <>
      <tr className={negative ? "bg-bad/5" : undefined}>
        <td className="text-muted"><Highlight text={row.sku} q={q} /></td>
        <td className={negative ? "font-semibold text-bad" : undefined}><Highlight text={row.product} q={q} /></td>
        <td className="whitespace-nowrap">
          <button className="btn text-xs" onClick={toggleUnits} title="Sizes this product is sold in — rates, and which one a bill opens on">
            {units ? units.saleUnits.map((su) => su.unit.symbol).join(", ") || "none" : "Units"} {showUnits ? "▾" : "▸"}
          </button>
        </td>
        <td
          className={
            onHand < 0 || row.level === "low" ? "font-semibold text-bad" : row.level === "near" ? "text-warn" : undefined
          }
        >
          {counting ? (
            <input
              type="number"
              step="any"
              className="w-24"
              autoFocus
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              onKeyDown={onKey}
            />
          ) : (
            onHand.toFixed(2)
          )}
        </td>
        <td>
          {reservedInput != null ? (
            <span className="inline-flex items-center gap-1">
              <input
                type="number"
                step="any"
                min={0}
                className="w-20"
                autoFocus
                value={reservedInput}
                onChange={(e) => setReservedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving) saveReserved();
                  else if (e.key === "Escape") (setReservedInput(null), setReservedError(null));
                }}
              />
              <button className="btn-primary text-xs" disabled={saving} onClick={saveReserved} title="Save (Enter)">
                ✓
              </button>
              <button className="btn text-xs" disabled={saving} onClick={() => (setReservedInput(null), setReservedError(null))} title="Cancel (Esc)">
                ✕
              </button>
              <button className="btn text-xs" disabled={saving} onClick={() => setReservedInput("0")} title="Set reserved to 0">
                0
              </button>
            </span>
          ) : (
            <button
              className="underline decoration-dotted"
              onClick={() => (setReservedInput(String(Number(row.reserved))), setReservedError(null))}
              title="Click to change the reserved quantity"
            >
              {Number(row.reserved).toFixed(2)}
            </button>
          )}
          <ErrorNote error={reservedError} />
        </td>
        <td className={Number(row.available) < 0 ? "font-semibold text-bad" : undefined}>{Number(row.available).toFixed(2)}</td>
        <td className="text-muted">{row.minStock == null ? "—" : Number(row.minStock).toFixed(2)}</td>
        <td>
          {negative ? (
            <span className="badge bg-bad text-white">NEGATIVE</span>
          ) : (
            row.level !== "ok" && (
              <span className={`badge text-white ${row.level === "low" ? "bg-bad" : "bg-warn"}`}>
                {row.level === "low" ? "LOW" : "NEAR"}
              </span>
            )
          )}
        </td>
        <td className="whitespace-nowrap">
          {counting ? (
            <>
              <button className="btn-primary text-xs" disabled={saving || delta == null || delta === 0} onClick={save}>
                {saving ? "Saving…" : "Save count"}
              </button>{" "}
              <button className="btn text-xs" disabled={saving} onClick={() => setCounting(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn text-xs" onClick={start}>
                Count
              </button>{" "}
              <button className="btn text-xs" onClick={onEdit}>
                Edit
              </button>
            </>
          )}
        </td>
      </tr>
      {showUnits && (
        <tr>
          <td colSpan={9}>
            {unitsError ? (
              <ErrorNote error={unitsError} onRetry={loadUnits} />
            ) : units ? (
              <div className="py-1">
                <p className="mb-1 text-xs text-muted">
                  Leave a rate blank to derive it from the product price × factor. The base unit&rsquo;s factor is fixed at 1 — stock is
                  stored in it, so changing it would rescale every quantity on hand. Attach another unit from the form above.
                </p>
                <SaleUnitTable product={units} reload={loadUnits} />
              </div>
            ) : (
              <span className="text-xs text-muted">Loading units…</span>
            )}
          </td>
        </tr>
      )}
      {counting && (
        <tr className="bg-bad/5">
          <td colSpan={9}>
            <div className="flex flex-wrap items-center gap-2 py-1" onKeyDown={onKey}>
              <span className="text-xs text-muted">Reason</span>
              <select className="text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input className="w-64 text-sm" placeholder="Note (optional) — goes to the audit log" value={note} onChange={(e) => setNote(e.target.value)} />
              {delta != null && delta !== 0 && (
                <span className={`text-sm font-semibold ${delta < 0 ? "text-bad" : "text-good"}`}>
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(2)} → {(onHand + delta).toFixed(2)} on hand
                </span>
              )}
              <span className="text-xs text-muted">Enter saves · Esc cancels</span>
              <ErrorNote error={error} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ManagerInventoryPage() {
  const { data, error, loading, reload } = useApiGet<{ items: Row[] }>("/api/admin/reports?type=inventory");
  const allItems = useMemo(() => data?.items ?? [], [data]);
  // Arriving from the dashboard's Low Stock tile (#low) opens filtered; the
  // toggle then shows the full product list without leaving the page. Read
  // after mount, not via useSearchParams — that would force this page behind
  // a Suspense boundary just to pick up one flag.
  const [filter, setFilter] = useState<"all" | "low" | "negative">("all");
  useEffect(() => {
    if (window.location.hash === "#low") setFilter("low");
    // The dashboard's negative-stock switch links straight to the list it creates.
    if (window.location.hash === "#negative") setFilter("negative");
  }, []);
  const [q, setQ] = useState("");
  const items = allItems.filter(
    (i) =>
      (filter === "all" || (filter === "low" ? i.level !== "ok" : isNegativeStock(Number(i.onHand), Number(i.available)))) &&
      matchesQuery(q, i.product, i.sku)
  );
  const lowCount = allItems.filter((i) => i.level === "low").length;
  const nearCount = allItems.filter((i) => i.level === "near").length;
  const negCount = allItems.filter((i) => isNegativeStock(Number(i.onHand), Number(i.available))).length;
  const { data: unitsData, reload: reloadUnits } = useApiGet<FullUnit[]>("/api/admin/units");
  const units = unitsData ?? [];
  // The Stock table is built from the inventory report, which carries only
  // the figures — so Edit fetches the one product it needs (searching by its
  // SKU, which is unique) rather than every page load hauling the whole
  // catalogue just in case someone clicks Edit.
  const [editing, setEditing] = useState<EditableProduct | null>(null);
  const [editError, setEditError] = useState<ApiError | null>(null);
  async function openEditor(row: Row) {
    setEditError(null);
    const found = (await fetchProduct(row.sku, row.productId)) as EditableProduct | null;
    if (!found) return setEditError({ message: `Could not load ${row.sku} for editing.` });
    setEditing(found);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Inventory</h1>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      <ReceiveStock onReceived={reload} />
      <AddUnitForm units={units} reloadUnits={reloadUnits} />
      <AttachUnitForm units={units} />
      {loading ? (
        <SkeletonTable rows={6} cols={9} />
      ) : (
      <div className="card" id="low">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Stock</h2>
          <input className="w-48" placeholder="Search product…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn text-xs" onClick={() => setFilter(filter === "low" ? "all" : "low")}>
            {filter === "low" ? `Show all ${allItems.length} products` : "Show low stock only"}
          </button>
          <button
            className={`btn text-xs ${filter === "negative" ? "" : "text-bad"}`}
            onClick={() => setFilter(filter === "negative" ? "all" : "negative")}
          >
            {filter === "negative" ? `Show all ${allItems.length} products` : `Show negative stock (${negCount})`}
          </button>
          <ErrorNote error={editError} />
          <span className="text-xs text-muted">
            {negCount > 0 && <span className="font-semibold text-bad">{negCount} negative</span>}
            {negCount > 0 && lowCount > 0 && " · "}
            {lowCount > 0 && <span className="text-bad">{lowCount} low</span>}
            {lowCount > 0 && nearCount > 0 && " · "}
            {nearCount > 0 && <span className="text-warn">{nearCount} near minimum</span>}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Units</th>
              <th>On Hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Minimum</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <StockRow key={i.productId} row={i} q={q} onDone={reload} onEdit={() => openEditor(i)} />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="text-muted">
                  {filter === "low"
                    ? "Nothing below its minimum — everything is stocked."
                    : filter === "negative"
                      ? "No product is in negative stock."
                      : "No products match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {editing && (
        <EditProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={reload} // minimum/level in the Stock table come from the product
        />
      )}
    </div>
  );
}
