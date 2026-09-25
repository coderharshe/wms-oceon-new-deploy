"use client";

import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";
import { subscribeSync } from "@/lib/offline-bills";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/fmt";

type Today = {
  today: string;
  open: { id: string; businessDate: string; openedAt: string; bills: number } | null;
  movements: { type: string; amount: string; note: string | null; at: string }[];
  counts: { id: string; closedAt: string; expectedCash: string; actualCash: string; difference: string; note: string | null }[];
};

const NOTES = [500, 200, 100, 50, 20, 10];
const MOVES = [
  { type: "BANK_DEPOSIT", label: "Deposited in bank", sign: -1 },
  { type: "WITHDRAWAL", label: "Paid out (expense / owner)", sign: -1 },
  { type: "OTHER_RECEIPT", label: "Cash put in", sign: 1 },
] as const;
const rs = (x: number | string) => `₹${Number(x).toFixed(2)}`;

// The counter's whole EOD job: count the drawer. The drawer opens itself on
// the first cash bill and carries the last count forward, so there is no
// opening balance to type. The count is blind — what the software expects is
// only shown after it is saved.
export default function CashEodPage() {
  const { data, error, loading, reload: load } = useApiGet<Today>("/api/finance/cash/today");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [move, setMove] = useState<{ type: string; amount: string; note: string }>({ type: "BANK_DEPOSIT", amount: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bills and cash still only on this PC aren't in the server's figures yet —
  // counting now compares the drawer against a total that's short.
  const [unsynced, setUnsynced] = useState({ pending: 0, attention: 0 });
  useEffect(() => subscribeSync(setUnsynced), []);
  const unsyncedCount = unsynced.pending + unsynced.attention;

  useEffect(() => {
    const t = setInterval(load, 60000); // human-paced; this page sits open all shift
    return () => clearInterval(t);
  }, [load]);

  const counted = NOTES.reduce((t, n) => t + n * (Number(notes[n]) || 0), 0) + (Number(coins) || 0);
  const anyCounted = Object.values(notes).some((v) => v !== "") || coins !== "";

  async function post(url: string, body: unknown) {
    setBusy(true);
    setFormError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    const denominations: Record<string, number> = Object.fromEntries(NOTES.map((n) => [String(n), Number(notes[n]) || 0]));
    denominations.coins = Math.round(Number(coins) || 0);
    if (await post("/api/finance/cash/close", { actualCash: counted, note: note || undefined, denominations })) {
      setNotes({});
      setCoins("");
      setNote("");
    }
  }

  async function saveMove() {
    if (await post("/api/finance/cash/transactions", { type: move.type, amount: Number(move.amount), note: move.note })) {
      setMove({ ...move, amount: "", note: "" });
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <Skeleton className="h-5 w-48" />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (error || !data) return <ErrorRetry message={error ?? "Could not load"} onRetry={load} />;
  const stale = data.open && data.open.businessDate < data.today;

  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-lg font-semibold">Cash / End of Day</h1>

      <div className="card space-y-1 text-sm">
        {data.open ? (
          <>
            <p>
              Drawer open since {fmtDateTime(data.open.openedAt)} · {data.open.bills} cash {data.open.bills === 1 ? "bill" : "bills"}
            </p>
            {stale && <p className="font-semibold text-bad">Not counted since {fmtDate(data.open.businessDate)} — count it now.</p>}
          </>
        ) : (
          <p className="text-muted">Drawer opens by itself on the first cash bill. Starting with cash already in it? Count it below.</p>
        )}
      </div>

      <div className="card space-y-2">
        <p className="text-sm font-semibold">Cash taken out / put in</p>
        <select className="w-full" value={move.type} onChange={(e) => setMove({ ...move, type: e.target.value })}>
          {MOVES.map((m) => (
            <option key={m.type} value={m.type}>
              {m.label}
            </option>
          ))}
        </select>
        <input className="w-full" type="number" min={0} placeholder="Amount" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} />
        <input className="w-full" placeholder="What for (required)" value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} />
        <button className="btn w-full" disabled={busy || !(Number(move.amount) > 0) || !move.note.trim()} onClick={saveMove}>
          Record
        </button>
        {data.movements.map((m, i) => {
          const def = MOVES.find((x) => x.type === m.type);
          return (
            <div key={i} className="flex justify-between text-sm">
              <span>
                {fmtTime(m.at)} · {def?.label ?? m.type}
                {m.note && <span className="text-muted"> — {m.note}</span>}
              </span>
              <span>
                {def?.sign === 1 ? "+" : "−"}
                {rs(m.amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="card space-y-2">
        <p className="text-sm font-semibold">Count the drawer</p>
        <p className="text-xs text-muted">Took cash to the bank or paid something out? Record it above before counting.</p>
        <div className="grid grid-cols-3 gap-2">
          {NOTES.map((n) => (
            <label key={n} className="text-xs text-muted">
              ₹{n} ×
              <input className="w-full" type="number" min={0} inputMode="numeric" value={notes[n] ?? ""} onChange={(e) => setNotes({ ...notes, [n]: e.target.value })} />
            </label>
          ))}
        </div>
        <label className="block text-xs text-muted">
          Coins (total ₹)
          <input className="w-full" type="number" min={0} inputMode="decimal" value={coins} onChange={(e) => setCoins(e.target.value)} />
        </label>
        <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
          <span>Total counted</span>
          <span>{rs(counted)}</span>
        </div>
        <input className="w-full" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy || !anyCounted} onClick={() => saveCount()}>
          Save count
        </button>
      </div>

      {formError === "confirm-unsynced" ? (
        <div className="card space-y-2 border-2 border-bad text-sm">
          <p className="font-semibold text-bad">
            {unsynced.pending > 0 && `${unsynced.pending} ${unsynced.pending === 1 ? "item is" : "items are"} still waiting to sync`}
            {unsynced.pending > 0 && unsynced.attention > 0 && " and "}
            {unsynced.attention > 0 && `${unsynced.attention} ${unsynced.attention === 1 ? "needs" : "need"} attention`} on this PC.
          </p>
          <p>Those bills are not in the software&apos;s total yet. Wait for the header to show Synced ✓, or save anyway.</p>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setFormError(null)}>
              Wait
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => saveCount(true)}>
              Save anyway
            </button>
          </div>
        </div>
      ) : (
        formError && <p className="text-sm text-bad">{formError}</p>
      )}

      {data.counts.map((c) => {
        const diff = Number(c.difference);
        return (
          <div key={c.id} className="card space-y-1 text-sm">
            <p className="font-semibold">Counted at {fmtTime(c.closedAt)}</p>
            <div className="flex justify-between">
              <span>Counted</span>
              <span>{rs(c.actualCash)}</span>
            </div>
            <div className="flex justify-between">
              <span>Software (if every bill was cash)</span>
              <span>{rs(c.expectedCash)}</span>
            </div>
            <div className={`flex justify-between font-semibold ${diff > 0 ? "text-bad" : ""}`}>
              <span>{diff > 0 ? "Extra in drawer" : diff < 0 ? "Not in drawer — should be in bank (UPI)" : "Matched"}</span>
              <span>{rs(Math.abs(diff))}</span>
            </div>
            {c.note && <p className="text-muted">Note: {c.note}</p>}
          </div>
        );
      })}

    </div>
  );
}
