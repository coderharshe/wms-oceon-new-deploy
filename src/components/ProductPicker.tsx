"use client";

import { useRef, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { useDebounced } from "@/lib/useDebounced";
import { SEARCH_LIMIT } from "@/lib/offline-catalog";
import { Highlight } from "@/components/Highlight";
import { AddProductModal } from "@/components/AddProductModal";

/** Money as the API sends it — Prisma serialises Decimal to a string, Drizzle
 *  returns numeric columns as strings too. Always Number() before arithmetic. */
type Money = string | number | null | undefined;

export type PickedProduct = {
  id: string;
  sku: string;
  name: string;
  // Carried so a caller can show the catalogue rate the moment a product is
  // picked, instead of an empty box until the server prices it on save.
  wholesalePrice?: Money;
  retailPrice?: Money;
  saleUnits: {
    unit: { id: string; symbol: string };
    isBaseUnit: boolean;
    unitId?: string;
    isDefaultSaleUnit?: boolean;
    factorToBase?: Money;
    wholesalePrice?: Money;
    retailPrice?: Money;
  }[];
};

/**
 * Product search for a catalogue that doesn't fit in a <select>.
 *
 * One box, not two. This used to be a search input *above* a separate
 * dropdown, and the dropdown read as the product list itself — so "Showing
 * the first 50" looked like a cap on what could be added rather than one
 * page of matches. Every product is reachable; you just have to type. Making
 * the results hang off the search box says that on its own, and it is the
 * same shape as the till's product entry, which staff already use all day.
 *
 * /api/products returns at most SEARCH_LIMIT rows per query. That is a page
 * size, not a restriction — a typed query narrows well below it, and the
 * notice only appears when a page actually comes back full.
 */
export function ProductPicker<T extends PickedProduct>({
  value,
  onChange,
  className = "w-48",
  allowCreate = true,
  autoFocus = false,
}: {
  value: T | null;
  onChange: (p: T | null) => void;
  className?: string;
  allowCreate?: boolean;
  /** Focus on mount — for a picker that appears because the user asked for a new line. */
  autoFocus?: boolean;
}) {
  // The text in the box. Picking a product writes its name here; editing that
  // text means the cashier is looking for something else, so the previous
  // pick is dropped rather than left silently attached to a stale label.
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [adding, setAdding] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // /api/products is the highest-QPS read in the app — don't hit it per keystroke.
  const debouncedQ = useDebounced(q.trim());
  const { data, loading } = useApiGet<T[]>(open ? `/api/products?q=${encodeURIComponent(debouncedQ)}` : null);
  const results = data ?? [];
  const canCreate = allowCreate && q.trim().length > 0;
  const rowCount = results.length + (canCreate ? 1 : 0);

  function pick(p: T) {
    onChange(p);
    setQ(`${p.sku} — ${p.name}`);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setOpen(false);
    if (!open || rowCount === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (i + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (i - 1 + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (idx < results.length) pick(results[idx]!);
      else if (canCreate) setAdding(true);
    }
  }

  return (
    <div className="relative">
      <input
        className={className}
        autoFocus={autoFocus}
        placeholder="Search SKU or name…"
        aria-label="Search products"
        role="combobox"
        aria-expanded={open}
        value={q}
        onFocus={() => setOpen(true)}
        // A click on an option blurs the input before the click registers, so
        // closing is deferred rather than immediate.
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
          setOpen(true);
          if (value) onChange(null);
        }}
      />
      {value && (
        <button
          type="button"
          className="absolute right-1 top-1 text-xs text-muted"
          aria-label="Clear selected product"
          onClick={() => {
            onChange(null);
            setQ("");
          }}
        >
          ✕
        </button>
      )}
      {open && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-72 overflow-y-auto border border-line bg-paper"
          onMouseDown={() => blurTimer.current && clearTimeout(blurTimer.current)}
        >
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === idx}
              className={`block w-full px-2 py-1 text-left text-sm hover:bg-surface-hi ${i === idx ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""}`}
              onClick={() => pick(p)}
            >
              <Highlight text={p.name} q={q} /> <span className="text-muted">(<Highlight text={p.sku} q={q} />)</span>
            </button>
          ))}
          {/* A full page means there are more behind it. Only shown when one
              actually comes back full, and worded as "narrow it down" rather
              than "the rest are unavailable" — every product can be added. */}
          {results.length >= SEARCH_LIMIT && (
            <p className="border-t border-line px-2 py-1 text-xs text-muted">
              {SEARCH_LIMIT} matches shown — keep typing to narrow it down
            </p>
          )}
          {loading && results.length === 0 && <p className="px-2 py-1 text-xs text-muted">Searching…</p>}
          {!loading && debouncedQ !== "" && results.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted">No product matches</p>
          )}
          {canCreate && (
            <button
              type="button"
              className={`block w-full border-t border-line px-2 py-2 text-left text-sm font-medium text-accent hover:bg-accent/10 ${
                idx === results.length ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""
              }`}
              onClick={() => setAdding(true)}
            >
              ➕ Add &quot;{q.trim()}&quot; as new product
            </button>
          )}
        </div>
      )}
      {adding && (
        <AddProductModal
          initialName={q.trim()}
          onClose={() => setAdding(false)}
          onCreated={(p) => {
            setAdding(false);
            // Straight onto the line that needed it — the created row carries
            // baseUnit and saleUnits, which is everything a caller reads.
            pick(p as T);
          }}
        />
      )}
    </div>
  );
}
