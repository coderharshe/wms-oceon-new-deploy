"use client";

import { useEffect, useState } from "react";
import { subscribeSync, setSyncStaff, getQueue, getFailedActions, retryAttention, dismissAttention, cashDismissable, type QueuedAction } from "@/lib/offline-bills";
import { confirmDismissCash } from "./LocalBillView";
import { offlineSession, isSignedOut } from "@/lib/offline-login";

// What a queued item is, in the counter's words.
function describe(i: QueuedAction): string {
  const b = i.body as { offlineRef?: string; customer?: { ownerName?: string }; amountReceived?: number; reason?: string };
  if (i.kind === "bill") return `Bill ${b.offlineRef ?? ""} — ${b.customer?.ownerName ?? ""}`;
  if (i.kind === "cash") return `Cash ₹${Number(b.amountReceived ?? 0).toFixed(2)}`;
  if (i.kind === "revise") return `Bill change: ${b.reason ?? ""}`;
  return i.url.includes("purchase") ? "Stock received" : `Saved action (${i.url})`;
}

/** Header badge: is everything this PC did on the server yet? Click for the list. */
export default function SyncStatus({ staffId }: { staffId: string }) {
  // null until the outbox has been read: "Synced ✓" before then would be a claim nobody checked.
  const [s, setS] = useState<{ pending: number; attention: number; syncing: boolean; online: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueuedAction[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // A saved screen served offline was rendered for whoever was signed in when
  // it was saved; after an offline sign-in the bills carry that person's code.
  // After a log out, the saved screens must not open at all.
  useEffect(() => {
    if (isSignedOut()) return window.location.replace("/login");
    setSyncStaff(offlineSession()?.staffId ?? staffId);
  }, [staffId]);
  useEffect(() => subscribeSync(setS), []);
  useEffect(() => {
    if (!open) return;
    Promise.all([getFailedActions(), getQueue()])
      .then(([failed, queued]) => setItems([...failed, ...queued]))
      .catch(() => setItems([]));
  }, [open, s]);

  async function act(fn: () => Promise<void>) {
    setActionError(null);
    await fn().catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
  }

  if (!s) {
    return (
      <button className="btn text-muted" disabled>
        Checking…
      </button>
    );
  }
  const label =
    s.attention > 0 ? `Needs attention (${s.attention})` : s.pending > 0 ? `Waiting to sync (${s.pending})` : "Synced ✓";
  const tone = s.attention > 0 ? "border-bad text-bad" : s.pending > 0 ? "border-warn text-warn" : "text-good";

  return (
    <div className="relative">
      <button className={`btn ${tone}`} onClick={() => setOpen((o) => !o)} title={s.online ? "" : "No internet — bills are saved on this PC"}>
        {label}
        {!s.online && " · offline"}
        {s.syncing && " …"}
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-1 max-h-96 w-96 overflow-y-auto p-0 shadow-none">
          {items.length === 0 && <p className="p-2 text-sm text-muted">Everything on this PC is on the server.</p>}
          {items.map((i) => (
            <div key={i.id} className="border-b border-line p-2 text-sm last:border-b-0">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{describe(i)}</span>
                <span className={i.failedAt ? "text-bad" : "text-muted"}>{i.failedAt ? "Needs attention" : "Waiting"}</span>
              </div>
              {(i.error ?? i.lastError) && <p className={i.failedAt ? "text-bad" : "text-muted"}>{i.error ?? i.lastError}</p>}
              {i.failedAt && (
                <div className="mt-1 flex gap-2">
                  <button className="btn text-xs" onClick={() => act(() => retryAttention(i.id))}>
                    Retry
                  </button>
                  {cashDismissable(i) && (
                    <button
                      className="btn text-xs"
                      onClick={() => {
                        const amount = Number((i.body as { amountReceived?: number }).amountReceived ?? 0);
                        if (confirmDismissCash(amount, i.error)) void act(() => dismissAttention(i.id, { confirmCashHandled: true }));
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                  {i.kind !== "cash" && (
                    <button className="btn text-xs" onClick={() => act(() => dismissAttention(i.id))} title="Remove it from this PC once it has been sorted out another way">
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {actionError && <p className="p-2 text-sm text-bad">{actionError}</p>}
        </div>
      )}
    </div>
  );
}
