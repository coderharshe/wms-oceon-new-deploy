"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type Unit = {
  id: string;
  name: string;
  symbol: string;
  type: "WEIGHT" | "VOLUME" | "COUNT" | "CUSTOM";
};

export default function InventoryUnitsPage() {
  const { data: unitsData, error, loading, reload } = useApiGet<Unit[]>("/api/admin/units");
  const units = unitsData || [];

  const [form, setForm] = useState<{
    name: string;
    symbol: string;
    type: "WEIGHT" | "VOLUME" | "COUNT" | "CUSTOM";
  }>({
    name: "",
    symbol: "",
    type: "COUNT",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSymbol, setEditSymbol] = useState("");
  const [editType, setEditType] = useState<"WEIGHT" | "VOLUME" | "COUNT" | "CUSTOM">("COUNT");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreateUnit() {
    setFormError(null);
    if (!form.name.trim() || !form.symbol.trim()) {
      setFormError("Both Unit Name and Unit Symbol are required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          symbol: form.symbol.trim(),
          type: form.type,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to create unit");
        setSubmitting(false);
        return;
      }

      setForm({ name: "", symbol: "", type: "COUNT" });
      setSubmitting(false);
      reload();
    } catch (e: any) {
      setSubmitting(false);
      setFormError(e.message || "Network error");
    }
  }

  async function handleUpdateUnit(id: string) {
    setFormError(null);
    if (!editName.trim() || !editSymbol.trim()) return;

    try {
      const res = await fetch(`/api/admin/units/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          symbol: editSymbol.trim(),
          type: editType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to update unit");
        return;
      }

      setEditingId(null);
      reload();
    } catch (e: any) {
      setFormError(e.message || "Network error");
    }
  }

  async function handleDeleteUnit(unit: Unit) {
    if (!confirm(`Are you sure you want to delete unit "${unit.symbol} (${unit.name})"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/units/${unit.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Could not delete unit as it is referenced by existing products or orders.");
        return;
      }

      reload();
    } catch {
      alert("Network error while deleting unit");
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Top Header */}
      <div className="border-b border-line pb-3">
        <h1 className="text-xl font-bold tracking-tight text-ink">Units of Measure (UOM Master)</h1>
        <p className="text-xs text-muted mt-0.5">
          Manage standard measurement units used across inventory tracking, base units, and packaging multipliers.
        </p>
      </div>

      {/* Create New Unit Card */}
      <div className="card space-y-3 bg-surface border border-line">
        <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
          + Add New Measurement Unit
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <label className="block text-muted font-semibold mb-1">Unit Symbol *</label>
            <input
              type="text"
              placeholder="e.g. kg, pcs, box, ltr"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono font-bold"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-muted font-semibold mb-1">Full Unit Name *</label>
            <input
              type="text"
              placeholder="e.g. Kilogram, Pieces, 12-Pack Box"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-medium"
            />
          </div>
          <div>
            <label className="block text-muted font-semibold mb-1">Measurement Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as any })}
              className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-semibold"
            >
              <option value="COUNT">COUNT (Pieces / Units)</option>
              <option value="WEIGHT">WEIGHT (Mass)</option>
              <option value="VOLUME">VOLUME (Liquid / Gas)</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
        </div>

        {formError && <div className="text-bad text-xs font-semibold">{formError}</div>}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleCreateUnit}
            disabled={submitting || !form.name.trim() || !form.symbol.trim()}
            className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs"
          >
            {submitting ? "Saving Unit…" : "Add Unit to Master"}
          </button>
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Units Table */}
      {loading ? (
        <SkeletonTable rows={8} cols={4} />
      ) : (
        <div className="card p-0 overflow-x-auto border border-line">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-muted uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 font-semibold">Symbol</th>
                <th className="py-2.5 px-3 font-semibold">Full Name</th>
                <th className="py-2.5 px-3 font-semibold">Type</th>
                <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {units.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted">
                    No units found.
                  </td>
                </tr>
              ) : (
                units.map((u) => {
                  const isEditing = editingId === u.id;

                  if (isEditing) {
                    return (
                      <tr key={u.id} className="bg-accent/5">
                        <td className="p-2">
                          <input
                            type="text"
                            value={editSymbol}
                            onChange={(e) => setEditSymbol(e.target.value)}
                            className="w-20 py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono font-bold text-xs"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as any)}
                            className="py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs"
                          >
                            <option value="COUNT">COUNT</option>
                            <option value="WEIGHT">WEIGHT</option>
                            <option value="VOLUME">VOLUME</option>
                            <option value="CUSTOM">CUSTOM</option>
                          </select>
                        </td>
                        <td className="p-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleUpdateUnit(u.id)}
                              className="px-2 py-1 text-xs rounded bg-accent text-white font-semibold"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-2 py-1 text-xs rounded bg-surface-2 border border-line"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={u.id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-accent">
                        <span className="badge bg-surface-2 text-ink border border-line font-bold">
                          {u.symbol}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-ink">{u.name}</td>
                      <td className="py-2.5 px-3">
                        <span className="badge text-[10px] bg-surface-2 text-muted border border-line">
                          {u.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setEditingId(u.id);
                              setEditName(u.name);
                              setEditSymbol(u.symbol);
                              setEditType(u.type);
                            }}
                            className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink font-medium"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => handleDeleteUnit(u)}
                            className="px-2 py-1 text-xs rounded text-bad hover:bg-bad/10 border border-bad/20 font-medium"
                            title="Delete unused unit"
                          >
                            Delete
                          </button>
                        </div>
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
