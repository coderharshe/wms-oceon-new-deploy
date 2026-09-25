"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtQty } from "@/lib/fmt";

type SaleUnit = { symbol: string; factorToBase: string; isDefaultSaleUnit: boolean; wholesalePrice: string | null; retailPrice: string | null };
type Row = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  active: boolean;
  wholesalePrice: string;
  retailPrice: string;
  reviewNotes: string | null;
  baseUnit: string;
  onHand: string;
  saleUnits: SaleUnit[];
};

// The import writes its note as "what is wrong || what to do". Splitting them
// lets the diagnosis and the action read as two separate things, which is the
// difference between a manager understanding a row and just clearing it.
function splitNote(note: string | null): { problem: string; fix: string | null } {
  if (!note) return { problem: "Flagged during import.", fix: null };
  const [problem = "", fix] = note.split("||");
  return { problem: problem.trim() || "Flagged during import.", fix: fix?.trim() || null };
}

const CATEGORIES = ["Kirana", "Snacks", "Masala", "Household", "Drinks", "Tobacco", "Rice & Atta", "Stationery"];

function ReviewRow({ row, onCleared }: { row: Row; onCleared: (id: string) => void }) {
  const [wholesale, setWholesale] = useState(row.wholesalePrice);
  const [retail, setRetail] = useState(row.retailPrice);
  const [category, setCategory] = useState(row.category ?? "");
  const [qty, setQty] = useState(Number(row.onHand).toString());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { problem, fix } = splitNote(row.reviewNotes);
  const qtyChanged = Number(qty) !== Number(row.onHand);
  const priced = Number(wholesale) > 0;

  async function save() {
    setError(null);
    setSaving(true);

    // Stock is a ledger, not a column: a corrected count goes through the
    // inventory route so it lands as a movement with an audit trail, and it
    // carries the on-hand figure this screen was showing so a sale landing
    // mid-edit is rejected rather than silently overwritten.
    if (qtyChanged) {
      const stockRes = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: row.id,
          countedQty: Number(qty),
          expectedOnHand: Number(row.onHand),
          movementType: "STOCK_COUNT_ADJUSTMENT",
          note: "Corrected while reviewing the catalogue import",
        }),
      });
      if (!stockRes.ok) {
        setSaving(false);
        const body = await stockRes.json().catch(() => ({}));
        return setError(typeof body.error === "string" ? body.error : "Could not update the quantity");
      }
    }

    const res = await fetch(`/api/manager/review/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        needsReview: false,
        // Only what actually changed, so an untouched row is not rewritten
        // (and re-rounded) by clearing the flag.
        ...(wholesale !== row.wholesalePrice ? { wholesalePrice: Number(wholesale) } : {}),
        ...(retail !== row.retailPrice ? { retailPrice: Number(retail) } : {}),
        ...(category && category !== row.category ? { category } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(typeof body.error === "string" ? body.error : "Could not save");
    }
    onCleared(row.id);
  }

  const defaultUnit = row.saleUnits.find((su) => su.isDefaultSaleUnit);

  return (
    <tr className="align-top">
      <td>
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted">
          {row.sku}
          {!row.active && " · switched off"}
        </div>
        <div className="mt-1 max-w-md border-l-2 border-bad pl-2">
          <div className="text-xs text-bad">{problem}</div>
          {fix && <div className="mt-0.5 text-xs text-muted">→ {fix}</div>}
        </div>
        <div className="mt-1 text-xs text-muted">
          Sells in:{" "}
          {row.saleUnits.length === 0
            ? row.baseUnit
            : row.saleUnits
                .map((su) => `${su.symbol}${su.symbol === row.baseUnit ? "" : ` ×${Number(su.factorToBase)}`}${su === defaultUnit ? " (default)" : ""}`)
                .join(", ")}
        </div>
        {error && <div className="mt-1 text-xs text-bad">{error}</div>}
      </td>
      <td>
        <select className="w-32" aria-label={`Category for ${row.name}`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Select…</option>
          {(CATEGORIES.includes(category) || !category ? CATEGORIES : [category, ...CATEGORIES]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <input
            type="number"
            className="w-20"
            min="0"
            step="any"
            aria-label={`Quantity on hand for ${row.name}`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <span className="text-xs text-muted">{row.baseUnit}</span>
        </div>
        {qtyChanged && <div className="text-xs text-warn">was {fmtQty(row.onHand)}</div>}
      </td>
      <td>
        <input
          type="number"
          className="w-24"
          min="0"
          step="any"
          aria-label={`Wholesale price for ${row.name}`}
          value={wholesale}
          onChange={(e) => setWholesale(e.target.value)}
        />
        <div className="text-xs text-muted">per {row.baseUnit}</div>
      </td>
      <td>
        <input
          type="number"
          className="w-24"
          min="0"
          step="any"
          aria-label={`Retail price for ${row.name}`}
          value={retail}
          onChange={(e) => setRetail(e.target.value)}
        />
        <div className="text-xs text-muted">per {row.baseUnit}</div>
      </td>
      <td>
        <button className="btn-primary" disabled={saving || !priced} onClick={save}>
          {saving ? "Saving…" : "Save & clear"}
        </button>
        {!priced && <div className="mt-1 w-24 text-xs text-muted">Needs a wholesale price above ₹0</div>}
      </td>
    </tr>
  );
}

// Worklist for products the catalogue import could not read with confidence.
// Rows leave the list as they are cleared, so what is left on screen is what
// still needs a human.
export default function ManagerReviewPage() {
  const { data, error, loading, reload } = useApiGet<Row[]>("/api/manager/review");
  const [cleared, setCleared] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");

  const all = (data ?? []).filter((r) => !cleared.includes(r.id));
  const categories = [...new Set(all.map((r) => r.category ?? ""))].sort();
  const rows = all.filter(
    (r) => (!category || (r.category ?? "") === category) && (!q || `${r.name} ${r.sku}`.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Review ({all.length})</h1>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted">
              Products the catalogue import could not read with confidence. Each row says what is wrong and what to do. Correct the
              category, quantity or prices, then save — a product switched off comes back on once it has a real wholesale price.
            </p>
            <select className="w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c || "uncategorised"}
                </option>
              ))}
            </select>
            <input className="w-48" placeholder="Search name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <table>
            <thead>
              <tr>
                <th>Product / what is wrong</th>
                <th>Category</th>
                <th>On hand</th>
                <th>Wholesale</th>
                <th>Retail</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ReviewRow key={r.id} row={r} onCleared={(id) => setCleared((c) => [...c, id])} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted">
                    {all.length === 0 ? "Nothing left to review." : "No flagged products match."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
