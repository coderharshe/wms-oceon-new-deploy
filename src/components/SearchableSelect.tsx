"use client";

import { useState, useRef, useEffect, useMemo } from "react";

export type BaseProduct = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  barcode?: string | null;
  wholesalePrice?: string | number | null;
  taxPercent?: string | number | null;
  baseUnit?: { id?: string; symbol?: string; name?: string } | null;
  saleUnits?: Array<{
    unitId: string;
    unit?: { id?: string; symbol?: string; name?: string } | null;
    factorToBase?: string | number;
    wholesalePrice?: string | number | null;
  }>;
};

export type BaseSupplier = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  contactPerson?: string | null;
};

// ─── Supplier Select ───────────────────────────────────────────────────────────
export function SearchableSupplierSelect({
  suppliers,
  selectedId,
  onSelect,
  placeholder = "Search or select supplier…",
  onNewSupplier,
  disabled = false,
  className = "",
}: {
  suppliers: BaseSupplier[];
  selectedId: string;
  onSelect: (supplierId: string) => void;
  placeholder?: string;
  onNewSupplier?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedId),
    [suppliers, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.toLowerCase().trim();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phone && s.phone.toLowerCase().includes(q)) ||
        (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
        (s.gstin && s.gstin.toLowerCase().includes(q))
    );
  }, [suppliers, search]);

  useEffect(() => { setActiveIdx(-1); }, [filtered, isOpen]);

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function close() {
    setIsOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (activeIdx >= 0 && item) { onSelect(item.id); close(); }
    } else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false); setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsOpen(true); } }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink text-xs font-medium text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="truncate pr-2">
          {selectedSupplier ? (
            <span className="font-semibold text-ink">
              {selectedSupplier.name}{" "}
              {selectedSupplier.phone && <span className="text-muted font-normal text-[11px]">({selectedSupplier.phone})</span>}
            </span>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted text-[10px]">
          {selectedId && !disabled && (
            <span onClick={(e) => { e.stopPropagation(); onSelect(""); }} className="hover:text-bad px-1 font-bold" title="Clear selection">&#x2715;</span>
          )}
          <span>{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-line rounded-lg shadow-xl overflow-hidden min-w-[280px]">
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search name, phone, GSTIN… (↑↓ Enter Esc)"
                className="w-full text-xs py-1.5 pl-7 pr-2 rounded border border-line bg-surface text-ink focus:outline-hidden focus:border-accent"
              />
              <span className="absolute left-2 top-1.5 text-muted text-xs">&#x1F50D;</span>
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold">&#x2715;</button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-muted px-0.5">
              <span>{filtered.length} suppliers found</span>
              <span className="opacity-60">&#x2191;&#x2193; navigate &middot; Enter select &middot; Esc close</span>
              {onNewSupplier && (
                <button type="button" onClick={() => { setIsOpen(false); onNewSupplier(); }} className="text-accent font-semibold hover:underline">+ Add New Supplier</button>
              )}
            </div>
          </div>
          <div ref={listRef} role="listbox" className="max-h-56 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">
                <div>No suppliers match &quot;{search}&quot;</div>
                {onNewSupplier && (
                  <button type="button" onClick={() => { setIsOpen(false); onNewSupplier(); }} className="mt-1 text-accent underline text-xs font-medium">Create new supplier</button>
                )}
              </div>
            ) : (
              filtered.map((s, idx) => {
                const isSelected = s.id === selectedId;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={s.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onSelect(s.id); close(); }}
                    className={`p-2 cursor-pointer transition-colors flex items-center justify-between text-xs ${isActive ? "bg-accent/20 ring-1 ring-inset ring-accent/50" : isSelected ? "bg-accent/10 text-accent font-bold" : "hover:bg-surface-2 text-ink"}`}
                  >
                    <div>
                      <div className="font-medium text-ink flex items-center gap-1.5">
                        {s.name}
                        {isSelected && <span className="text-accent text-xs">&#x2713;</span>}
                      </div>
                      <div className="text-[10px] text-muted flex items-center gap-2 mt-0.5">
                        {s.phone && <span>{s.phone}</span>}
                        {s.contactPerson && <span>{s.contactPerson}</span>}
                        {s.gstin && <span className="font-mono">GSTIN: {s.gstin}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Product Select ────────────────────────────────────────────────────────────
export function SearchableProductSelect({
  products,
  selectedId,
  onSelect,
  placeholder = "Search or select product…",
  disabled = false,
  loading = false,
  className = "",
}: {
  products: BaseProduct[];
  selectedId: string;
  onSelect: (product: BaseProduct) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId),
    [products, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase().trim();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q))
    );
  }, [products, search]);

  useEffect(() => { setActiveIdx(-1); }, [filtered, isOpen]);

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function close() {
    setIsOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (activeIdx >= 0 && item) { onSelect(item); close(); }
    } else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false); setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsOpen(true); } }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full py-1 px-2 rounded border border-line bg-surface text-ink text-xs text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="truncate pr-1.5 flex items-center gap-1.5">
          {selectedProduct ? (
            <>
              <span className="font-semibold text-ink truncate">{selectedProduct.name}</span>
              <span className="font-mono text-[10px] px-1 rounded bg-surface-2 text-muted border border-line shrink-0">{selectedProduct.sku}</span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </div>
        <span className="text-[10px] text-muted shrink-0">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 top-full mt-1 w-[320px] sm:w-[380px] bg-surface border border-line rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type SKU, name, barcode… (↑↓ Enter Esc)"
                className="w-full text-xs py-1.5 pl-7 pr-6 rounded border border-line bg-surface text-ink focus:outline-hidden focus:border-accent"
              />
              <span className="absolute left-2 top-1.5 text-muted text-xs">&#x1F50D;</span>
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold">&#x2715;</button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-muted px-0.5">
              <span>{loading ? "Loading catalog…" : `${filtered.length} products found`}</span>
              <span className="opacity-60">&#x2191;&#x2193; navigate &middot; Enter select &middot; Esc close</span>
            </div>
          </div>
          <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-5 text-center text-xs text-muted">
                {loading ? "Loading product catalog…" : `No products match "${search}"`}
              </div>
            ) : (
              filtered.map((p, idx) => {
                const isSelected = p.id === selectedId;
                const isActive = idx === activeIdx;
                const unitSymbol = p.baseUnit?.symbol || "unit";
                const price = Number(p.wholesalePrice || 0);
                return (
                  <div
                    key={p.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onSelect(p); close(); }}
                    className={`p-2 cursor-pointer transition-colors flex items-center justify-between text-xs gap-2 ${isActive ? "bg-accent/20 ring-1 ring-inset ring-accent/50" : isSelected ? "bg-accent/10 border-l-2 border-accent" : "hover:bg-surface-2"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink truncate flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {isSelected && <span className="text-accent text-xs">&#x2713;</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                        <span className="font-mono bg-surface-2 text-ink px-1 rounded border border-line">{p.sku}</span>
                        {p.category && <span className="bg-surface-2 text-muted px-1 rounded">{p.category}</span>}
                        {p.brand && <span>Brand: {p.brand}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-ink text-xs">&#x20B9;{price.toFixed(2)}</div>
                      <div className="text-[10px] text-muted">per {unitSymbol}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PO Select ─────────────────────────────────────────────────────────────────
export type BasePO = {
  id: string;
  poNumber: string;
  total?: number | string;
  supplierId?: string;
  supplier?: { id?: string; name: string } | null;
  items?: any[];
  status?: string;
  expectedDeliveryDate?: string | null;
};

export function SearchablePOSelect({
  purchaseOrders,
  selectedId,
  onSelect,
  placeholder = "Direct / Walk-in Receipt (No PO)",
  disabled = false,
  className = "",
}: {
  purchaseOrders: BasePO[];
  selectedId: string;
  onSelect: (poId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  // -2=nothing, -1="No PO" row, >=0 = filtered PO index
  const [activeIdx, setActiveIdx] = useState(-2);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedPO = useMemo(
    () => purchaseOrders.find((p) => p.id === selectedId),
    [purchaseOrders, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return purchaseOrders;
    const q = search.toLowerCase().trim();
    return purchaseOrders.filter(
      (po) =>
        po.poNumber.toLowerCase().includes(q) ||
        (po.supplier?.name && po.supplier.name.toLowerCase().includes(q)) ||
        (po.status && po.status.toLowerCase().includes(q))
    );
  }, [purchaseOrders, search]);

  useEffect(() => { setActiveIdx(-2); }, [filtered, isOpen]);

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function close() {
    setIsOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx === -1) { onSelect(""); close(); }
      else { const item = filtered[activeIdx]; if (activeIdx >= 0 && item) { onSelect(item.id); close(); } }
    } else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false); setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsOpen(true); } }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full py-1.5 px-2.5 rounded border border-line bg-surface text-ink text-xs text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="truncate pr-2">
          {selectedPO ? (
            <div className="flex items-center gap-1.5 truncate">
              <span className="font-mono font-bold text-accent text-xs">{selectedPO.poNumber}</span>
              <span className="text-muted truncate">— {selectedPO.supplier?.name || "Supplier"}</span>
              <span className="font-mono text-[11px] font-semibold text-ink shrink-0">
                (&#x20B9;{Number(selectedPO.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })})
              </span>
            </div>
          ) : (
            <span className="text-muted font-medium">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedId && (
            <span onClick={(e) => { e.stopPropagation(); onSelect(""); }} className="text-muted hover:text-bad text-xs px-1 hover:bg-surface-2 rounded" title="Clear PO">&#x2715;</span>
          )}
          <span className="text-[10px] text-muted">{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 top-full mt-1 w-full min-w-[320px] sm:min-w-[400px] bg-surface border border-line rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search PO #, supplier name… (↑↓ Enter Esc)"
                className="w-full text-xs py-1.5 pl-7 pr-6 rounded border border-line bg-surface text-ink focus:outline-hidden focus:border-accent"
              />
              <span className="absolute left-2 top-1.5 text-muted text-xs">&#x1F50D;</span>
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold">&#x2715;</button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-muted px-0.5">
              <span>{filtered.length} active POs available</span>
              <span className="opacity-60">&#x2191;&#x2193; navigate &middot; Enter select &middot; Esc close</span>
            </div>
          </div>
          <div
            onClick={() => { onSelect(""); close(); }}
            className={`p-2.5 cursor-pointer border-b border-line/60 transition-colors text-xs flex items-center justify-between ${activeIdx === -1 ? "bg-accent/20 ring-1 ring-inset ring-accent/50" : !selectedId ? "bg-accent/10 text-accent font-semibold" : "hover:bg-surface-2 text-muted hover:text-ink"}`}
          >
            <div>
              <div className="font-semibold">Direct / Walk-in Receipt (No PO)</div>
              <div className="text-[10px] text-muted mt-0.5">Receive ad-hoc stock without linking to an approved Purchase Order</div>
            </div>
            {!selectedId && <span className="text-accent text-xs">&#x2713;</span>}
          </div>
          <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">No Purchase Orders found matching &quot;{search}&quot;</div>
            ) : (
              filtered.map((po, idx) => {
                const isSelected = po.id === selectedId;
                const isActive = idx === activeIdx;
                const poTotal = Number(po.total || 0);
                return (
                  <div
                    key={po.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onSelect(po.id); close(); }}
                    className={`p-2.5 cursor-pointer transition-colors flex items-center justify-between text-xs gap-2 ${isActive ? "bg-accent/20 ring-1 ring-inset ring-accent/50" : isSelected ? "bg-accent/10 border-l-2 border-accent text-ink" : "hover:bg-surface-2 text-ink"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-bold text-accent text-xs flex items-center gap-1.5">
                        <span>{po.poNumber}</span>
                        {isSelected && <span className="text-accent text-xs">&#x2713;</span>}
                      </div>
                      <div className="text-xs text-ink font-medium truncate mt-0.5">{po.supplier?.name || "Unknown Supplier"}</div>
                      {po.items && po.items.length > 0 && (
                        <div className="text-[10px] text-muted mt-0.5">{po.items.length} line item{po.items.length > 1 ? "s" : ""}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-ink text-xs">&#x20B9;{poTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
                      {po.status && <span className="badge bg-surface-2 text-[10px] text-muted border border-line">{po.status}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quick Product Search Add ──────────────────────────────────────────────────
export function QuickProductSearchAdd({
  products,
  onAddProduct,
  placeholder = "Quick Search SKU or Product Name to add… (↑↓ Enter Esc)",
  className = "",
}: {
  products: BaseProduct[];
  onAddProduct: (product: BaseProduct) => void;
  placeholder?: string;
  className?: string;
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          (p.brand && p.brand.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [products, search]);

  useEffect(() => { setActiveIdx(-1); }, [matches]);

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIsOpen(true); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const item = matches[activeIdx];
      if (activeIdx >= 0 && item) {
        onAddProduct(item);
        setSearch("");
        setIsOpen(false);
        inputRef.current?.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => { if (search.trim()) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full text-xs py-1.5 pl-3 pr-7 rounded-lg border border-line bg-surface text-ink shadow-2xs focus:outline-hidden focus:border-accent"
        />
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); setIsOpen(false); inputRef.current?.focus(); }}
            className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold"
          >
            &#x2715;
          </button>
        )}
      </div>
      {isOpen && search.trim() && (
        <div ref={listRef} className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-line rounded-lg shadow-2xl max-h-56 overflow-y-auto divide-y divide-line/40">
          {matches.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted">No matching products for &quot;{search}&quot;</div>
          ) : (
            matches.map((p, idx) => {
              const isActive = idx === activeIdx;
              return (
                <div
                  key={p.id}
                  onClick={() => { onAddProduct(p); setSearch(""); setIsOpen(false); inputRef.current?.focus(); }}
                  className={`p-2 cursor-pointer transition-colors flex items-center justify-between text-xs group ${isActive ? "bg-accent/20 ring-1 ring-inset ring-accent/50" : "hover:bg-accent/10"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink group-hover:text-accent truncate">{p.name}</div>
                    <div className="text-[10px] text-muted flex items-center gap-2 mt-0.5">
                      <span className="font-mono bg-surface-2 px-1 rounded border border-line">{p.sku}</span>
                      {p.category && <span>{p.category}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <span className="badge bg-accent text-white text-[10px] font-semibold py-0.5 px-1.5 group-hover:scale-105 transition-transform">+ Add</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Customer Select ──────────────────────────────────────────────────────────
export type BaseCustomer = {
  id: string;
  shopName: string;
  ownerName?: string | null;
  mobile?: string | null;
  gstin?: string | null;
  address?: string | null;
  type?: string | null;
};

export function SearchableCustomerSelect({
  customers,
  selectedId,
  onSelect,
  placeholder = "Search or select customer…",
  allowCashOption = true,
  isCashSelected = false,
  onSelectCash,
  onNewCustomer,
  disabled = false,
  className = "",
}: {
  customers: BaseCustomer[];
  selectedId: string;
  onSelect: (customer: BaseCustomer | null) => void;
  placeholder?: string;
  allowCashOption?: boolean;
  isCashSelected?: boolean;
  onSelectCash?: () => void;
  onNewCustomer?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  // -2 = nothing, -1 = Cash/Walk-in option, >= 0 = customer index
  const [activeIdx, setActiveIdx] = useState(allowCashOption ? -1 : 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedId),
    [customers, selectedId]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase().trim();
    return customers.filter(
      (c) =>
        c.shopName.toLowerCase().includes(q) ||
        (c.ownerName && c.ownerName.toLowerCase().includes(q)) ||
        (c.mobile && c.mobile.includes(q)) ||
        (c.gstin && c.gstin.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
    );
  }, [customers, search]);

  useEffect(() => {
    setActiveIdx(allowCashOption ? -1 : filtered.length > 0 ? 0 : -2);
  }, [filtered, isOpen, allowCashOption]);

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function close() {
    setIsOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    const minIdx = allowCashOption ? -1 : 0;
    const maxIdx = filtered.length - 1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, maxIdx));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, minIdx));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx === -1 && allowCashOption) {
        if (onSelectCash) onSelectCash();
        else onSelect(null);
        close();
      } else {
        const item = filtered[activeIdx];
        if (activeIdx >= 0 && item) {
          onSelect(item);
          close();
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full py-1.5 px-2.5 rounded border border-line bg-surface text-ink text-xs font-medium text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <div className="truncate pr-2">
          {isCashSelected ? (
            <div className="flex items-center gap-1.5">
              <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-bold">
                💵 CASH / WALK-IN
              </span>
              <span className="font-semibold text-ink">Cash Customer (Unlisted)</span>
            </div>
          ) : selectedCustomer ? (
            <div className="flex items-center gap-1.5 truncate">
              <span className="font-semibold text-ink truncate">{selectedCustomer.shopName}</span>
              {selectedCustomer.ownerName && (
                <span className="text-muted text-[11px] truncate">({selectedCustomer.ownerName})</span>
              )}
              {selectedCustomer.mobile && (
                <span className="text-muted font-mono text-[10px] shrink-0">{selectedCustomer.mobile}</span>
              )}
            </div>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted text-[10px] shrink-0">
          {(selectedId || isCashSelected) && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onSelect(null);
              }}
              className="hover:text-bad px-1 font-bold text-xs"
              title="Clear selection"
            >
              ✕
            </span>
          )}
          <span>{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-line rounded-lg shadow-2xl overflow-hidden min-w-[300px] sm:min-w-[360px]">
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search customer, owner, mobile, GSTIN… (↑↓ Enter Esc)"
                className="w-full text-xs py-1.5 pl-7 pr-6 rounded border border-line bg-surface text-ink focus:outline-hidden focus:border-accent"
              />
              <span className="absolute left-2 top-1.5 text-muted text-xs">🔍</span>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-muted px-0.5">
              <span>{filtered.length} customers listed</span>
              <span className="opacity-60">↑↓ navigate · Enter select · Esc close</span>
              {onNewCustomer && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onNewCustomer();
                  }}
                  className="text-accent font-semibold hover:underline"
                >
                  + Add Customer
                </button>
              )}
            </div>
          </div>

          {allowCashOption && (
            <div
              role="option"
              aria-selected={isCashSelected}
              onClick={() => {
                if (onSelectCash) onSelectCash();
                else onSelect(null);
                close();
              }}
              className={`p-2.5 cursor-pointer border-b border-line/60 transition-colors flex items-center justify-between text-xs ${
                activeIdx === -1
                  ? "bg-amber-500/20 ring-1 ring-inset ring-amber-500/50"
                  : isCashSelected
                  ? "bg-amber-100/50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-semibold"
                  : "hover:bg-amber-50 dark:hover:bg-amber-950/20 text-ink"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">💵</span>
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    Cash Customer / Walk-in Sale
                    {isCashSelected && <span className="text-amber-700 text-xs">✓</span>}
                  </div>
                  <div className="text-[10px] text-muted">
                    For unlisted retail/walk-in customers or direct counter returns
                  </div>
                </div>
              </div>
              <span className="badge bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[10px] font-bold">
                CASH
              </span>
            </div>
          )}

          <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">
                <div>No registered customers found matching &quot;{search}&quot;</div>
                {allowCashOption && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectCash) onSelectCash();
                      else onSelect(null);
                      close();
                    }}
                    className="mt-1 text-accent underline text-xs font-medium block mx-auto"
                  >
                    Select as Cash / Walk-in Customer instead
                  </button>
                )}
              </div>
            ) : (
              filtered.map((c, idx) => {
                const isSelected = !isCashSelected && c.id === selectedId;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={c.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelect(c);
                      close();
                    }}
                    className={`p-2.5 cursor-pointer transition-colors flex items-center justify-between text-xs gap-2 ${
                      isActive
                        ? "bg-accent/20 ring-1 ring-inset ring-accent/50"
                        : isSelected
                        ? "bg-accent/10 border-l-2 border-accent text-ink font-semibold"
                        : "hover:bg-surface-2 text-ink"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink flex items-center gap-1.5 truncate">
                        <span className="truncate">{c.shopName}</span>
                        {isSelected && <span className="text-accent text-xs">✓</span>}
                        {c.type && (
                          <span className="badge text-[9px] py-0 px-1 bg-surface-2 text-muted uppercase">
                            {c.type}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted flex flex-wrap items-center gap-2 mt-0.5">
                        {c.ownerName && <span>Owner: {c.ownerName}</span>}
                        {c.mobile && <span className="font-mono">📱 {c.mobile}</span>}
                        {c.gstin && <span className="font-mono">GST: {c.gstin}</span>}
                      </div>
                      {c.address && (
                        <div className="text-[10px] text-muted truncate mt-0.5 opacity-80">
                          📍 {c.address}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
