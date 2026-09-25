"use client";

import { useState } from "react";
import { useEscapeKey } from "@/lib/keynav";

export type TenderMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT" | "SPLIT";

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
  const [method, setMethod] = useState<TenderMethod>("CASH");

  // Cash state
  const [cashAmount, setCashAmount] = useState<string>(remaining.toString());
  // Bank Transfer state (all optional except amount)
  const [bankAmount, setBankAmount] = useState<string>(remaining.toString());
  const [bankUtr, setBankUtr] = useState<string>("");
  const [bankName, setBankName] = useState<string>("");
  const [bankNotes, setBankNotes] = useState<string>("");

  // Cheque state (all optional except amount)
  const [chequeAmount, setChequeAmount] = useState<string>(remaining.toString());
  const [chequeNo, setChequeNo] = useState<string>("");
  const [chequeBank, setChequeBank] = useState<string>("");
  const [chequeDate, setChequeDate] = useState<string>("");

  // UPI state
  const [upiAmount, setUpiAmount] = useState<string>(remaining.toString());
  const [upiRef, setUpiRef] = useState<string>("");

  // Split state
  const [splitCash, setSplitCash] = useState<string>("");
  const [splitUpi, setSplitUpi] = useState<string>("");
  const [splitBank, setSplitBank] = useState<string>("");
  const [splitCheque, setSplitCheque] = useState<string>("");

  // UI state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashNum = Number(cashAmount) || 0;
  const cashChange = Math.max(0, cashNum - remaining);

  const splitTotal =
    (Number(splitCash) || 0) +
    (Number(splitUpi) || 0) +
    (Number(splitBank) || 0) +
    (Number(splitCheque) || 0);
  const splitRemaining = remaining - splitTotal;

  async function handleCollect() {
    setError(null);
    setBusy(true);

    try {
      let body: any = {
        billId,
        method,
        clickedAt: new Date().toISOString(),
      };

      if (method === "CASH") {
        if (cashNum <= 0) throw new Error("Please enter a valid cash amount");
        body.amountReceived = cashNum;
      } else if (method === "UPI") {
        const amt = Number(upiAmount) || remaining;
        body.amountReceived = amt;
        body.bankReference = upiRef.trim() || undefined;
      } else if (method === "BANK_TRANSFER") {
        const amt = Number(bankAmount) || remaining;
        body.amountReceived = amt;
        body.bankReference = bankUtr.trim() || undefined;
        body.bankName = bankName.trim() || undefined;
        body.notes = bankNotes.trim() || undefined;
      } else if (method === "CHEQUE") {
        const amt = Number(chequeAmount) || remaining;
        body.amountReceived = amt;
        body.chequeNumber = chequeNo.trim() || undefined;
        body.chequeBank = chequeBank.trim() || undefined;
        body.chequeDueDate = chequeDate || undefined;
      } else if (method === "CREDIT") {
        body.method = "CREDIT";
      } else if (method === "SPLIT") {
        if (splitTotal <= 0) throw new Error("Enter amount for at least one payment method");
        const splitItems = [];
        if (Number(splitCash) > 0) splitItems.push({ method: "CASH", amount: Number(splitCash) });
        if (Number(splitUpi) > 0) splitItems.push({ method: "UPI", amount: Number(splitUpi) });
        if (Number(splitBank) > 0) splitItems.push({ method: "BANK_TRANSFER", amount: Number(splitBank) });
        if (Number(splitCheque) > 0) splitItems.push({ method: "CHEQUE", amount: Number(splitCheque) });
        body.splitItems = splitItems;
        body.amountReceived = splitTotal;
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
              {billNumber ? `Bill #${billNumber} · ` : ""}Due: <span className="font-semibold text-bad">₹{remaining.toFixed(2)}</span>
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

        {/* Customer Context Ribbon */}
        {customer && (
          <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">{customer.shopName || customer.ownerName || "Customer"}</span>
              {customer.mobile && <span className="text-muted">({customer.mobile})</span>}
            </div>
            <div className="flex items-center gap-3">
              {customer.outstandingBalance != null && (
                <span>
                  Current Khata: <strong className="text-warn">₹{Number(customer.outstandingBalance).toFixed(2)}</strong>
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

        {/* Tabs */}
        <div className="flex border-b border-line bg-paper/30 px-6">
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "CASH" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("CASH")}
          >
            💵 Cash
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "UPI" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("UPI")}
          >
            📱 UPI / QR
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "BANK_TRANSFER" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("BANK_TRANSFER")}
          >
            🏦 Bank Transfer (NEFT/RTGS)
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "CHEQUE" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("CHEQUE")}
          >
            📄 Cheque
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "CREDIT" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("CREDIT")}
          >
            📒 Khata / Credit
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-all ${
              method === "SPLIT" ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setMethod("SPLIT")}
          >
            ⚖️ Split
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {/* 1. CASH */}
          {method === "CASH" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Cash Received from Customer</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted">₹</span>
                  <input
                    type="number"
                    step="any"
                    className="w-full rounded-lg border border-line bg-surface py-2.5 pl-8 pr-4 text-lg font-bold text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-line bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-accent hover:text-accent"
                  onClick={() => setCashAmount(remaining.toString())}
                >
                  Exact (₹{remaining.toFixed(2)})
                </button>
                {[100, 200, 500, 1000, 2000].map((denom) => {
                  const rounded = Math.ceil(remaining / denom) * denom;
                  if (rounded <= remaining) return null;
                  return (
                    <button
                      key={denom}
                      type="button"
                      className="rounded border border-line bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-accent hover:text-accent"
                      onClick={() => setCashAmount(rounded.toString())}
                    >
                      ₹{rounded}
                    </button>
                  );
                })}
              </div>

              {/* Change calculation */}
              <div className="rounded-lg border border-line bg-paper/60 p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-xs text-muted block">Change to return</span>
                  <span className={`text-base font-bold ${cashChange > 0 ? "text-good" : "text-ink"}`}>
                    ₹{cashChange.toFixed(2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted block">Bill settlement</span>
                  <span className="text-xs font-semibold text-ink">
                    {cashNum >= remaining ? "Fully Settled" : `Remaining: ₹${(remaining - cashNum).toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 2. UPI */}
          {method === "UPI" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Amount to Collect</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted">₹</span>
                  <input
                    type="number"
                    step="any"
                    className="w-full rounded-lg border border-line bg-surface py-2.5 pl-8 pr-4 text-base font-bold text-ink focus:border-accent"
                    value={upiAmount}
                    onChange={(e) => setUpiAmount(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">UPI UTR / Reference No. (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 408291839218"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                  value={upiRef}
                  onChange={(e) => setUpiRef(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted">
                Direct UPI confirmation will instantly mark the payment as received and record the entry in the Bank Statement ledger.
              </p>
            </div>
          )}

          {/* 3. BANK TRANSFER */}
          {method === "BANK_TRANSFER" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Transfer Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted">₹</span>
                  <input
                    type="number"
                    step="any"
                    className="w-full rounded-lg border border-line bg-surface py-2.5 pl-8 pr-4 text-base font-bold text-ink focus:border-accent"
                    value={bankAmount}
                    onChange={(e) => setBankAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">UTR / Transaction Ref (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. HDFC00012398"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={bankUtr}
                    onChange={(e) => setBankUtr(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Bank Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. HDFC Bank, ICICI"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Notes / Sender Info (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Sent from proprietor personal account"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                  value={bankNotes}
                  onChange={(e) => setBankNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* 4. CHEQUE */}
          {method === "CHEQUE" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Cheque Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted">₹</span>
                  <input
                    type="number"
                    step="any"
                    className="w-full rounded-lg border border-line bg-surface py-2.5 pl-8 pr-4 text-base font-bold text-ink focus:border-accent"
                    value={chequeAmount}
                    onChange={(e) => setChequeAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Cheque Number (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 004921"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={chequeNo}
                    onChange={(e) => setChequeNo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Drawee Bank (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. State Bank of India"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={chequeBank}
                    onChange={(e) => setChequeBank(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Cheque Due / Deposit Date (Optional)</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* 5. CREDIT / KHATA */}
          {method === "CREDIT" && (
            <div className="space-y-3 rounded-lg border border-line bg-paper/40 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📒</span>
                <div>
                  <h3 className="text-sm font-bold text-ink">Bill to Customer Khata (Credit)</h3>
                  <p className="text-xs text-muted">
                    Leaves this bill as unpaid receivable. The customer outstanding balance will increase by ₹{remaining.toFixed(2)}.
                  </p>
                </div>
              </div>
              {customer && customer.creditLimit != null && (
                <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  Customer limit: ₹{Number(customer.creditLimit).toFixed(2)} · New Projected Balance: ₹
                  {(Number(customer.outstandingBalance || 0) + remaining).toFixed(2)}
                </div>
              )}
            </div>
          )}

          {/* 6. SPLIT */}
          {method === "SPLIT" && (
            <div className="space-y-3">
              <p className="text-xs text-muted">Split the bill across multiple tender methods:</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">💵 Cash</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">📱 UPI</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={splitUpi}
                    onChange={(e) => setSplitUpi(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">🏦 Bank Transfer</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={splitBank}
                    onChange={(e) => setSplitBank(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">📄 Cheque</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent"
                    value={splitCheque}
                    onChange={(e) => setSplitCheque(e.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-line bg-paper/60 p-3 flex items-center justify-between text-xs">
                <span>
                  Split Total: <strong>₹{splitTotal.toFixed(2)}</strong> / ₹{remaining.toFixed(2)}
                </span>
                <span className={splitRemaining <= 0 ? "font-bold text-good" : "font-bold text-bad"}>
                  {splitRemaining <= 0 ? "✓ Full Covered" : `Remaining: ₹${splitRemaining.toFixed(2)}`}
                </span>
              </div>
            </div>
          )}
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
            {busy ? "Processing…" : method === "CREDIT" ? "Confirm Khata (Credit)" : `Confirm Payment (₹${(method === "CASH" ? Math.min(cashNum, remaining) : remaining).toFixed(2)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
