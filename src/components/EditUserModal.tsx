"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useState } from "react";

export type EditableUser = {
  id: string;
  staffId: string;
  name: string;
  role: string;
  active: boolean;
  plainPassword?: string | null;
  warehouseId?: string | null;
  theme?: string | null;
  fontFamily?: string | null;
  fontSize?: string | null;
  accentColor?: string | null;
};

// Shared by Admin's Users page and Manager's Staff page — both PATCH
// /api/admin/users/[id]. Managers get a narrower role list and no warehouse
// picker; the route enforces the same limits server-side.
export function EditUserModal({
  user,
  roles,
  warehouses,
  onClose,
  onSaved,
}: {
  user: EditableUser;
  roles: string[];
  warehouses?: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    staffId: user.staffId,
    name: user.name,
    role: user.role,
    active: user.active,
    warehouseId: user.warehouseId ?? "",
    password: "",
    theme: user.theme ?? "default",
    fontFamily: user.fontFamily ?? "inter",
    fontSize: user.fontSize ?? "standard",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    // Only send what actually changed — an untouched password field must not
    // reset the account's password, and a manager sending an unchanged
    // warehouseId would trip the route's cross-warehouse guard.
    const body: Record<string, unknown> = {};
    if (form.staffId !== user.staffId) body.staffId = form.staffId.trim();
    if (form.name !== user.name) body.name = form.name.trim();
    if (form.role !== user.role) body.role = form.role;
    if (form.active !== user.active) body.active = form.active;
    if (warehouses && form.role !== "ADMIN" && form.warehouseId !== (user.warehouseId ?? "")) body.warehouseId = form.warehouseId || null;
    if (form.password) body.password = form.password;
    if (form.theme !== (user.theme ?? "default")) body.theme = form.theme;
    if (form.fontFamily !== (user.fontFamily ?? "inter")) body.fontFamily = form.fontFamily;
    if (form.fontSize !== (user.fontSize ?? "standard")) body.fontSize = form.fontSize;

    if (Object.keys(body).length === 0) {
      setSaving(false);
      return onClose();
    }
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Could not save changes");
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Edit {user.name}</h2>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Staff ID</label>
            <input className="w-full" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Name</label>
            <input className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {(roles.includes(user.role) ? roles : [user.role, ...roles]).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {warehouses && form.role !== "ADMIN" && (
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">Warehouse</label>
              <select className="w-full" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                <option value="">Select…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-1 self-end pb-1.5 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
        </div>

        <div className="border-t border-line pt-2">
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs text-muted">
              {user.plainPassword ? (
                <>Current Password: <span className="font-mono font-bold text-ink">{user.plainPassword}</span></>
              ) : (
                "New Password (leave blank to keep current)"
              )}
            </label>
          </div>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              className="w-full pr-8 font-mono text-xs"
              autoComplete="new-password"
              placeholder="Type new password to override"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 text-xs text-muted hover:text-ink"
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
        </div>

        {/* Visual Styling Preferences */}
        <div className="border-t border-line pt-2 space-y-2">
          <label className="text-xs font-semibold text-ink block">🎨 Visual Theme & Font</label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-muted">Theme</label>
              <select
                className="w-full text-xs"
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value })}
              >
                <option value="default">Default Grey</option>
                <option value="slate">Slate Blue</option>
                <option value="ocean">Ocean Indigo</option>
                <option value="forest">Forest Green</option>
                <option value="emerald">Emerald</option>
                <option value="sunset">Sunset Amber</option>
                <option value="sand">Warm Sand</option>
                <option value="dark">Charcoal Dark</option>
                <option value="midnight">Midnight OLED</option>
                <option value="contrast">High Contrast</option>
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-muted">Font Family</label>
              <select
                className="w-full text-xs"
                value={form.fontFamily}
                onChange={(e) => setForm({ ...form, fontFamily: e.target.value })}
              >
                <option value="inter">Inter</option>
                <option value="outfit">Outfit</option>
                <option value="roboto">Roboto</option>
                <option value="poppins">Poppins</option>
                <option value="mono">JetBrains Mono</option>
                <option value="system">System UI</option>
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-muted">Font Size</label>
              <select
                className="w-full text-xs"
                value={form.fontSize}
                onChange={(e) => setForm({ ...form, fontSize: e.target.value })}
              >
                <option value="sm">Small (15px)</option>
                <option value="standard">Standard (17px)</option>
                <option value="lg">Large (19px)</option>
                <option value="xl">Extra Large (21px)</option>
              </select>
            </div>
          </div>
        </div>

        <ErrorNote error={error} />
        {(form.role !== user.role || form.staffId !== user.staffId || form.active !== user.active) && (
          <p className="text-xs text-muted">Saving this signs {user.name} out — they sign in again to pick up the change.</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={saving || !form.name.trim() || !form.staffId.trim()}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
