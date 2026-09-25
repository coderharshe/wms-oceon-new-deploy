"use client";

import { useState } from "react";
import { describeHttpError } from "@/lib/http-error";
import { isGstin, stateName, stateCodeOfGstin } from "@/lib/gst";

export type BillableCustomer = {
  id: string;
  shopName: string;
  ownerName: string | null;
  mobile: string | null;
  address: string | null;
  gstin: string | null;
  type: string;
};

/**
 * The customer fields a tax invoice actually prints — nothing else.
 *
 * Deliberately NOT components/EditCustomerModal: that one carries credit
 * limit, account status and manual balance moves, which are a manager's
 * controls and have no business in front of a counter clerk mid-bill (the
 * PATCH route refuses those two from FINANCE anyway).
 *
 * One form serves both jobs. Creating and correcting a customer differ only
 * in the verb and the URL, and most customer records here predate GST billing
 * with no GSTIN or address at all — so the "fill in what's missing" case is
 * the common one, not the exception.
 */
export function CustomerFields({
  existing,
  onDone,
  onCancel,
}: {
  existing?: BillableCustomer;
  onDone: (c: BillableCustomer) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    shopName: existing?.shopName ?? "",
    ownerName: existing?.ownerName ?? "",
    mobile: existing?.mobile ?? "",
    address: existing?.address ?? "",
    gstin: existing?.gstin ?? "",
    type: existing?.type ?? "WHOLESALE",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);

  /**
   * Fill the name and address from the GSTIN, if a lookup provider is set up.
   * Never overwrites something already typed — a clerk who has just entered
   * the shop's working name should not have it replaced by a legal name they
   * did not ask for; empty fields only.
   */
  async function fetchFromGstin() {
    if (gstinBad || !form.gstin.trim()) return setError("Enter a valid GSTIN first");
    setLooking(true);
    setError(null);
    const res = await fetch(`/api/finance/gstin-lookup?gstin=${encodeURIComponent(form.gstin.trim())}`);
    setLooking(false);
    if (!res.ok) return setError(await describeHttpError(res));
    const d = (await res.json()) as { legalName: string | null; tradeName: string | null; address: string | null };
    setForm((f) => ({
      ...f,
      shopName: f.shopName.trim() || d.tradeName || d.legalName || "",
      ownerName: f.ownerName.trim() || (d.tradeName && d.legalName && d.tradeName !== d.legalName ? d.legalName : ""),
      address: f.address.trim() || d.address || "",
    }));
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  // Blank is fine (an unregistered buyer), but a typo must not reach a tax
  // invoice — the state code and PAN printed on it are read off this number.
  const gstinBad = form.gstin.trim() !== "" && !isGstin(form.gstin);

  async function save() {
    if (!form.shopName.trim()) return setError("A shop name is needed");
    if (gstinBad) return setError("That GSTIN is not valid");
    setSaving(true);
    setError(null);

    // PATCH takes only what changed, so an untouched mobile can't trip the
    // route's duplicate-number check against the customer's own number.
    const body: Record<string, unknown> = existing
      ? Object.fromEntries(
          (
            [
              ["shopName", form.shopName.trim(), existing.shopName],
              ["ownerName", form.ownerName.trim() || null, existing.ownerName ?? ""],
              ["mobile", form.mobile.trim() || null, existing.mobile ?? ""],
              ["address", form.address.trim() || null, existing.address ?? ""],
              ["gstin", form.gstin.trim().toUpperCase() || null, existing.gstin ?? ""],
              ["type", form.type, existing.type],
            ] as [string, unknown, string][]
          )
            .filter(([, next, before]) => String(next ?? "") !== String(before ?? ""))
            .map(([k, next]) => [k, next])
        )
      : {
          shopName: form.shopName.trim(),
          ownerName: form.ownerName.trim() || undefined,
          mobile: form.mobile.trim() || undefined,
          address: form.address.trim() || undefined,
          gstin: form.gstin.trim().toUpperCase() || undefined,
          type: form.type,
        };

    if (existing && Object.keys(body).length === 0) {
      setSaving(false);
      return onDone(existing);
    }

    const res = await fetch(existing ? `/api/customers/${existing.id}` : "/api/customers", {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) return setError(await describeHttpError(res));
    onDone((await res.json()) as BillableCustomer);
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs text-muted">Shop / Customer name</span>
          <input
            className="w-full"
            value={form.shopName}
            onChange={(e) => setForm((prev) => ({ ...prev, shopName: e.target.value, ownerName: e.target.value }))}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Mobile</span>
          <input className="w-full" inputMode="tel" value={form.mobile} onChange={set("mobile")} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">GSTIN (blank if unregistered)</span>
          <input
            className="w-full"
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
            placeholder="06AQNPG1418P1ZK"
          />
          <span className="flex items-center gap-2 text-xs text-muted">
            {gstinBad ? <span className="text-bad">Not a valid GSTIN</span> : stateName(stateCodeOfGstin(form.gstin)) || " "}
            {!gstinBad && form.gstin.trim() !== "" && (
              <button type="button" className="underline" disabled={looking} onClick={fetchFromGstin}>
                {looking ? "Fetching…" : "Fetch name & address"}
              </button>
            )}
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs text-muted">Address (printed on the invoice)</span>
          <textarea className="w-full" rows={2} value={form.address} onChange={set("address")} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Price list</span>
          <select className="w-full" value={form.type} onChange={set("type")}>
            <option value="WHOLESALE">Wholesale</option>
            <option value="RETAIL">Retail</option>
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button className="btn" disabled={saving} onClick={save}>
          {saving ? "Saving…" : existing ? "Save details" : "Add customer"}
        </button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
