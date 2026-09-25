"use client";

import { useState } from "react";
import { ErrorNote } from "@/components/ErrorNote";

export type EditableCustomer = {
  id: string;
  shopName: string;
  ownerName: string | null;
  mobile: string | null;
  address?: string | null;
  gstin?: string | null;
  type: string;
  status: string;
  notes?: string | null;
  creditLimit: string | null;
  outstandingBalance: string;
};

/**
 * Edit a customer's details, and move their balance.
 *
 * The two halves are deliberately separate: the details are a plain PATCH,
 * while a balance move is a POST that writes an audited reason, because
 * nothing else in the system reconciles a manual adjustment.
 */
export function EditCustomerModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: EditableCustomer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    shopName: customer.shopName,
    ownerName: customer.ownerName ?? "",
    mobile: customer.mobile ?? "",
    address: customer.address ?? "",
    gstin: customer.gstin ?? "",
    type: customer.type,
    status: customer.status,
    notes: customer.notes ?? "",
    creditLimit: customer.creditLimit === null ? "" : String(Number(customer.creditLimit)),
  });
  const [adjust, setAdjust] = useState({ amount: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const limit = customer.creditLimit === null ? null : Number(customer.creditLimit);
  const outstanding = Number(customer.outstandingBalance);
  const available = limit === null ? null : limit - outstanding;

  async function save() {
    setError(null);
    // Only send what changed — an untouched mobile must not trip the route's
    // duplicate check against the customer's own number.
    const body: Record<string, unknown> = {};
    if (form.shopName !== customer.shopName) body.shopName = form.shopName;
    if (form.ownerName !== (customer.ownerName ?? "")) body.ownerName = form.ownerName || null;
    if (form.mobile.trim() !== (customer.mobile ?? "")) body.mobile = form.mobile.trim() || null;
    if (form.address !== (customer.address ?? "")) body.address = form.address || null;
    if (form.gstin !== (customer.gstin ?? "")) body.gstin = form.gstin || null;
    if (form.type !== customer.type) body.type = form.type;
    if (form.status !== customer.status) body.status = form.status;
    if (form.notes !== (customer.notes ?? "")) body.notes = form.notes || null;

    const rawLimit = form.creditLimit.trim();
    const nextLimit = rawLimit === "" ? null : Number(rawLimit);
    if (nextLimit !== null && (!Number.isFinite(nextLimit) || nextLimit < 0)) {
      return setError("Credit limit must be a number, or blank for no limit");
    }
    if (nextLimit !== limit) body.creditLimit = nextLimit;

    if (Object.keys(body).length === 0) return onClose();

    setSaving(true);
    const res = await fetch(`/api/customers/${customer.id}`, {
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

  async function applyAdjustment() {
    const amount = Number(adjust.amount);
    if (!Number.isFinite(amount) || amount === 0) return setError("Enter an amount to adjust by");
    if (!adjust.reason.trim()) return setError("Say why the balance is being adjusted");
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/customers/${customer.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, reason: adjust.reason.trim() }),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Could not adjust the balance");
    }
    setAdjust({ amount: "", reason: "" });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-full w-full max-w-lg space-y-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Edit {customer.shopName}</h2>

        <div>
          <label className="mb-1 block text-xs text-muted">Shop / Customer Name</label>
          <input
            className="w-full"
            value={form.shopName}
            onChange={(e) => setForm({ ...form, shopName: e.target.value, ownerName: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">Mobile</label>
            <input className="w-full" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">GSTIN</label>
            <input className="w-full" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Address</label>
          <input className="w-full" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted">Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="WHOLESALE">WHOLESALE</option>
              <option value="RETAIL">RETAIL</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Credit limit ₹</label>
            <input
              className="w-28"
              placeholder="No limit"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Notes</label>
          <input className="w-full" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="space-y-2 border-t border-line pt-2">
          <h3 className="text-sm font-semibold">Credit</h3>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Limit: <strong>{limit === null ? "No limit" : `₹${limit.toFixed(2)}`}</strong>
            </span>
            <span>
              To collect: <strong className={available !== null && available < 0 ? "text-bad" : undefined}>₹{outstanding.toFixed(2)}</strong>
            </span>
            <span>
              Available:{" "}
              <strong className={available !== null && available < 0 ? "text-bad" : undefined}>
                {available === null ? "—" : `₹${available.toFixed(2)}`}
              </strong>
            </span>
          </div>
          <p className="text-xs text-muted">
            Adjust the balance to collect for something the ledger cannot see — dues written off, money settled
            outside the system, an opening balance. Use a negative amount to reduce what the customer owes. The
            balance never goes below ₹0.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Amount ₹ (− reduces)</label>
              <input
                type="number"
                step="0.01"
                className="w-28"
                value={adjust.amount}
                onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">Reason (required)</label>
              <input
                className="w-full"
                placeholder="e.g. settled in cash at the shop"
                value={adjust.reason}
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
              />
            </div>
            <button className="btn" disabled={saving || !adjust.amount || !adjust.reason.trim()} onClick={applyAdjustment}>
              Adjust
            </button>
          </div>
        </div>

        {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}

        <div className="flex justify-end gap-2 border-t border-line pt-2">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || !form.shopName.trim() || (!!form.mobile.trim() && form.mobile.trim().length < 6)} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
