"use client";

import { useState, useMemo } from "react";
import { readError, type ApiError } from "@/lib/read-error";
import { ErrorNote } from "@/components/ErrorNote";

export type AdjustProductUnit = {
  unitId: string;
  unit?: { symbol: string; name?: string } | null;
  factorToBase: string | number;
  barcode?: string | null;
  wholesalePrice?: string | number | null;
};

export type AdjustProductItem = {
  id: string;
  sku: string;
  name: string;
  category?: string;
  baseUnit: {
    id?: string;
    symbol: string;
    name?: string;
  };
  onHand: number;
  costPrice?: number;
  wholesalePrice?: number;
  saleUnits?: AdjustProductUnit[];
  warehouseBreakdown?: Array<{
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    onHand: number;
    reserved: number;
    available: number;
  }>;
};

export function UnitStockAdjustModal({
  product,
  warehouses,
  selectedWarehouseId,
  onClose,
  onSaved,
}: {
  product: AdjustProductItem;
  warehouses: Array<{ id: string; name: string; code: string }>;
  selectedWarehouseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Determine active warehouse ID to adjust
  const defaultWh =
    selectedWarehouseId ||
    product.warehouseBreakdown?.[0]?.warehouseId ||
    warehouses[0]?.id ||
    "";
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(defaultWh);

  // Get current on-hand for selected warehouse
  const currentWhOnHand = useMemo(() => {
    if (product.warehouseBreakdown && product.warehouseBreakdown.length > 0) {
      const found = product.warehouseBreakdown.find(
        (w) => w.warehouseId === targetWarehouseId
      );
      if (found) return found.onHand;
    }
    return product.onHand;
  }, [product, targetWarehouseId]);

  // Adjustment mode: "COUNT" (Set exact physical on-hand) vs "DELTA" (Add/Deduct units)
  const [mode, setMode] = useState<"COUNT" | "DELTA">("COUNT");

  // Units list: Base unit + Sale units
  const unitsList = useMemo(() => {
    const list: Array<{
      key: string;
      symbol: string;
      name: string;
      factor: number;
      isBase: boolean;
    }> = [
      {
        key: "base",
        symbol: product.baseUnit.symbol,
        name: product.baseUnit.name || "Base Unit",
        factor: 1,
        isBase: true,
      },
    ];

    if (product.saleUnits) {
      for (const su of product.saleUnits) {
        const factor = Number(su.factorToBase);
        if (factor && factor !== 1) {
          list.push({
            key: su.unitId,
            symbol: su.unit?.symbol || "Unit",
            name: su.unit?.name || `×${factor}`,
            factor,
            isBase: false,
          });
        }
      }
    }

    return list;
  }, [product]);

  // State for quantities entered per unit
  const [unitInputs, setUnitInputs] = useState<Record<string, string>>({});
  const [movementType, setMovementType] = useState<
    "MANUAL_ADJUSTMENT" | "STOCK_COUNT_ADJUSTMENT" | "DAMAGE" | "EXPIRY"
  >("MANUAL_ADJUSTMENT");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Compute calculated base units and delta
  const calculated = useMemo(() => {
    let totalBaseUnits = 0;
    const breakdown: Array<{ symbol: string; count: number; baseQty: number }> = [];

    for (const u of unitsList) {
      const val = parseFloat(unitInputs[u.key] || "0");
      if (!isNaN(val) && val !== 0) {
        const inBase = val * u.factor;
        totalBaseUnits += inBase;
        breakdown.push({
          symbol: u.symbol,
          count: val,
          baseQty: inBase,
        });
      }
    }

    let finalOnHand = 0;
    let netDelta = 0;

    if (mode === "COUNT") {
      finalOnHand = totalBaseUnits;
      netDelta = finalOnHand - currentWhOnHand;
    } else {
      netDelta = totalBaseUnits;
      finalOnHand = Math.max(0, currentWhOnHand + netDelta);
    }

    return {
      totalInputBaseUnits: totalBaseUnits,
      finalOnHand,
      netDelta,
      breakdown,
    };
  }, [unitsList, unitInputs, mode, currentWhOnHand]);

  async function handleSave() {
    setError(null);

    if (calculated.netDelta === 0) {
      setError({ message: "No change detected in stock quantity." });
      return;
    }

    if (calculated.finalOnHand < 0) {
      setError({ message: "Stock quantity cannot be less than zero." });
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          warehouseId: targetWarehouseId,
          countedQty: calculated.finalOnHand,
          expectedOnHand: currentWhOnHand,
          movementType,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        setSaving(false);
        setError(await readError(res, "Could not adjust stock"));
        return;
      }

      setSaving(false);
      onSaved();
      onClose();
    } catch (err: any) {
      setSaving(false);
      setError({ message: err.message || "Failed to submit stock adjustment" });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg space-y-4 bg-surface border border-line shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-2.5">
          <div>
            <h2 className="text-base font-bold text-ink">
              ⚖️ Direct Inventory Adjustment by Units
            </h2>
            <div className="text-xs text-muted">
              <span className="font-mono text-accent font-semibold">{product.sku}</span> — {product.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink font-bold text-sm p-1"
          >
            ✕
          </button>
        </div>

        {/* Hub / Warehouse Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded bg-surface-2 border border-line text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-muted">Hub / Warehouse:</span>
            {warehouses.length > 1 ? (
              <select
                value={targetWarehouseId}
                onChange={(e) => {
                  setTargetWarehouseId(e.target.value);
                  setUnitInputs({});
                }}
                className="py-1 px-2 rounded border border-line bg-surface text-ink font-semibold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-bold text-ink">
                {warehouses[0]?.name || "Default Hub"}
              </span>
            )}
          </div>
          <div className="font-mono text-right">
            <span className="text-muted">Current On-Hand: </span>
            <strong className="text-ink text-sm">
              {currentWhOnHand.toLocaleString()} {product.baseUnit.symbol}
            </strong>
          </div>
        </div>

        {/* Adjustment Mode Selector */}
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <button
            onClick={() => {
              setMode("COUNT");
              setUnitInputs({});
            }}
            className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold transition-all ${
              mode === "COUNT"
                ? "bg-accent text-white shadow-xs"
                : "bg-surface-2 text-ink hover:bg-surface-hi border border-line"
            }`}
          >
            📋 Set Physical On-Hand
          </button>
          <button
            onClick={() => {
              setMode("DELTA");
              setUnitInputs({});
            }}
            className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold transition-all ${
              mode === "DELTA"
                ? "bg-accent text-white shadow-xs"
                : "bg-surface-2 text-ink hover:bg-surface-hi border border-line"
            }`}
          >
            ➕ / ➖ Add or Deduct by Units
          </button>
        </div>

        {/* Multi-Unit Inputs Grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-semibold text-ink">
              {mode === "COUNT" ? "Enter quantities physically counted:" : "Enter adjustment quantity:"}
            </span>
            <span>All units auto-convert to {product.baseUnit.symbol}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
            {unitsList.map((u) => (
              <div
                key={u.key}
                className="p-2 rounded bg-surface-2 border border-line flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-bold text-xs text-ink">{u.symbol}</div>
                  <div className="text-[10px] text-muted">
                    {u.isBase ? "Base Unit" : `1 ${u.symbol} = ${u.factor} ${product.baseUnit.symbol}`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    placeholder={mode === "COUNT" ? "0" : "±0"}
                    value={unitInputs[u.key] ?? ""}
                    onChange={(e) =>
                      setUnitInputs((prev) => ({
                        ...prev,
                        [u.key]: e.target.value,
                      }))
                    }
                    className="w-24 text-right py-1 px-2 text-xs font-mono rounded border border-line bg-surface text-ink font-bold"
                  />
                  <span className="text-xs text-muted font-mono">{u.symbol}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Calculation & Live Impact Summary */}
        <div className="p-3 rounded-lg bg-surface-2 border border-line text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted">Calculated Total Input:</span>
            <span className="font-mono font-bold text-ink">
              {calculated.totalInputBaseUnits.toLocaleString()} {product.baseUnit.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-line/60 pt-1.5">
            <span className="text-muted">New Resulting On-Hand:</span>
            <span className="font-mono font-bold text-sm text-ink">
              {calculated.finalOnHand.toLocaleString()} {product.baseUnit.symbol}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted">Net Movement Impact:</span>
            <span
              className={`font-mono font-bold ${
                calculated.netDelta > 0
                  ? "text-good"
                  : calculated.netDelta < 0
                  ? "text-bad"
                  : "text-muted"
              }`}
            >
              {calculated.netDelta > 0 ? `+${calculated.netDelta}` : calculated.netDelta}{" "}
              {product.baseUnit.symbol}
            </span>
          </div>
        </div>

        {/* Reason / Movement Type & Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-muted text-[11px] mb-1 font-medium">
              Adjustment Reason:
            </label>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as any)}
              className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink"
            >
              <option value="MANUAL_ADJUSTMENT">Manual Stock Correction</option>
              <option value="STOCK_COUNT_ADJUSTMENT">Physical Count Mismatch</option>
              <option value="DAMAGE">Damaged / Broken Stock</option>
              <option value="EXPIRY">Expired Stock Disposal</option>
            </select>
          </div>

          <div>
            <label className="block text-muted text-[11px] mb-1 font-medium">
              Remarks / Notes:
            </label>
            <input
              type="text"
              placeholder="e.g. Rack count mismatch, verified by manager"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full py-1.5 px-2 rounded border border-line bg-surface text-ink"
            />
          </div>
        </div>

        <ErrorNote error={error} />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={onClose}
            className="btn text-xs py-1.5 px-3"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || calculated.netDelta === 0}
            className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs"
          >
            {saving ? "Updating Stock…" : "Confirm Unit Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
