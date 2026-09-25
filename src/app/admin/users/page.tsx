"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditUserModal } from "@/components/EditUserModal";
import { readError } from "@/lib/read-error";

type Warehouse = { id: string; name: string };
type User = {
  id: string;
  staffId: string;
  name: string;
  role: string;
  active: boolean;
  plainPassword?: string | null;
  warehouseId: string | null;
  warehouse: { name: string } | null;
};

const ROLES = ["ADMIN", "MANAGER", "FINANCE", "PROCUREMENT", "INVENTORY", "BILLING", "QC"];

export default function UsersPage() {
  const { data: usersData, error: loadError, loading, reload: load } = useApiGet<User[]>("/api/admin/users");
  const list = usersData ?? [];
  const { data: warehousesData } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const warehouses = warehousesData ?? [];
  const [form, setForm] = useState({ staffId: "", name: "", password: "", role: "FINANCE", warehouseId: "" });
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  
  // Password visibility state per user ID or global
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAllPasswords, setShowAllPasswords] = useState(false);

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShowAll() {
    if (showAllPasswords) {
      setRevealedIds(new Set());
      setShowAllPasswords(false);
    } else {
      setRevealedIds(new Set(list.map((u) => u.id)));
      setShowAllPasswords(true);
    }
  }

  async function copyPassword(id: string, pwd?: string | null) {
    if (!pwd) return;
    try {
      await navigator.clipboard.writeText(pwd);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // fallback
    }
  }

  async function create() {
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, warehouseId: form.role === "ADMIN" ? undefined : form.warehouseId }),
    });
    if (!res.ok) {
      const err = await readError(res, "Could not create user");
      return setError(err.message);
    }
    setForm({ staffId: "", name: "", password: "", role: "FINANCE", warehouseId: "" });
    load();
  }

  async function toggleActive(u: User) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    load();
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">User Credentials & Staff Management</h1>
          <p className="text-xs text-muted">Create portal users, manage warehouse assignments, and inspect/reset login passwords</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleShowAll}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-hi transition-colors flex items-center gap-1.5"
          >
            <span>{showAllPasswords ? "🙈 Hide All Passwords" : "👁️ Reveal All Passwords"}</span>
          </button>
        </div>
      </div>

      {loadError && <ErrorRetry message={loadError} onRetry={load} />}

      {/* Add User Form */}
      <div className="card space-y-3">
        <h2 className="text-xs font-bold text-ink uppercase tracking-wider">➕ Create New User Account</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Staff ID / Username</label>
            <input
              className="input w-full text-xs font-mono"
              placeholder="e.g. FIN-002"
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Full Name</label>
            <input
              className="input w-full text-xs"
              placeholder="e.g. Rahul Sharma"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Password</label>
            <div className="relative flex items-center">
              <input
                type={showFormPassword ? "text" : "password"}
                autoComplete="new-password"
                className="input w-full text-xs pr-8 font-mono"
                placeholder="Login password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowFormPassword(!showFormPassword)}
                className="absolute right-2 text-xs text-muted hover:text-ink"
                title={showFormPassword ? "Hide password" : "Show password"}
              >
                {showFormPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink">Assigned Role</label>
            <select
              className="input w-full text-xs"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {form.role !== "ADMIN" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Assigned Warehouse</label>
              <select
                className="input w-full text-xs"
                value={form.warehouseId}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
              >
                <option value="">Select Warehouse…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-muted pb-2 italic">Global (All Warehouses)</div>
          )}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-line/60">
          {error ? <span className="text-xs text-bad font-medium">{error}</span> : <span />}
          <button
            className="btn-primary text-xs px-4 py-2 font-semibold"
            disabled={!form.staffId.trim() || !form.name.trim() || !form.password || (form.role !== "ADMIN" && !form.warehouseId)}
            onClick={create}
          >
            Create Staff Account
          </button>
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-muted font-semibold">
                <th className="py-2.5 px-3">Staff ID</th>
                <th className="py-2.5 px-3">Full Name</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Password (Plain / Actual)</th>
                <th className="py-2.5 px-3">Warehouse</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {list.map((u) => {
                const isRevealed = showAllPasswords || revealedIds.has(u.id);
                const pwd = u.plainPassword || "password123";
                const isCopied = copiedId === u.id;

                return (
                  <tr key={u.id} className="hover:bg-surface-2/40">
                    <td className="py-2.5 px-3 font-mono font-bold text-ink">{u.staffId}</td>
                    <td className="py-2.5 px-3 font-medium text-ink">{u.name}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`badge text-[10px] font-bold ${
                          u.role === "ADMIN"
                            ? "bg-purple-100 text-purple-800"
                            : u.role === "MANAGER"
                            ? "bg-blue-100 text-blue-800"
                            : u.role === "FINANCE"
                            ? "bg-emerald-100 text-emerald-800"
                            : u.role === "QC"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="inline-flex items-center gap-2 bg-surface-2/70 px-2 py-1 rounded border border-line">
                        <span className={`text-xs ${isRevealed ? "font-bold text-ink" : "text-muted"}`}>
                          {isRevealed ? pwd : "••••••••"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleReveal(u.id)}
                          className="text-muted hover:text-ink text-xs transition-colors"
                          title={isRevealed ? "Hide Password" : "Show Actual Password"}
                        >
                          {isRevealed ? "🙈" : "👁️"}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyPassword(u.id, pwd)}
                          className="text-muted hover:text-ink text-xs transition-colors"
                          title="Copy to Clipboard"
                        >
                          {isCopied ? "✓" : "📋"}
                        </button>
                      </div>
                      {isCopied && <span className="ml-1.5 text-[10px] text-good font-semibold">Copied!</span>}
                    </td>
                    <td className="py-2.5 px-3 text-muted">{u.warehouse?.name ?? "Global / All"}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`badge text-[10px] font-semibold ${
                          u.active ? "bg-good/10 text-good" : "bg-bad/10 text-bad"
                        }`}
                      >
                        {u.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-2">
                      <button
                        className="rounded px-2 py-1 text-xs font-semibold text-accent hover:bg-surface-hi transition-colors"
                        onClick={() => setEditing(u)}
                      >
                        Edit
                      </button>
                      <button
                        className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                          u.active ? "text-bad hover:bg-bad/10" : "text-good hover:bg-good/10"
                        }`}
                        onClick={() => toggleActive(u)}
                      >
                        {u.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditUserModal
          user={editing}
          roles={ROLES}
          warehouses={warehouses}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
