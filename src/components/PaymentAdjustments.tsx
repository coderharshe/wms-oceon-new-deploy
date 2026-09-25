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
const OPTIONS_STORE_OWES = ["CASH_REFUND", "UPI_REFUND", "CUSTOMER_CREDIT", "MANAGER_ADJUSTMENT"] as const;
const OPTIONS_CUSTOMER_OWES = ["ADDITIONAL_PAYMENT", "MANAGER_ADJUSTMENT"] as const;

/**
 * A revised bill's outstanding difference, and the control to settle it.
 * Shared by the Finance and Manager order pages — both roles are allowed to
 * resolve one (see the resolve route's requireRole).
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (adjustments.length === 0) return null;

  async function resolve(adjustmentId: string) {
    const resolutionType = resolution[adjustmentId];
    if (!resolutionType) return;
    const clickedAt = new Date().toISOString();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/payment-adjustments/${adjustmentId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionType, clickedAt }),
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
            <th>Resolution</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((a) => {
            const isRefund = Number(a.difference) < 0;
            const options = isRefund ? OPTIONS_STORE_OWES : OPTIONS_CUSTOMER_OWES;
            return (
              <tr key={a.id}>
                <td>₹{Number(a.previousTotal).toFixed(2)}</td>
                <td>₹{Number(a.newTotal).toFixed(2)}</td>
                <td>₹{Number(a.difference).toFixed(2)}</td>
                <td>
                  {a.resolutionType ? (
                    a.resolutionType.replace(/_/g, " ")
                  ) : (
                    <div className="flex items-center gap-1">
                      <select
                        value={resolution[a.id] ?? ""}
                        onChange={(e) => setResolution((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      >
                        <option value="">Choose…</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <button className="btn" disabled={busy || disabled || !resolution[a.id]} onClick={() => resolve(a.id)}>
                        {isRefund ? "Mark Refund Done" : "Mark Resolved"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
    </section>
  );
}
