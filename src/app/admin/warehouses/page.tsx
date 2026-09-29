"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";

type Warehouse = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  active: boolean;
};

export default function WarehousesPage() {
  const { data, error: loadError, loading, reload: load } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const list = data ?? [];

  // Create form state
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Edit Modal State
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // KPI Metrics
  const totalCount = list.length;
  const activeCount = list.filter((w) => w.active).length;
  const inactiveCount = list.filter((w) => !w.active).length;

  const filteredList = list.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.address && w.address.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      filterStatus === "ALL" ||
      (filterStatus === "ACTIVE" && w.active) ||
      (filterStatus === "INACTIVE" && !w.active);

    return matchesSearch && matchesStatus;
  });

  async function create() {
    if (!name.trim() || !code.trim()) return;
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address: address.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message || "Could not create warehouse. Ensure code is unique.");
      }
      setName("");
      setCode("");
      setAddress("");
      setShowAddForm(false);
      load();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create warehouse");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(w: Warehouse) {
    setEditingWarehouse(w);
    setEditName(w.name);
    setEditCode(w.code);
    setEditAddress(w.address || "");
    setEditActive(w.active);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingWarehouse) return;
    if (!editName.trim() || !editCode.trim()) {
      setEditError("Name and Code are required.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/warehouses/${editingWarehouse.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          code: editCode.trim().toUpperCase(),
          address: editAddress.trim() || null,
          active: editActive,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message || "Could not update warehouse details.");
      }

      setEditingWarehouse(null);
      load();
    } catch (err: any) {
      setEditError(err.message || "Failed to update warehouse");
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleActive(w: Warehouse) {
    await fetch(`/api/admin/warehouses/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !w.active }),
    });
    load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <span>🏭</span>
            <span>Warehouses & Dispatch Hubs</span>
          </h1>
          <p className="text-xs text-muted">
            Manage physical branches, dispatch addresses, operational codes, and location statuses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/settings"
            className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 bg-surface text-ink hover:bg-surface-hi border border-line"
          >
            <span>🏢</span>
            <span>Warehouse GST Settings</span>
          </Link>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="btn-primary text-xs py-1.5 px-3.5 flex items-center gap-1.5"
          >
            <span>{showAddForm ? "✕ Close Form" : "+ Add New Warehouse"}</span>
          </button>
        </div>
      </div>

      {loadError && <ErrorRetry message={loadError} onRetry={load} />}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Total Warehouses</div>
            <div className="text-xl font-bold text-ink mt-0.5">{totalCount}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-base">
            🏢
          </div>
        </div>

        <div className="card p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-good uppercase tracking-wider">Active Locations</div>
            <div className="text-xl font-bold text-good mt-0.5">{activeCount}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-good/10 text-good flex items-center justify-center text-base font-semibold">
            ✓
          </div>
        </div>

        <div className="card p-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Inactive Locations</div>
            <div className="text-xl font-bold text-muted mt-0.5">{inactiveCount}</div>
          </div>
          <div className="w-9 h-9 rounded-lg bg-surface-2 text-muted flex items-center justify-center text-base font-semibold">
            ✕
          </div>
        </div>
      </div>

      {/* Add New Warehouse Card */}
      {showAddForm && (
        <div className="card space-y-3 border-2 border-accent/30 bg-accent/5 p-4 rounded-xl">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-sm font-bold text-ink flex items-center gap-2">
              <span>➕</span>
              <span>Register New Warehouse</span>
            </h2>
            <span className="text-[11px] text-muted">All branches require a unique operational code</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">
                Warehouse Name <span className="text-bad">*</span>
              </label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. Delhi Central Hub"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">
                Branch Code <span className="text-bad">*</span>
              </label>
              <input
                className="input w-full text-xs font-mono uppercase"
                placeholder="e.g. WH-DEL-01"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">
                Physical / Dispatch Address
              </label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. Sector 18, Okhla Phase 2, New Delhi"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          </div>

          {createError && (
            <div className="p-2 rounded-lg bg-bad/10 text-bad text-xs font-medium">
              {createError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn text-xs py-1.5 px-3"
              onClick={() => {
                setShowAddForm(false);
                setCreateError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-xs py-1.5 px-4"
              disabled={!name.trim() || !code.trim() || creating}
              onClick={create}
            >
              {creating ? "Creating…" : "Save Warehouse"}
            </button>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <span className="text-muted text-xs">🔍</span>
          <input
            className="input w-full text-xs py-1.5"
            placeholder="Search warehouse by name, code, or address…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-muted hover:text-ink text-xs px-1.5"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted mr-1">Status:</span>
          {(["ALL", "ACTIVE", "INACTIVE"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                filterStatus === st
                  ? "bg-ink text-surface shadow-xs"
                  : "bg-surface-2 text-muted hover:text-ink border border-line"
              }`}
            >
              {st === "ALL" ? "All" : st === "ACTIVE" ? "Active" : "Inactive"}
            </button>
          ))}
        </div>
      </div>

      {/* Warehouses Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : filteredList.length === 0 ? (
        <div className="card p-8 text-center space-y-2">
          <div className="text-3xl">🏬</div>
          <div className="text-sm font-semibold text-ink">No warehouses found</div>
          <p className="text-xs text-muted max-w-sm mx-auto">
            {searchQuery || filterStatus !== "ALL"
              ? "No warehouses match your search query or status filter."
              : "No warehouses are currently registered in the database."}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2/70 text-muted font-semibold uppercase tracking-wider text-[10px] border-b border-line">
                <tr>
                  <th className="py-2.5 px-3.5">Warehouse / Branch</th>
                  <th className="py-2.5 px-3.5">Code</th>
                  <th className="py-2.5 px-3.5">Address</th>
                  <th className="py-2.5 px-3.5">Status</th>
                  <th className="py-2.5 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredList.map((w) => (
                  <tr key={w.id} className="hover:bg-surface-hi/40 transition-colors">
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-ink flex items-center gap-2">
                        <span className="text-sm">🏬</span>
                        <span>{w.name}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">ID: {w.id}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface-2 text-ink border border-line font-bold">
                        {w.code}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 max-w-xs">
                      {w.address ? (
                        <span className="text-ink line-clamp-2">{w.address}</span>
                      ) : (
                        <span className="text-muted italic">No address provided</span>
                      )}
                    </td>
                    <td className="py-3 px-3.5">
                      {w.active ? (
                        <span className="badge bg-good/15 text-good font-semibold">
                          ● Active
                        </span>
                      ) : (
                        <span className="badge bg-bad/15 text-bad font-semibold">
                          ○ Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(w)}
                          className="btn text-xs py-1 px-2.5 flex items-center gap-1 hover:bg-surface-hi text-ink font-medium"
                          title="Edit warehouse details"
                        >
                          <span>✏️</span>
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(w)}
                          className={`btn text-xs py-1 px-2.5 font-medium ${
                            w.active
                              ? "text-bad hover:bg-bad/10"
                              : "text-good hover:bg-good/10"
                          }`}
                          title={w.active ? "Deactivate warehouse" : "Activate warehouse"}
                        >
                          {w.active ? "Deactivate" : "Activate"}
                        </button>
                        <Link
                          href="/admin/settings"
                          className="btn text-xs py-1 px-2 text-muted hover:text-ink"
                          title="Configure GST and branch parameters in Settings"
                        >
                          ⚙️ GST
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Warehouse Modal */}
      {editingWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-lg space-y-4 shadow-xl border border-line animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">✏️</span>
                <div>
                  <h2 className="text-sm font-bold text-ink">Edit Warehouse Details</h2>
                  <p className="text-[11px] text-muted">Update name, code, dispatch address, and status</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingWarehouse(null)}
                className="text-muted hover:text-ink text-sm p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Warehouse Name <span className="text-bad">*</span>
                </label>
                <input
                  className="input w-full text-xs"
                  placeholder="e.g. Mumbai Western Hub"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Branch Code <span className="text-bad">*</span>
                </label>
                <input
                  className="input w-full text-xs font-mono uppercase"
                  placeholder="e.g. WH-MUM-02"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                />
                <p className="text-[10px] text-muted mt-0.5">Unique alphanumeric branch identifier</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Dispatch & Physical Address
                </label>
                <textarea
                  className="input w-full text-xs"
                  rows={3}
                  placeholder="Street, City, State, PIN Code"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editActiveCheckbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  className="rounded border-line text-accent focus:ring-accent"
                />
                <label htmlFor="editActiveCheckbox" className="text-xs font-medium text-ink cursor-pointer">
                  Warehouse is Active for Operations & Billing
                </label>
              </div>

              {editError && (
                <div className="p-2.5 rounded-lg bg-bad/10 text-bad text-xs font-medium">
                  {editError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                className="btn text-xs py-1.5 px-3"
                onClick={() => setEditingWarehouse(null)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs py-1.5 px-4"
                disabled={!editName.trim() || !editCode.trim() || savingEdit}
                onClick={saveEdit}
              >
                {savingEdit ? "Saving Changes…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
