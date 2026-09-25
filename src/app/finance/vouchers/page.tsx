"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";

type Voucher = {
  id: string;
  voucherNo: string;
  type: "RECEIPT_VOUCHER" | "PAYMENT_VOUCHER";
  date: string;
  partyName: string;
  partyType: string;
  amount: number;
  paymentMode: string;
  referenceNo: string | null;
  notes: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";
  createdAt: string;
  createdByUser: { name: string; staffId: string };
  approvedByUser: { name: string; staffId: string } | null;
};

export default function VouchersPage() {
  const [typeFilter, setTypeFilter] = useState<string>("");
  const { data, loading, error, reload } = useApiGet<Voucher[]>(`/api/finance/vouchers${typeFilter ? `?type=${typeFilter}` : ""}`);

  const [showModal, setShowModal] = useState(false);
  const [type, setType] = useState<"RECEIPT_VOUCHER" | "PAYMENT_VOUCHER">("RECEIPT_VOUCHER");
  const [partyName, setPartyName] = useState("");
  const [partyType, setPartyType] = useState<"CUSTOMER" | "SUPPLIER" | "OTHER">("CUSTOMER");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "UPI">("CASH");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreateVoucher(e: React.FormEvent) {
    e.preventDefault();
    if (!partyName || !amount) return setFormError("Please fill party name and amount");

    setSaving(true);
    setFormError(null);

    const res = await fetch("/api/finance/vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        partyName,
        partyType,
        amount: parseFloat(amount),
        paymentMode,
        date,
        referenceNo: referenceNo || undefined,
        notes: notes || undefined,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(b.error || "Failed to create voucher");
    }

    setShowModal(false);
    setPartyName("");
    setAmount("");
    setReferenceNo("");
    setNotes("");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">Payment & Receipt Vouchers</h1>
          <p className="text-xs text-muted">Financial authorization vouchers for customer receipts, supplier payments, and petty cash</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-primary font-semibold text-xs"
            onClick={() => setShowModal(true)}
          >
            + Create New Voucher
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-2 text-xs">
        <button
          className={`rounded px-3 py-1 font-medium ${typeFilter === "" ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
          onClick={() => setTypeFilter("")}
        >
          All Vouchers
        </button>
        <button
          className={`rounded px-3 py-1 font-medium ${typeFilter === "RECEIPT_VOUCHER" ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
          onClick={() => setTypeFilter("RECEIPT_VOUCHER")}
        >
          📥 Receipt Vouchers (Money In)
        </button>
        <button
          className={`rounded px-3 py-1 font-medium ${typeFilter === "PAYMENT_VOUCHER" ? "bg-ink text-surface" : "bg-surface-hi hover:bg-line"}`}
          onClick={() => setTypeFilter("PAYMENT_VOUCHER")}
        >
          📤 Payment Vouchers (Money Out)
        </button>
      </div>

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold">Create Financial Voucher</h2>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>

            {formError && <div className="p-2 rounded bg-bad/10 text-bad border border-bad/20 text-xs">{formError}</div>}

            <form onSubmit={handleCreateVoucher} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Voucher Type *</label>
                  <select
                    className="w-full font-bold"
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                  >
                    <option value="RECEIPT_VOUCHER">📥 Receipt Voucher (Money In)</option>
                    <option value="PAYMENT_VOUCHER">📤 Payment Voucher (Money Out)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Voucher Date *</label>
                  <input
                    type="date"
                    className="w-full"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Party / Recipient Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Stores"
                    className="w-full"
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Party Category</label>
                  <select
                    className="w-full"
                    value={partyType}
                    onChange={(e) => setPartyType(e.target.value as any)}
                  >
                    <option value="CUSTOMER">Customer / Retailer</option>
                    <option value="SUPPLIER">Distributor / Supplier</option>
                    <option value="OTHER">Staff / Other Vendor</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-semibold">Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full font-bold"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Payment Mode</label>
                  <select
                    className="w-full"
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as any)}
                  >
                    <option value="CASH">Cash Drawer</option>
                    <option value="UPI">UPI / Bank Transfer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold">Reference No. (Cheque / UTR / Order No)</label>
                <input
                  type="text"
                  placeholder="e.g. UTR-98234821 or ORD-2026-0041"
                  className="w-full"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold">Particulars / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Partial payment for invoice INV-1002"
                  className="w-full"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary font-semibold" disabled={saving}>
                  {saving ? "Generating…" : "✓ Issue Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2">Voucher No</th>
                <th className="py-2">Type</th>
                <th className="py-2">Party</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Mode & Ref</th>
                <th className="py-2">Status</th>
                <th className="py-2">Date & Creator</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v) => {
                const isReceipt = v.type === "RECEIPT_VOUCHER";
                return (
                  <tr key={v.id} className="border-b border-line/50 hover:bg-surface-hi">
                    <td className="py-2 font-bold text-ink">{v.voucherNo}</td>
                    <td className="py-2">
                      <span className={`badge text-xs font-semibold ${isReceipt ? "bg-good text-white" : "bg-bad text-white"}`}>
                        {isReceipt ? "RECEIPT" : "PAYMENT"}
                      </span>
                    </td>
                    <td className="py-2 font-medium">
                      <div>{v.partyName}</div>
                      <div className="text-[10px] text-muted">{v.partyType}</div>
                    </td>
                    <td className={`py-2 font-bold ${isReceipt ? "text-good" : "text-bad"}`}>
                      {isReceipt ? `+₹${Number(v.amount).toFixed(2)}` : `-₹${Number(v.amount).toFixed(2)}`}
                    </td>
                    <td className="py-2">
                      <div>{v.paymentMode}</div>
                      {v.referenceNo && <div className="text-[10px] text-muted">{v.referenceNo}</div>}
                    </td>
                    <td className="py-2">
                      <span className={`badge text-xs font-semibold ${
                        v.status === "APPROVED" ? "bg-good/10 text-good" : v.status === "PENDING_APPROVAL" ? "bg-warn text-white" : "bg-bad text-white"
                      }`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="py-2 text-muted">
                      <div>{new Date(v.date).toLocaleDateString()}</div>
                      <div className="text-[10px]">By {v.createdByUser.name}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
