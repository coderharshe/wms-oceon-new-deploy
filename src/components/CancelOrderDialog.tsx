"use client";

import { useState } from "react";
import { ErrorNote } from "@/components/ErrorNote";

const CHOICES = [
  { value: "CASH", label: "Cash given back to the customer", hint: "Taken out of your cash drawer. Also pick this if the customer never actually paid." },
  { value: "UPI", label: "Paid back by UPI", hint: "Comes out of the bank." },
  { value: "CREDIT", label: "Keep as credit on the customer's account", hint: "Nothing given back now; it comes off their next bill." },
  { value: "LATER", label: "Not given back yet", hint: "Stays on Finance's Needs Refund list until someone settles it." },
] as const;

/**
 * Cancel Order/Bill Dialog:
 * Confirms cancellation, handles refund routing if payment was made,
 * and communicates that all items will be returned to inventory.
 */
export default function CancelOrderDialog({ orderId, paid, onClose, onDone }: { orderId: string; paid: number; onClose: () => void; onDone: () => void }) {
  const [refund, setRefund] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPaid = paid > 0;
  const ready = !hasPaid || (refund !== "" && reason.trim() !== "");

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined, ...(hasPaid && { refund }) }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(typeof body.error === "string" ? body.error : "Could not cancel the bill");
    }
    onDone();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3 shadow-xl" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="flex items-center gap-2 text-bad">
          <span className="text-xl font-bold">⚠️</span>
          <h2 className="text-base font-bold text-bad">Cancel this bill?</h2>
        </div>
        <p className="text-sm text-muted">
          All items on this bill will be removed and their quantities will be restored back to warehouse inventory. The bill will be marked as <strong>CANCELLED</strong>.
        </p>

        {hasPaid && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">₹{paid.toFixed(2)} was paid for this bill. How should the refund be handled?</legend>
            {CHOICES.map((c) => (
              <label key={c.value} className={`flex cursor-pointer gap-2 rounded border p-2 text-sm ${refund === c.value ? "border-accent bg-accent/5" : "border-line"}`}>
                <input type="radio" name="refund" value={c.value} checked={refund === c.value} onChange={() => setRefund(c.value)} autoFocus={c.value === "CASH"} />
                <span>
                  {c.label}
                  <span className="block text-xs text-muted">{c.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="block text-xs text-muted">
          Reason for cancellation{hasPaid ? " (required)" : " (optional)"}
          <input className="w-full mt-1" placeholder="e.g. Customer cancelled / Incorrect items" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={!hasPaid} />
        </label>

        {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button type="button" className="btn" onClick={onClose}>
            Keep Bill
          </button>
          <button type="button" className="btn-danger font-semibold" disabled={busy || !ready} onClick={submit}>
            {busy ? "Cancelling…" : "Confirm Cancel Bill"}
          </button>
        </div>
      </div>
    </div>
  );
}
