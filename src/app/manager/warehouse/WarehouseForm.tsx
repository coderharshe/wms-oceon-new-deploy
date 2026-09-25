"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonCard } from "@/components/Skeleton";

type Warehouse = { id: string; name: string; code: string; address: string | null; active: boolean };

export function WarehouseForm({ warehouseId }: { warehouseId: string }) {
  const { data, error, loading, reload } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const mine = (data ?? []).find((w) => w.id === warehouseId) ?? null;
  // Seeded from the fetch, then left alone — the hook re-fetches on its own
  // schedule and must not overwrite what is being typed.
  const [form, setForm] = useState({ name: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (mine) setForm({ name: mine.name, address: mine.address ?? "" });
  }, [mine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const res = await fetch(`/api/admin/warehouses/${warehouseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name.trim(), address: form.address.trim() }),
    });
    setSaving(false);
    if (!res.ok) {
      return setSaveError(await readError(res, "Could not save the warehouse"));
    }
    setSaved(true);
    reload();
  }

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorRetry message={error} onRetry={reload} />;
  if (!mine) return <p className="text-sm text-bad">Could not find your warehouse.</p>;

  const dirty = form.name !== mine.name || form.address !== (mine.address ?? "");

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted">Name</label>
          <input className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Code</label>
          {/* Read-only: the code is what stock, bills and staff are filed under. */}
          <input className="w-24" value={mine.code} disabled title="The warehouse code can't be changed — everything filed against it would stop matching" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Address</label>
        <input className="w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Printed on bills" />
      </div>
      <ErrorNote error={saveError} />
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={saving || !dirty || !form.name.trim()} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && <span className="text-sm text-good">Saved</span>}
      </div>
    </div>
  );
}
