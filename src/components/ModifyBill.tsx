"use client";

import { useState } from "react";
import { ErrorNote } from "@/components/ErrorNote";
import { useEscapeKey } from "@/lib/keynav";
import { ProductPicker, type PickedProduct } from "@/components/ProductPicker";
import { catalogueRate, unitIdOf, type SaleUnitLike, type PricedProduct, type Money } from "@/lib/bill-lines";
import { queueRevision, type ReviseItem } from "@/lib/offline-bills";
import { buildReviseItems } from "@/lib/offline-screens";


export type ModifiableLine = {
  id: string;
  productId: string;
  unitId: string;
  product: { name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits?: SaleUnitLike[] } | null;
  quantity: string;
  unitPrice: string;
};


const unitSym = (u: SaleUnitLike) => u.unit?.symbol ?? "";

// The unit a newly picked product opens on. Drinks default to peti and rice to
// bag, so the base unit (always the smallest, for stock) is the fallback
// rather than the default — see ProductUnit.isDefaultSaleUnit.
const defaultUnitId = (units: SaleUnitLike[]) =>
  unitIdOf(units.find((u) => u.isDefaultSaleUnit) ?? units.find((u) => u.isBaseUnit) ?? units[0] ?? { unit: null });

/**
 * One editable row. Every row is the same shape whether it came off the bill
 * or was just picked, which is what lets the unit dropdown, the rate box and
 * the remove button work identically on all of them.
 *
 * `key` is a stable identity, deliberately not product+unit: changing a line's
 * unit is the whole point of this editor, and a key derived from the unit
 * would rename itself mid-edit and lose what was typed.
 */
type Row = {
  key: string;
  product: PricedProduct | null;
  unitId: string;
  qty: string;
  rate: string;
  /**
   * Where the rate in the box came from, which decides whether it is sent.
   *
   * - "bill": the price this line was actually billed at. Sent as-is, always
   *   — PRD 23, a price already charged is never silently recalculated.
   * - "typed": finance overrode it. Sent.
   * - "catalogue": derived here for display only. NOT sent, so the server
   *   resolves it and stays the single authority on what a new line costs.
   */
  rateSource: "bill" | "typed" | "catalogue";
  /** Was on the bill when the editor opened — so removing it is a real change. */
  existing: boolean;
  removed: boolean;
};

/**
 * Modify an already-issued bill: change quantities, rates and units, drop
 * lines, and add products that were missed. Shared by the Finance and Manager
 * order pages — the route allows both roles, and the new bill version records
 * which one did it.
 *
 * Quantities go to the server in the unit they are billed in; the server
 * converts to base units before touching stock, so a peti edit moves the right
 * number of pieces and switching a line's unit nets out correctly. A line with
 * a blank rate is priced from the catalogue at the order's own selling mode,
 * which the server already knows.
 */
