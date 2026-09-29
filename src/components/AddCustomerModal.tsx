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
  const [ownerName, setOwnerName] = useState("");
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
            <h2 className="text-base font-bold text-ink">Add New Customer</h2>
            <p className="text-[11px] text-muted">Create customer account for billing & inventory ledger</p>
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
        <form onSubmit={handleSave} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs">
            {error && (
              <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-xs text-bad leading-relaxed">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-ink">
                  Shop / Business Name <span className="text-bad">*</span>
                </label>
                <input
                  ref={shopNameRef}
                  className="w-full"
                  placeholder="e.g. Ramesh Kirana Store"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-ink">Customer / Owner Name</label>
                <input
                  className="w-full"
                  placeholder="e.g. Ramesh Kumar"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-ink">Mobile Number</label>
                <input
                  ref={mobileRef}
                  className="w-full font-mono"
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-ink">Customer Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`rounded-md py-1.5 px-2 text-center text-xs font-semibold transition-all ${
                      type === "WHOLESALE"
                        ? "bg-ink text-surface shadow-sm"
                        : "border border-line bg-surface-hi text-ink hover:bg-surface"
                    }`}
                    onClick={() => setType("WHOLESALE")}
                  >
                    Wholesale
                  </button>
                  <button
                    type="button"
                    className={`rounded-md py-1.5 px-2 text-center text-xs font-semibold transition-all ${
                      type === "RETAIL"
                        ? "bg-ink text-surface shadow-sm"
                        : "border border-line bg-surface-hi text-ink hover:bg-surface"
                    }`}
                    onClick={() => setType("RETAIL")}
                  >
                    Retail
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-ink">Address / Area</label>
              <input
                className="w-full"
                placeholder="Shop address, market, or city"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-ink">GSTIN (Optional)</label>
                <input
                  className="w-full font-mono uppercase"
                  placeholder="22AAAAA0000A1Z5"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  maxLength={15}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-ink">Credit Limit (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  className="w-full font-mono"
                  placeholder="0 for no credit"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-hi/40 px-5 py-3">
            <button
              type="button"
              className="btn px-4 py-2 text-xs font-medium"
              onClick={onClose}
              disabled={saving}
            >
              Cancel (Esc)
            </button>
            <button
              type="submit"
              className="btn-primary px-4 py-2 text-xs font-bold shadow-sm"
              disabled={saving}
            >
              {saving ? "Saving Customer…" : "Save Customer (Enter)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
