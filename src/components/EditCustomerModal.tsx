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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-ink">Edit {customer.shopName}</h2>
            <p className="text-[11px] text-muted">Update customer details, credit limits & ledger adjustments</p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-hi hover:text-ink transition-colors"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Content */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-ink">Shop / Business Name</label>
              <input
                className="w-full"
                placeholder="e.g. Ramesh Kirana Store"
                value={form.shopName}
                onChange={(e) => setForm({ ...form, shopName: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Customer / Owner Name</label>
              <input
                className="w-full"
                placeholder="e.g. Ramesh Kumar"
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-ink">Mobile Number</label>
              <input
                className="w-full font-mono"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">GSTIN</label>
              <input
                className="w-full font-mono uppercase"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                maxLength={15}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-ink">Address</label>
            <input
              className="w-full"
              placeholder="Shop address, market, or city"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-semibold text-ink">Customer Type</label>
              <select
                className="w-full"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="WHOLESALE">WHOLESALE</option>
                <option value="RETAIL">RETAIL</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Account Status</label>
              <select
                className="w-full"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Credit limit (₹)</label>
              <input
                className="w-full font-mono"
                placeholder="No limit"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-ink">Internal Notes</label>
            <input
              className="w-full"
              placeholder="Any remarks about payment terms or preferences"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Ledger / Credit Adjustment Section */}
          <div className="rounded-lg border border-line bg-surface-hi/30 p-3.5 space-y-2.5">
            <h3 className="text-xs font-bold text-ink uppercase tracking-wide">Credit & Balance Status</h3>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="rounded bg-paper px-2.5 py-1 border border-line">
                Limit: <strong className="text-ink font-mono">{limit === null ? "No limit" : `₹${limit.toFixed(2)}`}</strong>
              </span>
              <span className="rounded bg-paper px-2.5 py-1 border border-line">
                To collect: <strong className={`font-mono ${available !== null && available < 0 ? "text-bad font-bold" : "text-ink"}`}>₹{outstanding.toFixed(2)}</strong>
              </span>
              <span className="rounded bg-paper px-2.5 py-1 border border-line">
                Available:{" "}
                <strong className={`font-mono ${available !== null && available < 0 ? "text-bad font-bold" : "text-good"}`}>
                  {available === null ? "—" : `₹${available.toFixed(2)}`}
                </strong>
              </span>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              Adjust balance for outside settlements or opening dues. Use a negative amount (e.g. <code>-500</code>) to reduce dues.
            </p>
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="w-28 min-w-[100px]">
                <label className="mb-1 block text-[11px] font-semibold text-muted">Amount ₹ (− reduces)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full font-mono"
                  placeholder="e.g. -250"
                  value={adjust.amount}
                  onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })}
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="mb-1 block text-[11px] font-semibold text-muted">Reason (required)</label>
                <input
                  className="w-full"
                  placeholder="e.g. settled in cash at the shop"
                  value={adjust.reason}
                  onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="btn px-3 py-1.5 text-xs font-semibold"
                disabled={saving || !adjust.amount || !adjust.reason.trim()}
                onClick={applyAdjustment}
              >
                Apply Adjustment
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-hi/40 px-5 py-3">
          <button
            type="button"
            className="btn px-4 py-2 text-xs font-medium"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary px-4 py-2 text-xs font-bold shadow-sm"
            disabled={saving || !form.shopName.trim() || (!!form.mobile.trim() && form.mobile.trim().length < 6)}
            onClick={save}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
