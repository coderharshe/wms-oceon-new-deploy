"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";
import { subscribeSync } from "@/lib/offline-bills";
import { fmtDate, fmtTime } from "@/lib/fmt";

import { FinanceDateRangePicker } from "@/components/FinanceDateRangePicker";
import type { DateRangePreset } from "@/lib/date-filter";

type CashFormula = {
  openingCash: number;
  cashSales: number;
  salesCount: number;
  cashReceived: number;
  receivedCount: number;
  cashExpenses: number;
  expensesCount: number;
  cashRefunds: number;
  refundsCount: number;
  bankDeposits: number;
  depositsCount: number;
  expectedClosingCash: number;
};

type CashLedgerEntry = {
  id: string;
  type: string;
  amount: number;
  sign: number;
  note: string | null;
  referenceId: string | null;
  at: string;
  runningBalance: number;
};

type CashCountHistory = {
  id: string;
  closedAt: string;
  openingCash: string;
  expectedCash: string;
  actualCash: string;
  difference: string;
  note: string | null;
};

type TodayCashData = {
  today: string;
  open: { id: string; businessDate: string; openedAt: string; openingCash: string; bills: number } | null;
  formula: CashFormula;
  ledger: CashLedgerEntry[];
  counts: CashCountHistory[];
  dateRange?: {
    preset: DateRangePreset;
    startDateStr: string;
    endDateStr: string;
    label: string;
  };
};

const NOTES = [500, 200, 100, 50, 20, 10];

