"use client";

import { Fragment, useState, useEffect } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDate, fmtTime } from "@/lib/fmt";
import type { Day, DayStatus } from "@/lib/daybook";

type Book = { warehouseId: string; since: string; until: string; today: string; firstBankDay: string | null; days: Day[] };
type Tx = { type: string; amount: string; note: string | null; at: string; billNumber: string | null; orderId: string | null };

type BankTransactionRow = {
  id: string;
  warehouseId: string;
  businessDate: string;
  type: string;
  amount: string;
  isCredit: boolean;
  utrReference?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  partyName?: string | null;
  notes?: string | null;
  reconciled: boolean;
  createdAt: string;
};

type BankSummaryResponse = {
  warehouseId: string;
  transactions: BankTransactionRow[];
  summary: {
    totalCredits: string;
    totalDebits: string;
    netMovement: string;
    count: number;
  };
};

const rs = (x: string | number | null | undefined) =>
  x == null ? "—" : `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<DayStatus, { label: string; cls: string }> = {
  OPEN: { label: "Drawer open", cls: "text-warn" },
  NOT_COUNTED: { label: "Not counted", cls: "text-bad" },
  WAITING_BANK: { label: "Bank balance needed", cls: "text-warn" },
  NO_OPENING: { label: "Bank opening needed", cls: "text-warn" },
  MATCHED: { label: "Matched", cls: "text-good" },
  SHORT: { label: "Short", cls: "text-bad" },
  EXCESS: { label: "Excess", cls: "text-warn" },
};

const TX_LABEL: Record<string, string> = {
  SALE: "Bill",
  REFUND: "Refund",
  OTHER_RECEIPT: "Cash put in",
  WITHDRAWAL: "Paid out",
  BANK_DEPOSIT: "Deposited in bank",
};

const BANK_TX_TYPE_LABELS: Record<string, { label: string; isCredit: boolean }> = {
  DIRECT_DEPOSIT: { label: "Cash Drawer Deposit", isCredit: true },
  CUSTOMER_TRANSFER: { label: "Customer Transfer (NEFT/RTGS)", isCredit: true },
  UPI_COLLECTION: { label: "UPI Settlement", isCredit: true },
  CHEQUE_CLEARANCE: { label: "Cheque Clearance", isCredit: true },
  SUPPLIER_PAYMENT: { label: "Supplier Payout", isCredit: false },
  EXPENSE_PAYOUT: { label: "Operational Payout", isCredit: false },
  BANK_CHARGES: { label: "Bank Charges / Interest", isCredit: false },
  ADJUSTMENT: { label: "Manual Adjustment", isCredit: true },
};

export default function DayBook({ isAdmin }: { isAdmin: boolean }) {
  const [activeTab, setActiveTab] = useState<"CASH" | "BANK">("CASH");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const { data: warehouses } = useApiGet<{ id: string; name: string }[]>(isAdmin ? "/api/admin/warehouses" : null);

  useEffect(() => {
    if (isAdmin && warehouses && warehouses[0] && !warehouseId) {
      setWarehouseId(warehouses[0].id);
    }
  }, [isAdmin, warehouses, warehouseId]);

  const effectiveWarehouseId = isAdmin ? warehouseId || (warehouses?.[0]?.id ?? "") : "";
  const shouldFetch = !isAdmin || effectiveWarehouseId !== "";

  // Cash Daybook Query
  const cashQs = new URLSearchParams({
    ...(since && { since }),
    ...(until && { until }),
    ...(effectiveWarehouseId && { warehouseId: effectiveWarehouseId }),
  });
  const { data: cashData, error: cashError, loading: cashLoading, reload: reloadCash } = useApiGet<Book>(
    shouldFetch ? `/api/cash/daybook?${cashQs}` : null
  );

  // Bank Statement Query
  const bankQs = new URLSearchParams({
    ...(since && { since }),
    ...(until && { until }),
    ...(effectiveWarehouseId && { warehouseId: effectiveWarehouseId }),
  });
  const {
    data: bankData,
    error: bankError,
    loading: bankLoading,
    reload: reloadBank,
  } = useApiGet<BankSummaryResponse>(shouldFetch ? `/api/bank/transactions?${bankQs}` : null);

  const [openDay, setOpenDay] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState<{ day: string; closing: string; opening: string; adjustment: string; note: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add Bank Entry Modal (All optional except amount & type)
  const [showAddBankTx, setShowAddBankTx] = useState(false);
  const [newTxType, setNewTxType] = useState("CUSTOMER_TRANSFER");
  const [newTxAmount, setNewTxAmount] = useState("");
  const [newTxUtr, setNewTxUtr] = useState("");
  const [newTxBankName, setNewTxBankName] = useState("");
  const [newTxParty, setNewTxParty] = useState("");
  const [newTxNotes, setNewTxNotes] = useState("");
  const [newTxDate, setNewTxDate] = useState(new Date().toISOString().slice(0, 10));

  // Deposit Cash to Bank Modal
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositBankName, setDepositBankName] = useState("");
  const [depositRef, setDepositRef] = useState("");
  const [depositNote, setDepositNote] = useState("");

  function editBank(day: string, d?: Day) {
    setFormError(null);
    setBankForm({
      day,
      closing: d?.bank?.closing ?? "",
      opening: d?.bank?.opening ?? "",
      adjustment: d?.bank && Number(d.bank.adjustment) !== 0 ? d.bank.adjustment : "",
      note: d?.bank?.note ?? "",
    });
  }

  async function saveBank() {
    if (!bankForm || !cashData) return;
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/cash/bank", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId: cashData.warehouseId,
        day: bankForm.day,
        closingBalance: Number(bankForm.closing),
        openingBalance: bankForm.opening === "" ? null : Number(bankForm.opening),
        adjustment: Number(bankForm.adjustment) || 0,
        note: bankForm.note || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(typeof b.error === "string" ? b.error : "Could not save");
    }
    setBankForm(null);
    reloadCash();
  }

  async function handleAddBankTransaction() {
    if (!newTxAmount || Number(newTxAmount) <= 0) return;
    setBusy(true);
    setFormError(null);
    const isCredit = BANK_TX_TYPE_LABELS[newTxType]?.isCredit ?? true;
    const res = await fetch("/api/bank/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId: effectiveWarehouseId || undefined,
        businessDate: newTxDate,
        type: newTxType,
        amount: Number(newTxAmount),
        isCredit,
        utrReference: newTxUtr.trim() || undefined,
        bankName: newTxBankName.trim() || undefined,
        partyName: newTxParty.trim() || undefined,
        notes: newTxNotes.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(typeof b.error === "string" ? b.error : "Could not add bank transaction");
    }
    setShowAddBankTx(false);
    setNewTxAmount("");
    setNewTxUtr("");
    setNewTxBankName("");
    setNewTxParty("");
    setNewTxNotes("");
    reloadBank();
  }

  async function handleDepositCash() {
    if (!depositAmount || Number(depositAmount) <= 0) return;
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/bank/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouseId: effectiveWarehouseId || undefined,
        amount: Number(depositAmount),
        bankName: depositBankName.trim() || undefined,
        referenceNo: depositRef.trim() || undefined,
        note: depositNote.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setFormError(typeof b.error === "string" ? b.error : "Deposit failed");
    }
    setShowDepositModal(false);
    setDepositAmount("");
    setDepositBankName("");
    setDepositRef("");
    setDepositNote("");
    reloadCash();
    reloadBank();
  }

  async function toggleReconciled(txId: string, current: boolean) {
    await fetch("/api/bank/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: txId, reconciled: !current }),
    });
    reloadBank();
  }

  const needsOpening = bankForm && cashData && (!cashData.firstBankDay || bankForm.day <= cashData.firstBankDay);

  return (
    <div className="space-y-4">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Cash &amp; Bank Ledger</h1>
          <p className="text-xs text-muted">
            Separate physical drawer cash daybook and comprehensive bank statement reconciliation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && warehouses && warehouses.length > 0 && (
            <label className="text-xs text-muted">
              Warehouse
              <select
                className="block rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
                value={effectiveWarehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-muted">
            From
            <input
              type="date"
              className="block rounded-lg border border-line bg-surface px-2 py-1 text-xs"
              value={since || cashData?.since || ""}
              onChange={(e) => setSince(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted">
            To
            <input
              type="date"
              className="block rounded-lg border border-line bg-surface px-2 py-1 text-xs"
              value={until || cashData?.until || ""}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
          {activeTab === "CASH" ? (
            <button
              type="button"
              className="btn border-accent text-accent hover:bg-accent/10 text-xs font-semibold"
              onClick={() => setShowDepositModal(true)}
            >
              📥 Deposit Drawer Cash to Bank
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary text-xs font-semibold"
              onClick={() => setShowAddBankTx(true)}
            >
              + Record Bank Entry
            </button>
          )}
        </div>
      </div>

      {/* Primary Tab Switcher */}
      <div className="flex border-b border-line bg-surface/50 rounded-t-lg">
        <button
          type="button"
          className={`px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === "CASH" ? "border-accent text-accent bg-paper/50" : "border-transparent text-muted hover:text-ink"
          }`}
          onClick={() => setActiveTab("CASH")}
        >
          💵 Cash Day Book (Drawers &amp; Float)
        </button>
        <button
          type="button"
          className={`px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === "BANK" ? "border-accent text-accent bg-paper/50" : "border-transparent text-muted hover:text-ink"
          }`}
          onClick={() => setActiveTab("BANK")}
        >
          🏦 Bank Statement &amp; BRS Ledger
        </button>
      </div>

      {/* ==================== TAB 1: CASH DAY BOOK ==================== */}
      {activeTab === "CASH" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Physical cash drawer sessions, daily denomination counting, and drawer shortage/excess tracking.
            </p>
            <button
              className="btn text-xs"
              onClick={() => cashData && editBank(cashData.today, cashData.days.find((d) => d.day === cashData.today))}
            >
              Enter EOD Bank Closing Balance
            </button>
          </div>

          {bankForm && (
            <div className="card flex flex-wrap items-end gap-2 border border-accent/40 bg-accent/5">
              <label className="text-xs text-muted">
                Date
                <input
                  type="date"
                  className="block"
                  max={cashData?.today}
                  value={bankForm.day}
                  onChange={(e) => setBankForm({ ...bankForm, day: e.target.value })}
                />
              </label>
              {needsOpening && (
                <label className="text-xs text-muted">
                  Opening balance (first entry)
                  <input
                    type="number"
                    className="block"
                    value={bankForm.opening}
                    onChange={(e) => setBankForm({ ...bankForm, opening: e.target.value })}
                  />
                </label>
              )}
              <label className="text-xs text-muted">
                Closing balance (statement)
                <input
                  type="number"
                  className="block"
                  value={bankForm.closing}
                  onChange={(e) => setBankForm({ ...bankForm, closing: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted">
                Other bank in/out (optional)
                <input
                  type="number"
                  className="block"
                  value={bankForm.adjustment}
                  onChange={(e) => setBankForm({ ...bankForm, adjustment: e.target.value })}
                />
              </label>
              <label className="min-w-48 flex-1 text-xs text-muted">
                Note (optional)
                <input
                  className="block w-full"
                  value={bankForm.note}
                  onChange={(e) => setBankForm({ ...bankForm, note: e.target.value })}
                />
              </label>
              <button className="btn-primary" disabled={busy || bankForm.closing === "" || !bankForm.day} onClick={saveBank}>
                Save
              </button>
              <button className="btn" onClick={() => setBankForm(null)}>
                Cancel
              </button>
              {formError && <p className="w-full text-sm text-bad">{formError}</p>}
            </div>
          )}

          {cashError && <ErrorRetry message={cashError} onRetry={reloadCash} />}
          {cashLoading || !cashData ? (
            !cashError && <SkeletonTable rows={6} cols={10} />
          ) : (
            <div className="card overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th rowSpan={2}>Date</th>
                    <th colSpan={6}>Cash drawer</th>
                    <th colSpan={4}>Bank</th>
                    <th rowSpan={2}>Difference</th>
                    <th rowSpan={2}>Status</th>
                  </tr>
                  <tr>
                    <th>Opening</th>
                    <th>Sales − refunds</th>
                    <th>Out / in</th>
                    <th>Software</th>
                    <th>Counted</th>
                    <th>Not in drawer</th>
                    <th>Opening</th>
                    <th>Expected in</th>
                    <th>Expected</th>
                    <th>Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {cashData.days.map((d) => {
                    const out = Number(d.cash.bankDeposits) + Number(d.cash.paidOut) - Number(d.cash.cashIn);
                    const st = STATUS[d.status];
                    return (
                      <Fragment key={d.day}>
                        <tr className="cursor-pointer" onClick={() => setOpenDay(openDay === d.day ? null : d.day)}>
                          <td>{fmtDate(d.day)}</td>
                          <td>{rs(d.cash.opening)}</td>
                          <td>{rs(Number(d.cash.sales) - Number(d.cash.refunds))}</td>
                          <td>{out === 0 ? "—" : `${out > 0 ? "−" : "+"}${rs(Math.abs(out))}`}</td>
                          <td>{rs(d.cash.software)}</td>
                          <td>{rs(d.cash.counted)}</td>
                          <td>{rs(d.cash.notInDrawer)}</td>
                          <td>{rs(d.bank?.opening)}</td>
                          <td>{d.bank ? rs(Number(d.bank.inflow) + Number(d.bank.adjustment)) : "—"}</td>
                          <td>{rs(d.bank?.expected)}</td>
                          <td>{rs(d.bank?.closing)}</td>
                          <td className={`font-semibold ${st.cls}`}>{d.bank?.difference != null ? rs(d.bank.difference) : "—"}</td>
                          <td className={st.cls}>{st.label}</td>
                        </tr>
                        {openDay === d.day && (
                          <tr>
                            <td colSpan={13}>
                              <DayDetail day={d} onEditBank={() => editBank(d.day, d)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {cashData.days.length === 0 && (
                    <tr>
                      <td colSpan={13} className="text-center text-muted">
                        Nothing in this date range
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: BANK STATEMENT & BRS ==================== */}
      {activeTab === "BANK" && (
        <div className="space-y-4">
          {/* Summary Cards */}
          {bankData?.summary && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="card flex flex-col justify-between border-l-4 border-l-good">
                <span className="text-xs text-muted font-medium">Total Bank Inflows (Credits)</span>
                <span className="text-xl font-bold text-good mt-1">{rs(bankData.summary.totalCredits)}</span>
              </div>
              <div className="card flex flex-col justify-between border-l-4 border-l-bad">
                <span className="text-xs text-muted font-medium">Total Bank Outflows (Debits)</span>
                <span className="text-xl font-bold text-bad mt-1">{rs(bankData.summary.totalDebits)}</span>
              </div>
              <div className="card flex flex-col justify-between border-l-4 border-l-accent">
                <span className="text-xs text-muted font-medium">Net Bank Movement</span>
                <span className="text-xl font-bold text-ink mt-1">{rs(bankData.summary.netMovement)}</span>
              </div>
            </div>
          )}

          {bankError && <ErrorRetry message={bankError} onRetry={reloadBank} />}
          {bankLoading || !bankData ? (
            !bankError && <SkeletonTable rows={6} cols={7} />
          ) : (
            <div className="card overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type / Purpose</th>
                    <th>Party / Reference</th>
                    <th>Bank / A/C</th>
                    <th>Inflow (+)</th>
                    <th>Outflow (−)</th>
                    <th>Reconciled</th>
                  </tr>
                </thead>
                <tbody>
                  {bankData.transactions.map((t) => {
                    const typeInfo = BANK_TX_TYPE_LABELS[t.type] ?? { label: t.type, isCredit: t.isCredit };
                    return (
                      <tr key={t.id}>
                        <td>{fmtDate(t.businessDate)}</td>
                        <td>
                          <div className="font-semibold text-ink">{typeInfo.label}</div>
                          {t.notes && <div className="text-xs text-muted">{t.notes}</div>}
                        </td>
                        <td>
                          <div>{t.partyName || "—"}</div>
                          {t.utrReference && <div className="text-xs font-mono text-muted">UTR: {t.utrReference}</div>}
                        </td>
                        <td>
                          <div>{t.bankName || "—"}</div>
                          {t.accountNumber && <div className="text-xs text-muted">A/C: {t.accountNumber}</div>}
                        </td>
                        <td className="font-semibold text-good">
                          {t.isCredit ? rs(t.amount) : "—"}
                        </td>
                        <td className="font-semibold text-bad">
                          {!t.isCredit ? rs(t.amount) : "—"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`badge cursor-pointer ${
                              t.reconciled ? "bg-good/20 text-good border-good/30" : "bg-warn/20 text-warn border-warn/30"
                            }`}
                            onClick={() => toggleReconciled(t.id, t.reconciled)}
                            title="Click to toggle reconciliation status"
                          >
                            {t.reconciled ? "✓ Reconciled" : "Pending Match"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {bankData.transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-muted">
                        No bank transactions recorded for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== MODAL: ADD BANK ENTRY (ALL FIELDS OPTIONAL) ==================== */}
      {showAddBankTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-2xl animate-scale-up space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-bold text-ink">Record Bank Transaction</h3>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowAddBankTx(false)}>
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              Quick entry for bank statement &amp; BRS. <strong>Only amount is required</strong>; all other fields are optional.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Transaction Type</label>
                  <select
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                    value={newTxType}
                    onChange={(e) => setNewTxType(e.target.value)}
                  >
                    <option value="CUSTOMER_TRANSFER">Customer Transfer (NEFT/RTGS)</option>
                    <option value="UPI_COLLECTION">UPI Settlement</option>
                    <option value="DIRECT_DEPOSIT">Cash Deposit</option>
                    <option value="CHEQUE_CLEARANCE">Cheque Cleared</option>
                    <option value="SUPPLIER_PAYMENT">Supplier Payout</option>
                    <option value="EXPENSE_PAYOUT">Operational Expense</option>
                    <option value="BANK_CHARGES">Bank Charges / Fees</option>
                    <option value="ADJUSTMENT">Manual Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Amount *</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-ink"
                    value={newTxAmount}
                    onChange={(e) => setNewTxAmount(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Date (Optional)</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                    value={newTxDate}
                    onChange={(e) => setNewTxDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">UTR / Ref No. (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. UTR1928301"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                    value={newTxUtr}
                    onChange={(e) => setNewTxUtr(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Bank Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. HDFC Bank"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                    value={newTxBankName}
                    onChange={(e) => setNewTxBankName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Party Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Corp"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                    value={newTxParty}
                    onChange={(e) => setNewTxParty(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Notes / Memo (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Direct customer payment via IMPS"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                  value={newTxNotes}
                  onChange={(e) => setNewTxNotes(e.target.value)}
                />
              </div>
            </div>

            {formError && <p className="text-xs text-bad">{formError}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button className="btn text-xs" onClick={() => setShowAddBankTx(false)}>
                Cancel
              </button>
              <button
                className="btn-primary text-xs font-bold"
                disabled={busy || !newTxAmount || Number(newTxAmount) <= 0}
                onClick={handleAddBankTransaction}
              >
                {busy ? "Saving…" : "Save Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: DEPOSIT DRAWER CASH TO BANK ==================== */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl animate-scale-up space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-base font-bold text-ink">Deposit Drawer Cash to Bank</h3>
              <button className="text-muted hover:text-ink text-sm" onClick={() => setShowDepositModal(false)}>
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              Records a cash withdrawal from the physical counter drawer and automatically logs a corresponding credit in the Bank Statement.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Amount to Deposit *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm font-semibold text-muted">₹</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    className="w-full rounded-lg border border-line bg-surface py-2 pl-8 pr-3 text-base font-bold text-ink"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Receiving Bank Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. State Bank of India, HDFC"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                  value={depositBankName}
                  onChange={(e) => setDepositBankName(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Slip / Receipt Reference (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Slip #9821"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                  value={depositRef}
                  onChange={(e) => setDepositRef(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Daily cash deposit after lunch"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                />
              </div>
            </div>

            {formError && <p className="text-xs text-bad">{formError}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <button className="btn text-xs" onClick={() => setShowDepositModal(false)}>
                Cancel
              </button>
              <button
                className="btn-primary text-xs font-bold"
                disabled={busy || !depositAmount || Number(depositAmount) <= 0}
                onClick={handleDepositCash}
              >
                {busy ? "Depositing…" : "Confirm Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DayDetail({ day, onEditBank }: { day: Day; onEditBank: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { data: txs, error, loading } = useApiGet<Tx[]>(sessionId ? `/api/cash/sessions/${sessionId}` : null);
  const b = day.bank;

  return (
    <div className="space-y-3 py-2">
      <table>
        <thead>
          <tr>
            <th>Counter</th>
            <th>Open → counted</th>
            <th>Opening</th>
            <th>Bills</th>
            <th>Refunds</th>
            <th>Deposited</th>
            <th>Paid out</th>
            <th>Put in</th>
            <th>Software</th>
            <th>Counted</th>
            <th>Not in drawer</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {day.drawers.map((s) => (
            <tr key={s.id}>
              <td>{s.userName}</td>
              <td>
                {fmtTime(s.openedAt)} →{" "}
                {s.state === "OPEN" ? (
                  <span className="text-warn">still open</span>
                ) : s.state === "NOT_COUNTED" ? (
                  <span className="text-bad">not counted</span>
                ) : (
                  fmtTime(s.closedAt!)
                )}
              </td>
              <td>{rs(s.openingCash)}</td>
              <td>
                {rs(s.sales)} ({s.saleCount})
              </td>
              <td>{rs(s.refunds)}</td>
              <td>{rs(s.bankDeposits)}</td>
              <td>{rs(s.paidOut)}</td>
              <td>{rs(s.cashIn)}</td>
              <td>{rs(s.software)}</td>
              <td>{rs(s.actualCash)}</td>
              <td className={s.notInDrawer && Number(s.notInDrawer) < 0 ? "text-bad" : ""}>{rs(s.notInDrawer)}</td>
              <td>{s.note}</td>
              <td>
                <button className="btn text-xs" onClick={() => setSessionId(sessionId === s.id ? null : s.id)}>
                  {sessionId === s.id ? "Hide" : "Entries"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sessionId && (
        <div className="card max-h-80 overflow-y-auto">
          {error && <p className="text-sm text-bad">{error}</p>}
          {loading && <p className="text-sm text-muted">Loading…</p>}
          {txs?.length === 0 && <p className="text-sm text-muted">No entries</p>}
          {txs?.map((t, i) => (
            <div key={i} className="flex justify-between gap-2 text-sm">
              <span>
                {fmtTime(t.at)} · {TX_LABEL[t.type] ?? t.type}
                {t.billNumber && (
                  <a className="ml-1 underline" href={`/manager/orders/${t.orderId}`}>
                    {t.billNumber}
                  </a>
                )}
                {t.note && <span className="text-muted"> — {t.note}</span>}
              </span>
              <span>
                {t.type === "SALE" || t.type === "OTHER_RECEIPT" ? "+" : "−"}
                {rs(t.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {Number(day.upi) !== 0 && <span>UPI taken on the UPI screen: {rs(day.upi)}</span>}
        {b ? (
          <span>
            Bank: {rs(b.opening)} + {rs(b.inflow)} expected in
            {b.daysCovered > 1 && ` (${b.daysCovered} days since the last entry)`}
            {Number(b.adjustment) !== 0 && ` ${Number(b.adjustment) > 0 ? "+" : "−"} ${rs(Math.abs(Number(b.adjustment)))} other`} = {rs(b.expected)}; statement {rs(b.closing)}
            {b.note && <span className="text-muted"> — {b.note}</span>}
          </span>
        ) : (
          <span className="text-muted">No bank balance entered for this day — it rolls into the next entry.</span>
        )}
        <button className="btn text-xs" onClick={onEditBank}>
          {b ? "Edit bank balance" : "Enter bank balance"}
        </button>
      </div>
    </div>
  );
}
