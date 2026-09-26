"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type InventoryMove = {
  id: string;
  movementType: "DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT" | "TRANSFER_IN";
  referenceType?: string | null;
  movementQty: number;
  beforeQty: number;
  afterQty: number;
  referenceId: string | null;
  timestamp: string;
  product: { id: string; name: string; sku: string; baseUnit: { symbol: string } };
  user: { name: string; staffId: string };
  warehouse: { name: string; code: string };
};

type Product = {
  id: string;
  name: string;
  sku: string;
  baseUnit?: { symbol: string };
  available?: number | null;
};

export default function InventoryOutwardAndReturnsPage() {
  const { data, loading, error, reload } = useApiGet<InventoryMove[]>("/api/inventory/outward");
  const { data: products } = useApiGet<Product[]>("/api/products");

  // Modal states
  const [modalMode, setModalMode] = useState<"INWARD_RETURN" | "OUTWARD_ISSUE" | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<"DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT">("RETURN");
  const [customerName, setCustomerName] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter & Search states
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const selectedProduct = products?.find((p) => p.id === productId);

  function openInwardReturnModal() {
    setModalMode("INWARD_RETURN");
    setMovementType("RETURN");
    setProductId("");
    setQuantity("1");
    setCustomerName("");
    setOrderReference("");
    setReason("");
    setFormError(null);
  }

  function openOutwardIssueModal() {
    setModalMode("OUTWARD_ISSUE");
    setMovementType("DAMAGE");
    setProductId("");
    setQuantity("1");
    setCustomerName("");
    setOrderReference("");
    setReason("");
    setFormError(null);
  }

  function closeModal() {
    setModalMode(null);
    setFormError(null);
  }

  async function handleSubmitMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      return setFormError("Please select a product SKU");
    }
    const numQty = parseFloat(quantity);
    if (isNaN(numQty) || numQty <= 0) {
      return setFormError("Please enter a valid positive quantity");
    }
    if (!reason.trim()) {
      return setFormError("Mandatory reason/remarks is required");
    }

    setSaving(true);
    setFormError(null);

    const isCustomerReturn = modalMode === "INWARD_RETURN";

    const payload = {
      productId,
      quantity: numQty,
      direction: isCustomerReturn ? "INWARD" : "OUTWARD",
      movementType: isCustomerReturn ? "RETURN" : movementType,
      customerName: isCustomerReturn ? customerName.trim() || undefined : undefined,
      orderReference: isCustomerReturn ? orderReference.trim() || undefined : undefined,
      reason: reason.trim(),
    };

    const res = await fetch("/api/inventory/outward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(b.error || "Failed to process inventory movement");
    }

    closeModal();
    reload();
  }

  const filteredMoves = useMemo(() => {
    let result = data ?? [];

    if (typeFilter !== "ALL") {
      if (typeFilter === "CUSTOMER_RETURN") {
        result = result.filter(
          (m) =>
            m.referenceType === "CUSTOMER_RETURN" ||
            (m.movementType === "RETURN" && Number(m.movementQty) > 0)
        );
      } else if (typeFilter === "SUPPLIER_RETURN") {
        result = result.filter(
          (m) =>
            m.movementType === "RETURN" &&
            (m.referenceType === "SUPPLIER_RETURN" || Number(m.movementQty) < 0)
        );
      } else {
        result = result.filter((m) => m.movementType === typeFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) =>
          m.product.name.toLowerCase().includes(q) ||
          m.product.sku.toLowerCase().includes(q) ||
          (m.referenceId && m.referenceId.toLowerCase().includes(q)) ||
          m.user.name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [data, typeFilter, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            Inventory Issue & Customer Returns Log
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary text-xs font-semibold px-3.5 py-1.5 flex items-center gap-1.5 shadow-sm bg-emerald-700 hover:bg-emerald-800 text-white"
            onClick={openInwardReturnModal}
          >
            <span>📥</span>
            <span>+ Inward Customer Return</span>
          </button>
          <button
            className="btn-secondary text-xs font-semibold px-3.5 py-1.5 flex items-center gap-1.5 shadow-xs border-line text-ink"
            onClick={openOutwardIssueModal}
          >
            <span>📤</span>
            <span>+ Record Outward Issue</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-surface-2/70 p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search SKU, name, customer, remarks…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input text-xs w-full py-1.5 pl-7 pr-2"
            />
            <span className="absolute left-2.5 top-2 text-muted text-xs">🔍</span>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setTypeFilter("ALL")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                typeFilter === "ALL"
                  ? "bg-accent text-white"
                  : "bg-surface text-ink hover:bg-surface-hi border border-line"
              }`}
            >
              All Movements
            </button>
            <button
              onClick={() => setTypeFilter("CUSTOMER_RETURN")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                typeFilter === "CUSTOMER_RETURN"
                  ? "bg-emerald-700 text-white"
                  : "bg-surface text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border border-line"
              }`}
            >
              📥 Customer Returns
            </button>
            <button
              onClick={() => setTypeFilter("DAMAGE")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                typeFilter === "DAMAGE"
                  ? "bg-rose-700 text-white"
                  : "bg-surface text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border border-line"
              }`}
            >
              ⚠️ Damaged Goods
            </button>
            <button
              onClick={() => setTypeFilter("EXPIRY")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                typeFilter === "EXPIRY"
                  ? "bg-amber-700 text-white"
                  : "bg-surface text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 border border-line"
              }`}
            >
              ⏳ Expired Goods
            </button>
            <button
              onClick={() => setTypeFilter("SUPPLIER_RETURN")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                typeFilter === "SUPPLIER_RETURN"
                  ? "bg-purple-700 text-white"
                  : "bg-surface text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/20 border border-line"
              }`}
            >
              ↩️ Supplier Returns
            </button>
          </div>
        </div>

        <button
          onClick={reload}
          className="btn text-xs px-2.5 py-1.5 font-medium flex items-center gap-1"
          title="Refresh table"
        >
          🔄
        </button>
      </div>

      {loading && <SkeletonTable rows={6} cols={7} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {/* Modal: Customer Return OR Outward Issue */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fadeIn"
          onClick={closeModal}
        >
          <div
            className="card w-full max-w-lg space-y-4 shadow-2xl border-line"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-line pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">
                    {modalMode === "INWARD_RETURN" ? "📥" : "📤"}
                  </span>
                  <h2 className="text-base font-bold text-ink">
                    {modalMode === "INWARD_RETURN"
                      ? "Record Inward Customer Return"
                      : "Record Outward Inventory Issue"}
                  </h2>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {modalMode === "INWARD_RETURN"
                    ? "Add returned goods back into active inventory stock."
                    : "Deduct damaged, expired, or returned stock from active inventory."}
                </p>
              </div>
              <button
                className="text-muted hover:text-ink text-lg px-2 py-0.5 rounded hover:bg-surface-2 transition-colors"
                onClick={closeModal}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-bad/10 text-bad border border-bad/20 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmitMovement} className="space-y-3.5 text-xs">
              {/* Product SKU Selector */}
              <div>
                <label className="mb-1 block font-semibold text-ink">
                  Select Product SKU <span className="text-rose-500">*</span>
                </label>
                <select
                  className="input w-full font-medium"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  required
                >
                  <option value="">Choose product from catalog…</option>
                  {products?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
                {selectedProduct && (
                  <p className="text-[11px] text-muted mt-1 font-mono">
                    Selected Unit: {selectedProduct.baseUnit?.symbol || "Units"}
                  </p>
                )}
              </div>

              {/* Inward / Outward Specific Fields */}
              {modalMode === "INWARD_RETURN" ? (
                <div className="space-y-3 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-lg border border-emerald-500/20">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block font-semibold text-ink">
                        Customer Name / Store
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Metro Mart / Ramesh"
                        className="input w-full"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-ink">
                        Invoice / Order Ref No.
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. ORD-2026-0042"
                        className="input w-full"
                        value={orderReference}
                        onChange={(e) => setOrderReference(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold text-ink">
                      Return Quantity to Add <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="input w-full font-mono font-bold text-sm"
                      placeholder="e.g. 5"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      required
                    />
                    <p className="text-[10px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                      ✓ This will be credited directly to on-hand inventory.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 bg-surface-2/40 p-3 rounded-lg border border-line">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block font-semibold text-ink">
                        Outward Category <span className="text-rose-500">*</span>
                      </label>
                      <select
                        className="input w-full font-medium"
                        value={movementType}
                        onChange={(e) => setMovementType(e.target.value as any)}
                      >
                        <option value="DAMAGE">⚠️ Damaged Goods</option>
                        <option value="EXPIRY">⏳ Expired Stock</option>
                        <option value="RETURN">↩️ Supplier Return</option>
                        <option value="TRANSFER_OUT">🚚 Inter-FC Transfer</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block font-semibold text-ink">
                        Quantity to Deduct <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="input w-full font-mono font-bold text-sm"
                        placeholder="e.g. 5"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Mandatory Reason */}
              <div>
                <label className="mb-1 block font-semibold text-ink">
                  Mandatory Reason / Audit Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder={
                    modalMode === "INWARD_RETURN"
                      ? "e.g. Customer returned unopened surplus stock with original packing"
                      : "e.g. Broken glass bottle during forklift movement in Aisle 3"
                  }
                  className="input w-full"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  className="btn-secondary text-xs px-3.5 py-1.5"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn font-semibold text-xs px-4 py-1.5 text-white ${
                    modalMode === "INWARD_RETURN"
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "btn-primary"
                  }`}
                  disabled={saving}
                >
                  {saving
                    ? "Processing…"
                    : modalMode === "INWARD_RETURN"
                    ? "✓ Confirm Inward Customer Return"
                    : "✓ Confirm Outward Deduction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movements Table */}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2.5">Date & Time</th>
                <th className="py-2.5">Product SKU</th>
                <th className="py-2.5">Movement Type</th>
                <th className="py-2.5">Quantity Change</th>
                <th className="py-2.5">Stock After Move</th>
                <th className="py-2.5">Reason & Customer Info</th>
                <th className="py-2.5">Hub / Warehouse</th>
                <th className="py-2.5">Logged By</th>
              </tr>
            </thead>
            <tbody>
              {filteredMoves.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted text-xs">
                    No inventory movements found matching the current filter.
                  </td>
                </tr>
              ) : (
                filteredMoves.map((m) => {
                  const numQty = Number(m.movementQty);
                  const isInward =
                    numQty > 0 || m.referenceType === "CUSTOMER_RETURN";

                  return (
                    <tr
                      key={m.id}
                      className="border-b border-line/50 hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="py-2.5 text-muted font-mono whitespace-nowrap">
                        {fmtTime(m.timestamp)}
                      </td>
                      <td className="py-2.5 font-medium">
                        <div className="font-semibold text-ink">{m.product.name}</div>
                        <div className="text-[10px] text-muted font-mono">{m.product.sku}</div>
                      </td>
                      <td className="py-2.5">
                        {isInward ? (
                          <span className="badge text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            📥 CUSTOMER RETURN
                          </span>
                        ) : m.movementType === "DAMAGE" ? (
                          <span className="badge text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                            ⚠️ DAMAGE
                          </span>
                        ) : m.movementType === "EXPIRY" ? (
                          <span className="badge text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            ⏳ EXPIRY
                          </span>
                        ) : m.movementType === "RETURN" ? (
                          <span className="badge text-[11px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                            ↩️ SUPPLIER RETURN
                          </span>
                        ) : (
                          <span className="badge text-[11px] font-semibold bg-surface-2 text-ink border border-line">
                            🚚 {m.movementType}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-bold font-mono">
                        {isInward ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{Math.abs(numQty).toFixed(2)} {m.product.baseUnit.symbol}
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-400">
                            -{Math.abs(numQty).toFixed(2)} {m.product.baseUnit.symbol}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-medium font-mono">
                        {Number(m.afterQty).toFixed(2)} {m.product.baseUnit.symbol}
                      </td>
                      <td className="py-2.5 text-xs text-ink max-w-xs">
                        {m.referenceId || "—"}
                      </td>
                      <td className="py-2.5 text-muted font-mono text-[11px]">
                        {m.warehouse.name} ({m.warehouse.code})
                      </td>
                      <td className="py-2.5 text-muted text-[11px]">
                        {m.user.name}{" "}
                        <span className="font-mono text-[10px]">({m.user.staffId})</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