const rs = (x: number | string) =>
  `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CashManagementPage() {
  const [datePreset, setDatePreset] = useState<DateRangePreset>("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const queryParams = new URLSearchParams();
  if (datePreset !== "today") queryParams.set("preset", datePreset);
  if (datePreset === "custom" && startDate && endDate) {
    queryParams.set("startDate", startDate);
    queryParams.set("endDate", endDate);
  }
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const { data, error, loading, reload: load } = useApiGet<TodayCashData>(`/api/finance/cash/today${queryString}`);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ledgerExpanded, setLedgerExpanded] = useState(true);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals for Drawer Inflow / Outflow
  const [showInflowModal, setShowInflowModal] = useState(false);
  const [inflowForm, setInflowForm] = useState({
    amount: "",
    category: "OWNER_CAPITAL",
    partyName: "Owner",
    narration: "",
  });

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutForm, setPayoutForm] = useState({
    amount: "",
    category: "EXPENSE",
    partyName: "",
    narration: "",
  });

  const [showBankDepositModal, setShowBankDepositModal] = useState(false);
  const [depositForm, setDepositForm] = useState({
    amount: "",
    bankName: "Main Bank Account",
    narration: "",
  });

  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [unsynced, setUnsynced] = useState({ pending: 0, attention: 0 });
  useEffect(() => subscribeSync(setUnsynced), []);
  const unsyncedCount = unsynced.pending + unsynced.attention;

  useEffect(() => {
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  const counted = NOTES.reduce((t, n) => t + n * (Number(notes[n]) || 0), 0) + (Number(coins) || 0);
  const anyCounted = Object.values(notes).some((v) => v !== "") || coins !== "";

  async function post(url: string, body: unknown) {
    setBusy(true);
    setFormError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setFormError(typeof b.error === "string" ? b.error : "Could not save — try again");
      return false;
    }
    load();
    return true;
  }

  async function saveCount(anyway = false) {
    if (unsyncedCount > 0 && !anyway) return setFormError("confirm-unsynced");
    const denominations: Record<string, number> = Object.fromEntries(
      NOTES.map((n) => [String(n), Number(notes[n]) || 0])
    );
    denominations.coins = Math.round(Number(coins) || 0);
    if (await post("/api/finance/cash/close", { actualCash: counted, note: note || undefined, denominations })) {
      setNotes({});
      setCoins("");
      setNote("");
    }
  }

  // Handle Recording Outside Cash Inflow (Money In / Capital / Owner)
  async function handleRecordInflow(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(inflowForm.amount);
    if (!amt || amt <= 0) {
      setModalError("Please enter a valid cash amount");
      return;
    }

    setModalSaving(true);
    setModalError(null);

    const categoryLabels: Record<string, string> = {
      OWNER_CAPITAL: "Owner Capital Inflow",
      DIRECTOR_INFLOW: "Director / Partner Funds",
      OUTSIDE_COLLECTION: "Outside Collection",
      ADVANCE_RECOVERY: "Cash Advance Recovery",
      OTHER_RECEIPT: "Other Cash Inflow",
    };

    const label = categoryLabels[inflowForm.category] || "Cash Inflow";
    const noteText = `[${label}] From: ${inflowForm.partyName.trim() || "Owner"}${
      inflowForm.narration.trim() ? ` — ${inflowForm.narration.trim()}` : ""
    }`;

    try {
      const res = await fetch("/api/finance/cash/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "OTHER_RECEIPT",
          amount: amt,
          note: noteText,
        }),
      });

      const dataRes = await res.json();
      if (!res.ok) throw new Error(dataRes.error || "Failed to record cash inflow");

      setShowInflowModal(false);
      setInflowForm({ amount: "", category: "OWNER_CAPITAL", partyName: "Owner", narration: "" });
      load();
    } catch (err: any) {
      setModalError(err.message || "Error saving cash inflow");
    } finally {
      setModalSaving(false);
    }
  }

  // Handle Recording Cash Payout / Expense (Money Out)
  async function handleRecordPayout(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(payoutForm.amount);
    if (!amt || amt <= 0) {
      setModalError("Please enter a valid amount");
      return;
    }

    setModalSaving(true);
    setModalError(null);

    const noteText = `[Cash Payout] To: ${payoutForm.partyName.trim() || "Vendor/Staff"}${
      payoutForm.narration.trim() ? ` — ${payoutForm.narration.trim()}` : ""
    }`;

    try {
      const res = await fetch("/api/finance/cash/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "WITHDRAWAL",
          amount: amt,
          note: noteText,
        }),
      });

      const dataRes = await res.json();
      if (!res.ok) throw new Error(dataRes.error || "Failed to record cash payout");

      setShowPayoutModal(false);
      setPayoutForm({ amount: "", category: "EXPENSE", partyName: "", narration: "" });
      load();
    } catch (err: any) {
      setModalError(err.message || "Error saving payout");
    } finally {
      setModalSaving(false);
    }
  }

  // Handle Recording Bank Deposit from Drawer
  async function handleRecordBankDeposit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(depositForm.amount);
    if (!amt || amt <= 0) {
      setModalError("Please enter a valid deposit amount");
      return;
    }

    setModalSaving(true);
    setModalError(null);

    const noteText = `[Bank Deposit] Deposited to: ${depositForm.bankName}${
      depositForm.narration.trim() ? ` — ${depositForm.narration.trim()}` : ""
    }`;

    try {
      const res = await fetch("/api/finance/cash/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "BANK_DEPOSIT",
          amount: amt,
          note: noteText,
        }),
      });

      const dataRes = await res.json();
      if (!res.ok) throw new Error(dataRes.error || "Failed to record bank deposit");

      setShowBankDepositModal(false);
      setDepositForm({ amount: "", bankName: "Main Bank Account", narration: "" });
      load();
    } catch (err: any) {
      setModalError(err.message || "Error saving bank deposit");
    } finally {
      setModalSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-6 w-56" />
        <SkeletonCard lines={6} />
      </div>
    );
  }

  if (error || !data)
    return <ErrorRetry message={error ?? "Could not load cash management data"} onRetry={load} />;

  const stale = data.open && data.open.businessDate < data.today;
  const f = data.formula || {
    openingCash: 0,
    cashSales: 0,
    salesCount: 0,
    cashReceived: 0,
    receivedCount: 0,
    cashExpenses: 0,
    expensesCount: 0,
    cashRefunds: 0,
    refundsCount: 0,
    bankDeposits: 0,
    depositsCount: 0,
    expectedClosingCash: 0,
  };

  const filteredLedger = (data.ledger || []).filter((tx) => {
    if (filterType !== "ALL" && tx.type !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNote = tx.note?.toLowerCase().includes(q);
      const matchRef = tx.referenceId?.toLowerCase().includes(q);
      const matchType = tx.type.toLowerCase().includes(q);
      return matchNote || matchRef || matchType;
    }
    return true;
  });

  return (
    <div className="w-full space-y-6 pb-12">
      {/* ── Header & Quick Inflow/Outflow Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-ink">Cash Management &amp; EOD Till</h1>
            <span
              className={`badge ${
                data.open ? "bg-good/15 text-good border border-good/30" : "bg-muted/15 text-muted"
              } font-bold`}
            >
              {data.open ? "🟢 DRAWER OPEN" : "⚪ NO OPEN SESSION"}
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Real-time physical drawer till balance, outside capital receipts, cash payouts &amp; ledger audit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Collect Money from Outside (Owner/Capital Inflow) */}
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setShowInflowModal(true);
            }}
            className="btn-primary text-xs font-bold py-1.5 px-3 flex items-center gap-1.5 shadow-sm hover:scale-[1.02] transition-transform"
          >
            <span>📥</span>
            <span>+ Collect Money / Cash Inflow</span>
          </button>

          {/* Cash Payout */}
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setShowPayoutModal(true);
            }}
            className="btn text-xs font-semibold py-1.5 px-3 flex items-center gap-1.5 text-bad hover:bg-bad/10 border-bad/30"
          >
            <span>📤</span>
            <span>− Cash Payout / Expense</span>
          </button>

          {/* Deposit to Bank */}
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setShowBankDepositModal(true);
            }}
            className="btn text-xs font-semibold py-1.5 px-3 flex items-center gap-1.5 hover:bg-surface-2"
          >
            <span>🏦</span>
            <span>Deposit to Bank</span>
          </button>

          <Link href="/finance" className="btn text-xs font-semibold py-1.5 px-2.5">
            ← Control Center
          </Link>
          <button onClick={() => load()} className="btn text-xs font-semibold py-1.5 px-2.5" title="Refresh data">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ── Date Range Filtering Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-2.5 rounded-xl border border-line">
        <div className="text-xs font-bold text-ink flex items-center gap-1.5">
          <span>📅 Statement Period:</span>
          <strong className="text-accent font-mono">{data.dateRange?.label || "Today"}</strong>
        </div>

        <FinanceDateRangePicker
          preset={datePreset}
          startDate={startDate || data.dateRange?.startDateStr || ""}
          endDate={endDate || data.dateRange?.endDateStr || ""}
          onChange={(p, s, e) => {
            setDatePreset(p);
            setStartDate(s);
            setEndDate(e);
          }}
        />
      </div>

      {/* ── Status Banner (if stale or not counted) ── */}
      {data.open && stale && (
        <div className="card border-2 border-bad bg-bad/5 p-3 text-xs text-bad font-semibold flex items-center justify-between">
          <span>
            ⚠️ Drawer has been open since {fmtDate(data.open.businessDate)} and was not closed EOD. Please count and
            close it now.
          </span>
        </div>
      )}

      {/* ── SECTION 1: PHYSICAL CASH MATHEMATICAL FORMULA CARD ── */}
      <section className="card space-y-4 border-l-4 border-l-primary shadow-sm">
        <div className="flex justify-between items-center border-b border-line pb-2">
          <div>
            <h2 className="text-sm font-black text-ink tracking-tight uppercase">Cash in Drawer (Till Balance)</h2>
            <p className="text-[11px] text-muted">
              Live physical cash expected in the till right now across sales, outside receipts &amp; payouts
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted block font-semibold uppercase">Expected Closing Till Cash</span>
            <span className="text-2xl font-black text-good font-mono">{rs(f.expectedClosingCash)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-2 bg-surface p-3 rounded-lg border border-line">
            <div className="flex justify-between items-center py-1 border-b border-line/60">
              <span className="text-muted font-medium">Opening Cash (Till Start):</span>
              <span className="font-bold text-ink font-mono">{rs(f.openingCash)}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <span className="text-good font-bold">+</span>
                <span className="text-ink font-medium">Counter Cash Sales ({f.salesCount} bills):</span>
              </div>
              <span className="font-bold text-good font-mono">+{rs(f.cashSales)}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-line/60 bg-good/5 px-1.5 rounded">
              <div className="flex items-center gap-1.5">
                <span className="text-good font-bold">+</span>
                <span className="text-good font-semibold">Outside Inflow &amp; Capital Received ({f.receivedCount} entries):</span>
              </div>
              <span className="font-bold text-good font-mono">+{rs(f.cashReceived)}</span>
            </div>
          </div>

          <div className="space-y-2 bg-surface p-3 rounded-lg border border-line">
            <div className="flex justify-between items-center py-1 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <span className="text-bad font-bold">−</span>
                <span className="text-ink font-medium">Cash Expenses / Payouts ({f.expensesCount} slips):</span>
              </div>
              <span className="font-bold text-bad font-mono">−{rs(f.cashExpenses)}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <span className="text-bad font-bold">−</span>
                <span className="text-ink font-medium">Cash Refunds ({f.refundsCount} returns):</span>
              </div>
              <span className="font-bold text-bad font-mono">−{rs(f.cashRefunds)}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <span className="text-bad font-bold">−</span>
                <span className="text-ink font-medium">Deposited to Bank ({f.depositsCount} transfers):</span>
              </div>
              <span className="font-bold text-bad font-mono">−{rs(f.bankDeposits)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: EXPANDABLE CASH LEDGER ── */}
      <section className="card space-y-3">
        <div className="flex flex-wrap justify-between items-center border-b border-line pb-2 gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLedgerExpanded(!ledgerExpanded)}
              className="font-black text-sm text-ink flex items-center gap-1 hover:text-accent cursor-pointer"
            >
              <span>{ledgerExpanded ? "▼" : "▶"}</span>
              <span>📜 Expandable Cash Ledger ({data.ledger?.length || 0} Entries)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-surface rounded border border-line p-0.5 text-xs">
              {["ALL", "SALE", "OTHER_RECEIPT", "WITHDRAWAL", "REFUND", "BANK_DEPOSIT"].map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    filterType === t ? "bg-accent text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {t === "ALL" ? "All" : t === "OTHER_RECEIPT" ? "Inflows / Capital" : t === "WITHDRAWAL" ? "Expenses" : t}
                </button>
              ))}
            </div>

            <input
              type="search"
              placeholder="Search note / party / ref…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs px-2 py-1 w-40 font-semibold"
            />
          </div>
        </div>

        {ledgerExpanded && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted font-bold">
                  <th className="py-2 px-2">Time</th>
                  <th className="py-2 px-2">Transaction Type</th>
                  <th className="py-2 px-2">Ref / Source</th>
                  <th className="py-2 px-2">Narration / Party Name</th>
                  <th className="py-2 px-2 text-right">Inflow (+)</th>
                  <th className="py-2 px-2 text-right">Outflow (−)</th>
                  <th className="py-2 px-2 text-right font-bold">Running Till Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.length > 0 ? (
                  filteredLedger.map((tx) => (
                    <tr key={tx.id} className="border-b border-line hover:bg-surface-hi transition-colors">
                      <td className="py-2 px-2 font-mono text-muted text-[11px]">{fmtTime(tx.at)}</td>
                      <td className="py-2 px-2">
                        <span
                          className={`badge text-[10px] font-semibold ${
                            tx.type === "SALE"
                              ? "bg-good/15 text-good"
                              : tx.type === "OTHER_RECEIPT"
                                ? "bg-good/15 text-good font-bold border border-good/30"
                                : tx.type === "WITHDRAWAL"
                                  ? "bg-bad/15 text-bad"
                                  : tx.type === "REFUND"
                                    ? "bg-warn/15 text-warn"
                                    : "bg-ink/10 text-ink"
                          }`}
                        >
                          {tx.type === "OTHER_RECEIPT" ? "📥 INFLOW / CAPITAL" : tx.type}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-mono text-[11px] text-muted">{tx.referenceId || "—"}</td>
                      <td className="py-2 px-2 text-ink font-medium">{tx.note || "Cash Movement"}</td>
                      <td className="py-2 px-2 text-right font-mono font-bold text-good">
                        {tx.sign > 0 ? `+${rs(tx.amount)}` : "—"}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-bold text-bad">
                        {tx.sign < 0 ? `−${rs(tx.amount)}` : "—"}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-bold text-ink">
                        {rs(tx.runningBalance)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted text-xs">
                      No cash transactions matching the filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── SECTION 3: DENOMINATION EOD COUNT ── */}
      <section className="card space-y-3">
        <div className="flex justify-between items-center border-b border-line pb-2">
          <div>
            <h2 className="text-sm font-bold text-ink">🪙 Denomination Count &amp; Close</h2>
            <p className="text-[10px] text-muted">Count physical cash in drawer for EOD blind closing</p>
          </div>
          <span className="text-xs font-mono font-bold text-good">{rs(counted)}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {NOTES.map((n) => (
            <label key={n} className="text-xs text-muted">
              ₹{n} ×
              <input
                className="w-full mt-0.5 text-xs font-mono"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={notes[n] ?? ""}
                onChange={(e) => setNotes({ ...notes, [n]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <label className="block text-xs text-muted">
          Coins Total (₹):
          <input
            className="w-full mt-0.5 text-xs font-mono"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="0.00"
            value={coins}
            onChange={(e) => setCoins(e.target.value)}
          />
        </label>

        <div className="flex justify-between border-t border-line pt-2 text-sm font-bold">
          <span>Total Cash Counted:</span>
          <span className="font-mono text-good">{rs(counted)}</span>
        </div>

        <input
          className="w-full text-xs"
          placeholder="Closing notes / handover remarks (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <button
          className="btn btn-primary w-full font-bold text-xs py-2"
          disabled={busy || !anyCounted}
          onClick={() => saveCount()}
        >
          {busy ? "Closing Session..." : "Save Count & Close Drawer"}
        </button>
      </section>

      {/* ── Unsynced Bills Warning Dialog ── */}
      {formError === "confirm-unsynced" ? (
        <div className="card space-y-2 border-2 border-bad text-sm bg-bad/5">
          <p className="font-semibold text-bad">
            {unsynced.pending > 0 &&
              `${unsynced.pending} ${unsynced.pending === 1 ? "item is" : "items are"} still waiting to sync`}
            {unsynced.pending > 0 && unsynced.attention > 0 && " and "}
            {unsynced.attention > 0 && `${unsynced.attention} ${unsynced.attention === 1 ? "needs" : "need"} attention`} on
            this PC.
          </p>
          <p className="text-xs">
            Those bills are not in the software total yet. Wait for the header to show Synced ✓, or save anyway.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn text-xs" onClick={() => setFormError(null)}>
              Wait for sync
            </button>
            <button className="btn-danger text-xs font-bold" disabled={busy} onClick={() => saveCount(true)}>
              Save count anyway
            </button>
          </div>
        </div>
      ) : (
        formError && <p className="text-xs text-bad bg-bad/10 p-2 rounded">{formError}</p>
      )}

      {/* ── SECTION 4: PAST COUNTED SESSIONS & DISCREPANCIES ── */}
      {data.counts && data.counts.length > 0 && (
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-line pb-2">
            <h2 className="text-sm font-bold text-ink">🕒 Today&apos;s Closed Drawer Sessions &amp; Variances</h2>
            <span className="text-xs text-muted">{data.counts.length} Closed Sessions</span>
          </div>

          <div className="space-y-2">
            {data.counts.map((c) => {
              const diff = Number(c.difference);
              return (
                <div
                  key={c.id}
                  className="p-2.5 rounded bg-surface border border-line text-xs flex flex-wrap justify-between items-center gap-2"
                >
                  <div>
                    <span className="font-bold text-ink">Closed at {fmtTime(c.closedAt)}</span>
                    {c.note && <span className="text-muted block text-[11px] mt-0.5">Note: {c.note}</span>}
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-muted block text-[10px]">Counted</span>
                      <span className="font-mono font-semibold">{rs(c.actualCash)}</span>
                    </div>
                    <div>
                      <span className="text-muted block text-[10px]">Expected</span>
                      <span className="font-mono font-semibold">{rs(c.expectedCash)}</span>
                    </div>
                    <div>
                      <span className="text-muted block text-[10px]">Difference</span>
                      <span className={`font-mono font-bold ${diff === 0 ? "text-good" : "text-bad"}`}>
                        {diff === 0 ? "✓ Matched" : diff > 0 ? `+${rs(diff)} (Extra)` : `−${rs(Math.abs(diff))} (Short)`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── MODAL: COLLECT OUTSIDE CASH / CAPITAL INFLOW ── */}
      {showInflowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-paper p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-1.5">
                  <span>📥</span> Collect Outside Cash / Capital Inflow
                </h2>
                <p className="text-xs text-muted">
                  Record cash brought into the till from owner, partner, outside recovery, or loan
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInflowModal(false)}
                className="text-muted hover:text-ink font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordInflow} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-ink mb-1">Cash Amount (₹) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  autoFocus
                  placeholder="e.g. 5000"
                  className="w-full text-base font-bold font-mono"
                  value={inflowForm.amount}
                  onChange={(e) => setInflowForm({ ...inflowForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Inflow Category</label>
                <select
                  className="w-full text-xs font-semibold"
                  value={inflowForm.category}
                  onChange={(e) => setInflowForm({ ...inflowForm, category: e.target.value })}
                >
                  <option value="OWNER_CAPITAL">💼 Owner Capital / Inflow</option>
                  <option value="DIRECTOR_INFLOW">🤝 Director / Partner Funds</option>
                  <option value="OUTSIDE_COLLECTION">💰 Direct Outside Collection</option>
                  <option value="ADVANCE_RECOVERY">🔄 Cash Advance Recovery / Loan</option>
                  <option value="OTHER_RECEIPT">💵 Other Outside Cash Receipt</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Received From (Party / Person Name)</label>
                <input
                  type="text"
                  placeholder="e.g. Owner, Farah, Partner Name"
                  className="w-full text-xs"
                  value={inflowForm.partyName}
                  onChange={(e) => setInflowForm({ ...inflowForm, partyName: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Narration / Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Cash brought from outside to increase till cash float"
                  className="w-full text-xs"
                  value={inflowForm.narration}
                  onChange={(e) => setInflowForm({ ...inflowForm, narration: e.target.value })}
                />
              </div>

              {modalError && (
                <div className="p-2.5 rounded bg-bad/10 border border-bad/30 text-bad font-bold text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  className="btn text-xs font-semibold"
                  onClick={() => setShowInflowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="btn-primary text-xs font-bold px-4 py-2"
                >
                  {modalSaving ? "Recording Inflow…" : "✓ Add Cash to Drawer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: RECORD CASH PAYOUT / EXPENSE ── */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-paper p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-bad flex items-center gap-1.5">
                  <span>📤</span> Record Cash Payout / Expense
                </h2>
                <p className="text-xs text-muted">Record cash paid out directly from the till drawer</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                className="text-muted hover:text-ink font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordPayout} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-ink mb-1">Payout Amount (₹) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  autoFocus
                  placeholder="e.g. 1500"
                  className="w-full text-base font-bold font-mono text-bad"
                  value={payoutForm.amount}
                  onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Paid To / Recipient Name</label>
                <input
                  type="text"
                  placeholder="e.g. Electrician, Tea Vendor, Staff Advance"
                  className="w-full text-xs"
                  value={payoutForm.partyName}
                  onChange={(e) => setPayoutForm({ ...payoutForm, partyName: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Narration / Purpose *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Office tea & snacks, petty maintenance"
                  className="w-full text-xs"
                  value={payoutForm.narration}
                  onChange={(e) => setPayoutForm({ ...payoutForm, narration: e.target.value })}
                />
              </div>

              {modalError && (
                <div className="p-2.5 rounded bg-bad/10 border border-bad/30 text-bad font-bold text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  className="btn text-xs font-semibold"
                  onClick={() => setShowPayoutModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="btn-danger text-xs font-bold px-4 py-2"
                >
                  {modalSaving ? "Recording Payout…" : "✓ Deduct Cash from Drawer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: DEPOSIT CASH TO BANK ── */}
      {showBankDepositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-paper p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-1.5">
                  <span>🏦</span> Deposit Cash from Drawer to Bank
                </h2>
                <p className="text-xs text-muted">Transfer physical cash out of drawer for bank deposit</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBankDepositModal(false)}
                className="text-muted hover:text-ink font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordBankDeposit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-ink mb-1">Deposit Amount (₹) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  autoFocus
                  placeholder="e.g. 25000"
                  className="w-full text-base font-bold font-mono"
                  value={depositForm.amount}
                  onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Target Bank Name / Account</label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Current A/C, SBI Branch"
                  className="w-full text-xs"
                  value={depositForm.bankName}
                  onChange={(e) => setDepositForm({ ...depositForm, bankName: e.target.value })}
                />
              </div>

              <div>
                <label className="block font-bold text-ink mb-1">Deposit Slip / Narration (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. EOD cash deposit by driver / manager"
                  className="w-full text-xs"
                  value={depositForm.narration}
                  onChange={(e) => setDepositForm({ ...depositForm, narration: e.target.value })}
                />
              </div>

              {modalError && (
                <div className="p-2.5 rounded bg-bad/10 border border-bad/30 text-bad font-bold text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  className="btn text-xs font-semibold"
                  onClick={() => setShowBankDepositModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="btn-primary text-xs font-bold px-4 py-2"
                >
                  {modalSaving ? "Recording Deposit…" : "✓ Record Bank Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
