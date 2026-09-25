"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditUserModal } from "@/components/EditUserModal";

type User = { id: string; staffId: string; name: string; role: string; active: boolean };

// No ADMIN — the route rejects a manager creating or promoting one.
const ROLES = ["MANAGER", "FINANCE", "PROCUREMENT", "INVENTORY", "BILLING", "QC"];

export default function ManagerStaffPage() {
  const { data, error: loadError, loading, reload } = useApiGet<User[]>("/api/admin/users");
  const list = data ?? [];
  const [form, setForm] = useState({ staffId: "", name: "", password: "", role: "FINANCE" });
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<User | null>(null);

  async function create() {
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      return setError(await readError(res, "Could not create user"));
    }
    setForm({ staffId: "", name: "", password: "", role: "FINANCE" });
    reload();
  }

  async function toggleActive(u: User) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    reload();
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Staff</h1>
      {loadError && <ErrorRetry message={loadError} onRetry={reload} />}
      <div className="card flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Staff ID</label>
          <input value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Password</label>
          <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Role</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={!form.staffId.trim() || !form.name.trim() || !form.password} onClick={create}>
          Add Staff
        </button>
        <ErrorNote error={error} />
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Staff ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>{u.staffId}</td>
                <td>{u.name}</td>
                <td>{u.role}</td>
                <td>{u.active ? "Active" : "Inactive"}</td>
                <td className="space-x-3">
                  <button className="text-accent" onClick={() => setEditing(u)}>
                    Edit
                  </button>
                  <button className="text-accent" onClick={() => toggleActive(u)}>
                    {u.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {editing && <EditUserModal user={editing} roles={ROLES} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