export function ModifyBill({
  orderId,
  lines,
  sellingMode,
  onSaved,
  disabled,
  expectedVersion,
  queueOffline,
  saveWith,
}: {
  orderId: string;
  lines: ModifiableLine[];
  /** The order's own mode — a catalogue rate is different wholesale vs retail. */
  sellingMode: string;
  onSaved: () => void;
  disabled?: boolean;
  /** The bill version this screen shows. Sent with the edit, so a bill QC or a manager changed meanwhile is refused (409), not overwritten. */
  expectedVersion?: number;
  /** Finance: no connection (or no answer) queues the edit on this PC instead of failing. The manager screen stays online-only. */
  queueOffline?: boolean;
  /** A bill that only exists on this PC: the edit is saved here, never POSTed. Every line then carries its rate. Returns what to tell the user. */
  saveWith?: (items: ReviseItem[], reason: string) => Promise<string>;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set by a 409: the version the server has now, which "Save anyway" edits on top of.
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);

  // Claimed before the page's Esc-goes-back handler sees it — otherwise one
  // Esc mid-edit would leave the screen and throw the changes away.
  useEscapeKey((e) => {
    if (!rows) return;
    e.preventDefault();
    setRows(null);
  });

  function start() {
    setError(null);
    setNotice(null);
    setConflictVersion(null);
    setReason("");
    // A→Z like the printed bill (invoice.ts), so the screen matches the paper.
    const sorted = [...lines].sort((a, b) =>
      (a.product?.name ?? "").localeCompare(b.product?.name ?? "", undefined, { sensitivity: "base", numeric: true })
    );
    setRows(
      sorted.map((l) => ({
        key: l.id,
        product: {
          id: l.productId,
          name: l.product?.name ?? "",
          wholesalePrice: l.product?.wholesalePrice,
          retailPrice: l.product?.retailPrice,
          saleUnits: l.product?.saleUnits ?? [],
        },
        unitId: l.unitId,
        qty: Number(l.quantity).toString(),
        rate: Number(l.unitPrice).toString(),
        rateSource: "bill" as const,
        existing: true,
        removed: false,
      }))
    );
  }

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) =>
      rs
        ? rs.map((r) => {
            if (r.key !== key) return r;
            // An overridden rate was typed against one specific unit — Rs 50
            // for a piece is not Rs 50 for a peti of 48. Switching units drops
            // back to the catalogue rate rather than silently repricing the
            // line at a number meant for something else.
            const unitChanged = p.unitId !== undefined && p.unitId !== r.unitId;
            if (!unitChanged) return { ...r, ...p };
            // The old rate was quoted against the old unit — Rs 680 a peti is
            // not Rs 680 a bottle — so it is replaced by the catalogue rate for
            // the unit now selected, shown rather than left blank so the change
            // in price is visible before saving.
            const next = { ...r, ...p };
            const rate = next.product ? catalogueRate(next.product, next.unitId, sellingMode) : null;
            return { ...next, rate: rate == null ? "" : String(rate), rateSource: "catalogue" as const };
          })
        : rs
    );
  }

  // Removing a line off the bill keeps it on screen, struck through, so the
  // change is visible before saving and can be undone. A row that was only
  // just added has nothing to record, so it simply goes.
  function remove(key: string) {
    setRows((rs) => (rs ? rs.flatMap((r) => (r.key !== key ? [r] : r.existing ? [{ ...r, removed: true }] : [])) : rs));
  }

  function close(message: string | null) {
    setRows(null);
    setConflictVersion(null);
    setNotice(message);
    onSaved();
  }

  async function save() {
    if (!rows) return;
    // A product listed twice in one unit, a missing unit or reason: caught
    // here with something actionable instead of the server's error.
    const built = buildReviseItems(rows, reason, !!saveWith);
    if ("error" in built) return setError(built.error);

    setBusy(true);
    setError(null);
    if (saveWith) {
      try {
        close(await saveWith(built.items, built.reason));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the change on this PC");
      } finally {
        setBusy(false);
      }
      return;
    }

    const version = conflictVersion ?? expectedVersion;
    try {
      const res =
        queueOffline && !navigator.onLine
          ? null
          : await fetch(`/api/finance/orders/${orderId}/revise`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: built.items, reason: built.reason, ...(version != null ? { expectedVersion: version } : {}) }),
              // A hung request is treated as no connection. Safe to queue after
              // it: if it did land, the queued copy's expectedVersion is stale
              // and the server refuses it instead of applying the change twice.
              ...(queueOffline ? { signal: AbortSignal.timeout(15_000) } : {}),
            }).catch(() => null); // no server answer at all: offline, or timed out
      if (!res) {
        if (!queueOffline) return setError("Could not modify the bill: no connection to the server");
        await queueRevision(orderId, { items: built.items, reason: built.reason, expectedVersion: version ?? null });
        return close("Saved on this PC — will sync");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof body.currentVersion === "number") {
          setConflictVersion(body.currentVersion);
          onSaved(); // show what the bill is now, behind the editor
        }
        return setError(typeof body.error === "string" ? body.error : "Could not modify the bill");
      }
      close(null);
    } catch (err) {
      setError(`Could not save the change on this PC: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return (
      <>
        <button className="btn" disabled={busy || disabled} onClick={start}>
          Modify Bill
        </button>
        {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
        {notice && <p className="mt-1 text-sm text-muted">{notice}</p>}
      </>
    );
  }

  return (
    <div className="mb-3 space-y-2 border border-line bg-sunk p-3">
      <p className="text-xs text-muted">
        Changing a paid bill creates a new version and settles the difference as a refund or an extra collection.
        Stock moves with it. Use ✕ to take a product off the bill, change the unit to re-bill a line in another
        size, or add products below.
      </p>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Unit</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.removed ? "text-muted line-through opacity-60" : undefined}>
              <td>
                {r.existing ? (
                  r.product?.name
                ) : (
                  <ProductPicker
                    value={r.product as PickedProduct | null}
                    allowCreate={false}
                    autoFocus={!r.product}
                    onChange={(p) => {
                      const product = p
                        ? { id: p.id, name: p.name, wholesalePrice: p.wholesalePrice, retailPrice: p.retailPrice, saleUnits: p.saleUnits }
                        : null;
                      const unitId = product ? defaultUnitId(product.saleUnits) : "";
                      // Priced here and not on save: an empty Rate box was the
                      // whole complaint — finance could not see what the line
                      // they were adding would cost until the bill came back.
                      const rate = product ? catalogueRate(product, unitId, sellingMode) : null;
                      patch(r.key, { product, unitId, rate: rate == null ? "" : String(rate), rateSource: "catalogue" });
                    }}
                  />
                )}
              </td>
              <td>
                {/* Re-billing a line in another unit is a remove-and-add to the
                    server; stock nets per product in base units, so the shelf
                    ends up right either way. */}
                <select
                  className="w-28"
                  aria-label={`Unit for ${r.product?.name ?? "line"}`}
                  disabled={r.removed || !r.product}
                  value={r.unitId}
                  onChange={(e) => patch(r.key, { unitId: e.target.value })}
                >
                  {(r.product?.saleUnits ?? []).length === 0 && <option value={r.unitId}>—</option>}
                  {(r.product?.saleUnits ?? []).map((u) => (
                    <option key={unitIdOf(u)} value={unitIdOf(u)}>
                      {unitSym(u)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  className="w-24"
                  disabled={r.removed}
                  aria-label={`Quantity for ${r.product?.name ?? "line"}`}
                  value={r.qty}
                  onChange={(e) => patch(r.key, { qty: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-28"
                  placeholder="catalogue"
                  disabled={r.removed}
                  aria-label={`Rate for ${r.product?.name ?? "line"}`}
                  value={r.rate}
                  onChange={(e) => patch(r.key, { rate: e.target.value, rateSource: "typed" })}
                />
              </td>
              <td className="text-right">
                {r.rate === "" ? <span className="text-xs text-bad">no price set</span> : `₹${(Number(r.qty) * Number(r.rate)).toFixed(2)}`}
              </td>
              <td>
                {r.removed ? (
                  <button type="button" className="btn text-xs" onClick={() => patch(r.key, { removed: false })}>
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn text-xs"
                    aria-label={`Remove ${r.product?.name ?? "line"} from the bill`}
                    onClick={() => remove(r.key)}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn text-xs"
        onClick={() =>
          setRows([...rows, { key: `new-${Date.now()}`, product: null, unitId: "", qty: "1", rate: "", rateSource: "catalogue", existing: false, removed: false }])
        }
      >
        + Add product
      </button>
      <div>
        <label className="mb-1 block text-xs text-muted">Reason (required — shown to the manager)</label>
        <input
          className="w-full"
          value={reason}
          placeholder="e.g. 2 peti returned damaged, 1 crate added"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>
          {conflictVersion != null ? `Save anyway on version ${conflictVersion}` : "Save Changes"}
        </button>
        <button className="btn" disabled={busy} onClick={() => setRows(null)}>
          {conflictVersion != null ? "Discard my change" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
