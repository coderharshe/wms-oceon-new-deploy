"use client";

import { useEffect, useRef, useState } from "react";
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // Position calculation strictly clamped to viewport bounds
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePos = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(420, window.innerWidth - 32);
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      setPos({
        top: rect.bottom + 8,
        left,
        width: dropdownWidth,
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  // Click outside and Escape key to close popup
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest("#sync-status-container") && !target.closest("#sync-status-modal")) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

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
  const tone =
    s.attention > 0
      ? "border-bad text-bad bg-bad/10 hover:bg-bad/20"
      : s.pending > 0
      ? "border-warn text-warn bg-warn/10 hover:bg-warn/20"
      : "text-good border-good/40 bg-good/5 hover:bg-good/15 font-semibold";

  return (
    <div id="sync-status-container" className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        className={`btn text-xs font-bold py-1.5 px-3 transition-all ${tone}`}
        onClick={() => setOpen((o) => !o)}
        title={s.online ? "Terminal is online with central database" : "No internet — bills are saved on this terminal"}
      >
        <span>📡 {label}</span>
        {!s.online && <span className="ml-1 text-[11px] text-bad font-black">· OFFLINE</span>}
        {s.syncing && <span className="ml-1 animate-pulse">…</span>}
      </button>

      {open && pos && (
        <div
          id="sync-status-modal"
          style={{ position: "fixed", top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
          className="z-50 max-h-[85vh] overflow-hidden rounded-2xl border-2 border-line bg-paper shadow-2xl ring-4 ring-black/10 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line bg-surface-hi px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📡</span>
              <div>
                <h3 className="text-sm font-bold text-ink leading-tight">Server &amp; Terminal Sync</h3>
                <p className="text-[11px] text-muted">
                  {s.online ? "Connected to central server" : "Terminal operating in offline mode"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg p-1 text-muted hover:bg-line/50 hover:text-ink text-sm font-bold"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto p-3.5 space-y-2.5">
            {items.length === 0 ? (
              <div className="rounded-lg border border-good/30 bg-good/10 p-3.5 text-center">
                <div className="text-lg">✅</div>
                <div className="mt-1 text-sm font-bold text-good">All Changes Synchronized</div>
                <p className="mt-0.5 text-xs text-muted">
                  Everything on this terminal is up-to-date with the central database server.
                </p>
              </div>
            ) : (
              items.map((i) => (
                <div key={i.id} className="rounded-lg border border-line bg-surface p-3 text-sm space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-ink">{describe(i)}</span>
                    <span
                      className={`badge text-[10px] uppercase font-bold ${
                        i.failedAt ? "bg-bad/15 text-bad border border-bad/30" : "bg-warn/15 text-warn border border-warn/30"
                      }`}
                    >
                      {i.failedAt ? "⚠️ Needs Attention" : "⏳ Queued"}
                    </span>
                  </div>
                  {(i.error ?? i.lastError) && (
                    <p className="text-xs text-bad bg-bad/5 p-2 rounded border border-bad/20 font-mono">
                      {i.error ?? i.lastError}
                    </p>
                  )}
                  {i.failedAt && (
                    <div className="mt-2 flex items-center gap-2 pt-1 border-t border-line">
                      <button
                        type="button"
                        className="btn-primary text-xs py-1 px-2.5"
                        onClick={() => act(() => retryAttention(i.id))}
                      >
                        🔄 Retry Sync
                      </button>
                      {cashDismissable(i) && (
                        <button
                          type="button"
                          className="btn text-xs py-1 px-2.5 hover:bg-bad/10 hover:text-bad"
                          onClick={() => {
                            const amount = Number((i.body as { amountReceived?: number }).amountReceived ?? 0);
                            if (confirmDismissCash(amount, i.error)) {
                              void act(() => dismissAttention(i.id, { confirmCashHandled: true }));
                            }
                          }}
                        >
                          Dismiss
                        </button>
                      )}
                      {i.kind !== "cash" && !("billId" in (i.body as object)) && (
                        <button
                          type="button"
                          className="btn text-xs py-1 px-2.5 hover:bg-bad/10 hover:text-bad"
                          onClick={() => act(() => dismissAttention(i.id))}
                          title="Remove from terminal once sorted out"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {actionError && (
              <div className="rounded-lg border border-bad/30 bg-bad/10 p-2.5 text-xs font-semibold text-bad">
                {actionError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-line bg-surface px-4 py-2.5 text-right">
            <button
              type="button"
              className="btn text-xs font-bold hover:bg-surface-hi"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
