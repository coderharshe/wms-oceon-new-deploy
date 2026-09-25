"use client";

import { useEffect, useRef, useState } from "react";
import { describeHttpError } from "@/lib/http-error";

export type NewCustomerData = {
  id: string;
  shopName: string;
  ownerName: string | null;
  mobile: string | null;
  address?: string | null;
  gstin?: string | null;
  type: "WHOLESALE" | "RETAIL";
  creditLimit?: string | null;
  outstandingBalance?: string;
};

export function AddCustomerModal({
  initialQuery = "",
  sellingMode = "WHOLESALE",
  onClose,
  onCreated,
}: {
  initialQuery?: string;
  sellingMode?: "WHOLESALE" | "RETAIL";
  onClose: () => void;
  onCreated: (customer: NewCustomerData) => void;
}) {
  const isNumeric = /^\d+$/.test(initialQuery.trim());
  const [shopName, setShopName] = useState(isNumeric ? "" : initialQuery.trim());
  const [ownerName, setOwnerName] = useState(isNumeric ? "" : initialQuery.trim());
  const [mobile, setMobile] = useState(isNumeric ? initialQuery.trim() : "");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [type, setType] = useState<"WHOLESALE" | "RETAIL">(sellingMode);
  const [creditLimit, setCreditLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shopNameRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNumeric) mobileRef.current?.focus();
    else shopNameRef.current?.focus();
  }, [isNumeric]);

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const finalShop = shopName.trim() || ownerName.trim();
    if (!finalShop) {
      setError("Please enter a Shop Name or Contact Name");
      shopNameRef.current?.focus();
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      shopName: finalShop,
      ownerName: ownerName.trim() || undefined,
      mobile: mobile.trim() || undefined,
      address: address.trim() || undefined,
      gstin: gstin.trim() || undefined,
      type,
      creditLimit: creditLimit.trim() ? Number(creditLimit) : undefined,
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setError(await describeHttpError(res));
        setSaving(false);
        return;
      }

      const created = await res.json();
      setSaving(false);
      onCreated({
        id: created.id,
        shopName: created.shopName,
        ownerName: created.ownerName ?? null,
        mobile: created.mobile ?? null,
        address: created.address ?? null,
        gstin: created.gstin ?? null,
        type: created.type ?? type,
        creditLimit: created.creditLimit ?? null,
        outstandingBalance: created.outstandingBalance ?? "0",
      });
    } catch (err: any) {
      setError(err?.message || "Failed to create customer");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-lg border border-line bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-base font-bold text-ink">Add New Customer</h2>
            <p className="text-xs text-muted">Create customer account and attach immediately to this bill</p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted hover:bg-surface-hi hover:text-ink"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="rounded border border-bad/20 bg-bad/10 p-2 text-xs text-bad">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3 text-xs">
          <div>
            <label className="mb-1 block font-semibold text-ink">Shop / Customer Name *</label>
            <input
              ref={shopNameRef}
              className="w-full"
              placeholder="e.g. Ramesh Kirana Store / Ramesh Kumar"
              value={shopName}
              onChange={(e) => {
                setShopName(e.target.value);
                setOwnerName(e.target.value);
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-ink">Mobile Number</label>
              <input
                ref={mobileRef}
                className="w-full"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Customer Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded py-1.5 font-medium ${type === "WHOLESALE" ? "bg-ink text-surface" : "border border-line bg-surface-hi text-ink"}`}
                  onClick={() => setType("WHOLESALE")}
                >
                  Wholesale
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded py-1.5 font-medium ${type === "RETAIL" ? "bg-ink text-surface" : "border border-line bg-surface-hi text-ink"}`}
                  onClick={() => setType("RETAIL")}
                >
                  Retail
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-semibold text-ink">Address</label>
            <input
              className="w-full"
              placeholder="Shop address or area / city"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-semibold text-ink">GSTIN (Optional)</label>
              <input
                className="w-full uppercase"
                placeholder="22AAAAA0000A1Z5"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-ink">Credit Limit (₹)</label>
              <input
                type="number"
                min="0"
                step="100"
                className="w-full"
                placeholder="0 for no credit"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel (Esc)
            </button>
            <button type="submit" className="btn-primary px-4 py-1.5 font-bold" disabled={saving}>
              {saving ? "Saving Customer…" : "Save & Add to Bill (Enter)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
