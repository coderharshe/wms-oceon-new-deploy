"use client";

import { useState } from "react";
import { ErrorNote } from "@/components/ErrorNote";

export type Adjustment = {
  id: string;
  previousTotal: string;
  newTotal: string;
  difference: string;
  resolutionType: string | null;
};

// Which resolutions make sense depends on who is out of pocket — the server
// enforces the same split in assertResolutionDirection, this just keeps the
// dropdown from offering a choice that will be rejected.
const OPTIONS_STORE_OWES = [
  { value: "CASH_REFUND", label: "💵 Cash Refund" },
  { value: "UPI_REFUND", label: "📱 UPI Refund" },
  { value: "CUSTOMER_CREDIT", label: "👤 Customer Credit / Balance" },
  { value: "MANAGER_ADJUSTMENT", label: "🛡️ Manager Adjustment" },
] as const;

const OPTIONS_CUSTOMER_OWES = [
  { value: "CASH", label: "💵 Cash Received" },
  { value: "UPI", label: "📱 UPI Received" },
  { value: "BANK_TRANSFER", label: "🏦 Bank Transfer" },
  { value: "CHEQUE", label: "📑 Cheque Received" },
  { value: "CREDIT", label: "👤 Add to Customer Account / Credit" },
  { value: "MANAGER_ADJUSTMENT", label: "🛡️ Manager Adjustment" },
] as const;

/**
 * A revised bill's outstanding difference, and the control to settle it.
 * Shared by the Finance, Billing, and Manager order pages — all allowed roles
 * can resolve adjustments directly with payment receipt methods.
 */
export function PaymentAdjustments({
  adjustments,
  onResolved,
  disabled,
}: {
  adjustments: Adjustment[];
  onResolved: () => void;
  disabled?: boolean;
}) {
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (adjustments.length === 0) return null;

  async function resolve(adjustmentId: string) {
    const resolutionType = resolution[adjustmentId];
    if (!resolutionType) return;
    const ref = reference[adjustmentId]?.trim() || undefined;
    const clickedAt = new Date().toISOString();
    setLastId(adjustmentId);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/payment-adjustments/${adjustmentId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutionType,
        paymentMethod: ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CREDIT"].includes(resolutionType) ? resolutionType : undefined,
        reference: ref,
        clickedAt,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(typeof body.error === "string" ? body.error : "Could not resolve adjustment");
    }
    onResolved();
  }

  return (
    <section className="card">
      <h2 className="mb-2 text-sm font-semibold">Payment Adjustments</h2>
      <table>
        <thead>
          <tr>
            <th>Previous</th>
            <th>New</th>
            <th>Difference</th>
            <th>Resolution & Method</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((a) => {
            const isRefund = Number(a.difference) < 0;
            const options = isRefund ? OPTIONS_STORE_OWES : OPTIONS_CUSTOMER_OWES;
            const chosen = resolution[a.id] ?? "";
            const needsRef = ["UPI", "BANK_TRANSFER", "CHEQUE"].includes(chosen);
            return (
              <tr key={a.id}>
                <td>₹{Number(a.previousTotal).toFixed(2)}</td>
                <td>₹{Number(a.newTotal).toFixed(2)}</td>
                <td className={isRefund ? "text-bad font-semibold" : "text-good font-semibold"}>
                  {isRefund ? `Refund: ₹${Math.abs(Number(a.difference)).toFixed(2)}` : `Additional Due: ₹${Number(a.difference).toFixed(2)}`}
                </td>
                <td>
                  {a.resolutionType ? (
                    <span className="badge badge-neutral">{a.resolutionType.replace(/_/g, " ")}</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="text-xs"
                        value={chosen}
                        onChange={(e) => setResolution((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      >
                        <option value="">Choose How Resolved…</option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>

                      {needsRef && (
                        <input
                          type="text"
                          className="w-36 text-xs"
                          placeholder={chosen === "CHEQUE" ? "Cheque No" : "Ref / UTR No"}
                          value={reference[a.id] ?? ""}
                          onChange={(e) => setReference((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        />
                      )}

                      <button
                        className="btn-primary text-xs"
                        disabled={busy || disabled || !chosen}
                        onClick={() => resolve(a.id)}
                      >
                        {isRefund ? "✓ Mark Refund Done" : "✓ Receive & Settle"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <ErrorNote error={error} onRetry={lastId ? () => resolve(lastId) : undefined} onDismiss={() => setError(null)} />}
    </section>
  );
}
