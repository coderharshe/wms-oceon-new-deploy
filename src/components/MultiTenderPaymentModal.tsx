"use client";

import { useState } from "react";
import { useEscapeKey } from "@/lib/keynav";

export type TenderMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT";

export type ModalPaymentRow = {
  id: string;
  method: TenderMethod;
  amount: string;
  reference?: string;
};

interface MultiTenderPaymentModalProps {
  billId: string;
  billNumber?: string;
  totalDue: number;
  totalPaid: number;
  customer?: {
    shopName?: string;
    ownerName?: string | null;
    mobile?: string | null;
    outstandingBalance?: number | string;
    creditLimit?: number | string;
  } | null;
  onSuccess: () => void;
  onClose: () => void;
}

export function MultiTenderPaymentModal({
  billId,
  billNumber,
  totalDue,
  totalPaid,
  customer,
  onSuccess,
  onClose,
}: MultiTenderPaymentModalProps) {
  useEscapeKey(onClose);

  const remaining = Math.max(0, totalDue - totalPaid);

  const [paymentRows, setPaymentRows] = useState<ModalPaymentRow[]>([
    { id: "1", method: "CASH", amount: remaining > 0 ? remaining.toFixed(2) : "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalEntered = paymentRows.reduce((sum, r) => {
    if (r.method === "CREDIT") return sum;
    return sum + (Number(r.amount) || 0);
  }, 0);

  const remainingDues = Math.max(0, remaining - totalEntered);
  const changeDue = Math.max(0, totalEntered - remaining);

  function addRow() {
    const rem = Math.max(0, remaining - totalEntered);
    setPaymentRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        method: prev.some((r) => r.method === "CASH") ? "UPI" : "CASH",
        amount: rem > 0 ? rem.toFixed(2) : "",
        reference: "",
      },
    ]);
  }

  function updateRow(id: string, patch: Partial<ModalPaymentRow>) {
    setPaymentRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setPaymentRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function handleCollect() {
    setError(null);
    setBusy(true);

    try {
      const firstRow = paymentRows[0] || { id: "1", method: "CASH" as const, amount: "" };
      const isSingle = paymentRows.length <= 1;

      let body: any = {
        billId,
        clickedAt: new Date().toISOString(),
      };

      if (isSingle) {
        body.method = firstRow.method;
        if (firstRow.method === "CASH") {
          const amt = Number(firstRow.amount) || remaining;
          if (amt <= 0) throw new Error("Please enter a valid cash amount");
          body.amountReceived = amt;
        } else if (firstRow.method === "UPI") {
          const amt = Number(firstRow.amount) || remaining;
          body.amountReceived = amt;
          body.bankReference = firstRow.reference?.trim() || undefined;
        } else if (firstRow.method === "BANK_TRANSFER") {
          const amt = Number(firstRow.amount) || remaining;
          body.amountReceived = amt;
          body.bankReference = firstRow.reference?.trim() || undefined;
        } else if (firstRow.method === "CHEQUE") {
          const amt = Number(firstRow.amount) || remaining;
          body.amountReceived = amt;
          body.chequeNumber = firstRow.reference?.trim() || undefined;
        } else if (firstRow.method === "CREDIT") {
          body.method = "CREDIT";
        }
      } else {
        body.method = "SPLIT";
        const splitItems = paymentRows
          .filter((r) => r.method !== "CREDIT" && Number(r.amount) > 0)
          .map((r) => ({
            method: r.method,
            amount: Number(r.amount),
            reference: r.reference?.trim() || undefined,
          }));

        if (splitItems.length === 0 && !paymentRows.some((r) => r.method === "CREDIT")) {
          throw new Error("Enter amount for at least one payment method or select Credit");
        }

        body.splitItems = splitItems;
        body.amountReceived = totalEntered;
      }

      const res = await fetch("/api/finance/payments/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Payment collection failed");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-paper/50 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Collect Payment</h2>
            <p className="text-xs text-muted">
              {billNumber ? `Bill #${billNumber} · ` : ""}Due:{" "}
              <span className="font-semibold text-bad">₹{remaining.toFixed(2)}</span>
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:bg-line/40 hover:text-ink"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Customer Ribbon */}
        {customer && (
          <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">{customer.shopName || customer.ownerName || "Customer"}</span>
              {customer.mobile && <span className="text-muted">({customer.mobile})</span>}
            </div>
            <div className="flex items-center gap-3">
              {customer.outstandingBalance != null && (
                <span>
                  Khata: <strong className="text-warn">₹{Number(customer.outstandingBalance).toFixed(2)}</strong>
                </span>
              )}
              {customer.creditLimit != null && (
                <span>
                  Limit: <strong>₹{Number(customer.creditLimit).toFixed(2)}</strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase">Payment Methods & Amounts</span>
            <button
              type="button"
              className="btn text-xs font-semibold flex items-center gap-1 hover:border-accent hover:text-accent"
              onClick={addRow}
            >
              <span>+</span>
              <span>Add Method</span>
            </button>
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {paymentRows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-paper p-3 shadow-2xs"
              >
                {/* Method Dropdown */}
                <div className="w-48 min-w-[150px]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">Method</label>
                  <select
                    className="w-full text-xs font-semibold"
                    value={row.method}
                    onChange={(e) => updateRow(row.id, { method: e.target.value as any })}
                  >
                    <option value="CASH">💵 Cash</option>
                    <option value="UPI">📱 UPI / QR</option>
                    <option value="BANK_TRANSFER">🏦 Bank Transfer</option>
                    <option value="CHEQUE">📑 Cheque</option>
                    <option value="CREDIT">📒 Credit / Khata</option>
                  </select>
                </div>

                {/* Amount */}
                <div className="w-36 min-w-[110px]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={row.method === "CREDIT"}
                    className={`w-full text-xs font-bold font-mono ${row.method === "CREDIT" ? "opacity-50" : ""}`}
                    placeholder={row.method === "CREDIT" ? "Credit Ledger" : "0.00"}
                    value={row.amount}
                    onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                  />
                </div>

                {/* Reference */}
                {row.method !== "CREDIT" && row.method !== "CASH" && (
                  <div className="flex-1 min-w-[150px]">
                    <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">
                      {row.method === "UPI" ? "UPI Ref / UTR (Optional)" : row.method === "CHEQUE" ? "Cheque No. (Optional)" : "Bank Ref (Optional)"}
                    </label>
                    <input
                      type="text"
                      className="w-full text-xs"
                      placeholder="Reference / Transaction ID"
                      value={row.reference || ""}
                      onChange={(e) => updateRow(row.id, { reference: e.target.value })}
                    />
                  </div>
                )}

                {/* Remove */}
                {paymentRows.length > 1 && (
                  <div className="pt-3.5">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:border-bad hover:bg-bad/10 hover:text-bad"
                      onClick={() => removeRow(row.id)}
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Settlement Summary Box */}
          <div className="rounded-xl border border-line bg-paper/60 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between text-xs">
              <span className="text-muted">Total Due:</span>
              <strong className="text-ink font-mono text-sm">₹{remaining.toFixed(2)}</strong>
            </div>
            <div className="flex flex-wrap items-center justify-between text-xs">
              <span className="text-muted">Total Entered:</span>
              <strong className="text-good font-mono text-sm">₹{totalEntered.toFixed(2)}</strong>
            </div>
            <div className="flex flex-wrap items-center justify-between border-t border-line/60 pt-2 text-xs">
              {changeDue > 0 ? (
                <>
                  <span className="text-good font-semibold">Change to Return:</span>
                  <strong className="text-good font-mono font-bold">₹{changeDue.toFixed(2)}</strong>
                </>
              ) : remainingDues > 0 && !paymentRows.some((r) => r.method === "CREDIT") ? (
                <>
                  <span className="text-amber-700 font-semibold">Remaining Balance:</span>
                  <strong className="text-amber-700 font-mono font-bold">₹{remainingDues.toFixed(2)}</strong>
                </>
              ) : (
                <>
                  <span className="text-good font-semibold">Status:</span>
                  <strong className="text-good font-bold">✓ Fully Covered</strong>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-paper/50 px-6 py-4">
          <button
            type="button"
            className="rounded-lg border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-line/40"
            onClick={onClose}
            disabled={busy}
          >
            Cancel (Esc)
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-6 py-2 text-xs font-bold text-white shadow hover:opacity-90 disabled:opacity-50"
            onClick={handleCollect}
            disabled={busy}
          >
            {busy ? "Processing…" : `Confirm Payment (₹${totalEntered > 0 ? Math.min(totalEntered, remaining).toFixed(2) : remaining.toFixed(2)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
