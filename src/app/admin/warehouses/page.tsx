"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";

type Warehouse = { id: string; name: string; code: string; address: string | null; active: boolean };

export default function WarehousesPage() {
  const { data, error: loadError, loading, reload: load } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const list = data ?? [];
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const res = await fetch("/api/admin/warehouses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, address: address || undefined }),
    });
    if (!res.ok) return setError("Could not create warehouse");
    setName("");
    setCode("");
    setAddress("");
    load();
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
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Warehouses</h1>
      {loadError && <ErrorRetry message={loadError} onRetry={load} />}
      <div className="card flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={!name || !code} onClick={create}>
          Add Warehouse
        </button>
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Address</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td>{w.code}</td>
                <td>{w.address}</td>
                <td>{w.active ? "Active" : "Inactive"}</td>
                <td>
                  <button className="text-accent" onClick={() => toggleActive(w)}>
                    {w.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
