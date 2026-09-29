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

/**
 * Searchable Supplier Selector with instant live search
 */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
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
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink text-xs font-medium text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <div className="truncate pr-2">
          {selectedSupplier ? (
            <span className="font-semibold text-ink">
              {selectedSupplier.name}{" "}
              {selectedSupplier.phone && (
                <span className="text-muted font-normal text-[11px]">
                  ({selectedSupplier.phone})
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-muted text-[10px]">
          {selectedId && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onSelect("");
              }}
              className="hover:text-bad px-1 font-bold"
              title="Clear selection"
            >
              ✕
            </span>
          )}
          <span>▼</span>
        </div>
      </button>

      {/* Floating Dropdown */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface border border-line rounded-lg shadow-xl overflow-hidden min-w-[280px]">
          {/* Search Header */}
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, GSTIN…"
                className="w-full text-xs py-1.5 pl-7 pr-2 rounded border border-line bg-surface text-ink focus:outline-hidden focus:border-accent"
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
              <span>{filtered.length} suppliers found</span>
              {onNewSupplier && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onNewSupplier();
                  }}
                  className="text-accent font-semibold hover:underline"
                >
                  + Add New Supplier
                </button>
              )}
            </div>
          </div>

          {/* Supplier Options List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted">
                <div>No suppliers match &quot;{search}&quot;</div>
                {onNewSupplier && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onNewSupplier();
                    }}
                    className="mt-1 text-accent underline text-xs font-medium"
                  >
                    Create new supplier &quot;{search}&quot;
                  </button>
                )}
              </div>
            ) : (
              filtered.map((s) => {
                const isSelected = s.id === selectedId;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      onSelect(s.id);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`p-2 cursor-pointer transition-colors flex items-center justify-between text-xs ${
                      isSelected
                        ? "bg-accent/10 text-accent font-bold"
                        : "hover:bg-surface-2 text-ink"
                    }`}
                  >
                    <div>
                      <div className="font-medium text-ink flex items-center gap-1.5">
                        {s.name}
                        {isSelected && <span className="text-accent text-xs">✓</span>}
                      </div>
                      <div className="text-[10px] text-muted flex items-center gap-2 mt-0.5">
                        {s.phone && <span>📞 {s.phone}</span>}
                        {s.contactPerson && <span>👤 {s.contactPerson}</span>}
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

/**
 * Searchable Product Selector with rich details (SKU, Category, Rate, Unit)
 */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
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
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full py-1 px-2 rounded border border-line bg-surface text-ink text-xs text-left flex items-center justify-between transition-colors hover:border-line-hi focus:outline-hidden focus:ring-1 focus:ring-accent ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <div className="truncate pr-1.5 flex items-center gap-1.5">
          {selectedProduct ? (
            <>
              <span className="font-semibold text-ink truncate">{selectedProduct.name}</span>
              <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-surface-2 text-muted border border-line shrink-0">
                {selectedProduct.sku}
              </span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </div>
        <span className="text-[10px] text-muted shrink-0">▼</span>
      </button>

      {/* Floating Searchable Dropdown */}
      {isOpen && (
        <div className="absolute z-50 left-0 top-full mt-1 w-[320px] sm:w-[380px] bg-surface border border-line rounded-lg shadow-2xl overflow-hidden">
          {/* Search Box Header */}
          <div className="p-2 border-b border-line bg-surface-2/60">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type SKU, product name, barcode, brand…"
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
              <span>
                {loading ? "Loading catalog…" : `${filtered.length} products found`}
              </span>
              <span className="text-[9px] text-muted/80">Click item to select</span>
            </div>
          </div>

          {/* Product Items List */}
          <div className="max-h-60 overflow-y-auto divide-y divide-line/40">
            {filtered.length === 0 ? (
              <div className="p-5 text-center text-xs text-muted">
                {loading ? "Loading product catalog…" : `No products match "${search}"`}
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = p.id === selectedId;
                const unitSymbol = p.baseUnit?.symbol || "unit";
                const price = Number(p.wholesalePrice || 0);

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onSelect(p);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`p-2 cursor-pointer transition-colors flex items-center justify-between text-xs gap-2 ${
                      isSelected
                        ? "bg-accent/10 border-l-2 border-accent"
                        : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink truncate flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {isSelected && <span className="text-accent text-xs">✓</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                        <span className="font-mono bg-surface-2 text-ink px-1 rounded border border-line">
                          {p.sku}
                        </span>
                        {p.category && (
                          <span className="bg-surface-2 text-muted px-1 rounded">
                            {p.category}
                          </span>
                        )}
                        {p.brand && <span>Brand: {p.brand}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-ink text-xs">
                        ₹{price.toFixed(2)}
                      </div>
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
