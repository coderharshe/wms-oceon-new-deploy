"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useShortcuts, getShortcutKey } from "@/lib/shortcuts";
import { useEscapeKey } from "@/lib/keynav";
import { fmtDateTime, fmtQty, fmtTime } from "@/lib/fmt";
import { ModifyBill, type ModifiableLine } from "@/components/ModifyBill";
import { getCachedProducts, type CachedProduct } from "@/lib/offline-catalog";
import {
  subscribeSync,
  getLocalBill,
  getQueue,
  getFailedActions,
  printLocalBill,
  collectCashOffline,
  editQueuedBill,
  queueRevision,
  retryAttention,
  dismissAttention,
  cashDismissable,
  round2,
  type LocalBill,
  type QueuedAction,
  type ReviseItem,
} from "@/lib/offline-bills";
import { editLocalBill, outboxForBill } from "@/lib/offline-screens";

/** The confirm a person must accept before refused cash leaves the queue — the money is real even if the server said no. */
export function confirmDismissCash(amount: number, reason: string | undefined): boolean {
  return confirm(
    `The server refused ₹${amount.toFixed(2)} cash: ${reason ?? "no reason given"}.\n\n` +
      `Dismissing it means it will NOT reach the books. Hand the ₹${amount.toFixed(2)} back to the customer, or record it by hand, before you press OK.`
  );
}

/**
 * A bill as this PC saved it: reprint the provisional slip, take cash, change
 * the bill — all to this PC first, all with the router down. Shown in place
 * (LocalBillOverlay) wherever reaching the /finance/orders/local route would
 * need a network round trip, and as that route's body.
 */
export function LocalBillView({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  // undefined = still reading this PC; null = not on this PC
  const [bill, setBill] = useState<LocalBill | null | undefined>(undefined);
  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const [online, setOnline] = useState(true);
  const [products, setProducts] = useState<CachedProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [cashNote, setCashNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [b, failed, waiting] = await Promise.all([getLocalBill(requestId), getFailedActions(), getQueue()]);
      setBill(b);
      setQueued(outboxForBill([...failed, ...waiting], { requestId, orderId: b?.server?.orderId, billId: b?.server?.billId }));
    } catch {
      setBill(null); // IndexedDB unavailable: nothing can have been saved here either
    }
  }, [requestId]);

  // Every change to the outbox (a send landing, cash queued in another tab) re-reads the bill.
  useEffect(
    () =>
      subscribeSync((s) => {
        setOnline(s.online);
        void refresh();
      }),
    [refresh]
  );
  useEffect(() => {
    getCachedProducts().then(setProducts).catch(() => {});
  }, []);

  async function reprint() {
    if (!bill || busy) return;
    setError(null);
    await printLocalBill(bill).catch((err: unknown) => setError(`Could not print: ${err instanceof Error ? err.message : String(err)}`));
  }

  useShortcuts({ "print-bill": reprint });
  // Esc closes — unless something inside (ModifyBill mounts after this, so its
  // handler runs after this one) claimed it. Checked once the event is done.
  useEscapeKey((e) => {
    setTimeout(() => {
      if (!e.defaultPrevented) onClose();
    }, 0);
  });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (bill === undefined) return <p className="text-sm text-muted">Opening the bill saved on this PC…</p>;
  if (bill === null) {
    return (
      <div className="card space-y-2">
        <p className="text-sm">This bill isn&rsquo;t saved on this PC. It may have been made on another counter, or synced more than a week ago.</p>
        <div className="flex gap-3 text-sm">
          <Link href="/finance/orders" className="text-accent underline">
            Search orders
          </Link>
          <button type="button" className="text-accent underline" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
      </div>
    );
  }

  const d = bill.display;
  // Dismissed cash was refused by the server and handed back / recorded by hand — not money on this bill.
  const collected = round2(bill.cash.filter((c) => !c.dismissedAt).reduce((s, c) => s + c.amountReceived, 0));
  // The server records a bill as paid in cash when it is created unless it was
  // ticked Unpaid — so cash taken here too would be refused as a second payment.
  const paidOnSync = !bill.payload.unpaid && d.total > 0;
  const balance = round2(d.total - collected);
  const received = Number(cashReceived);
  const change = received > balance ? round2(received - balance) : 0;
  const serverHref = bill.server ? `/finance/orders/${bill.server.orderId}` : null;
  const synced = bill.state === "synced";

  async function payCash() {
    if (!(received > 0) || busy || synced) return;
    await act(async () => {
      await collectCashOffline(bill!.requestId, received);
      setCashNote(change > 0 ? `Recorded ₹${received.toFixed(2)} — give back ₹${change.toFixed(2)}. Saved on this PC, will sync after the bill.` : `Recorded ₹${received.toFixed(2)}. Saved on this PC, will sync after the bill.`);
      setCashReceived("");
    });
  }

  // A bill not sent yet is edited in place; once a send has started, the
  // server may have it, so the change goes as a revision of version 1 queued
  // behind the bill — and the saved copy shows (and reprints) the change.
  async function saveEdit(items: ReviseItem[], reason: string): Promise<string> {
    const edit = editLocalBill(bill!, items, products);
    if ((await editQueuedBill(bill!.requestId, edit)) === "edited") return "Bill changed on this PC — reprint it for the customer.";
    await queueRevision(bill!.requestId, { items: edit.payload.items as ReviseItem[], reason, expectedVersion: 1 }, edit.display);
    return "The bill was already on its way — the change is saved on this PC and will sync after it. Reprint it for the customer.";
  }

  const lines: ModifiableLine[] = d.lines.map((l) => {
    const p = products.find((x) => x.id === l.productId);
    return {
      id: `${l.productId}:${l.unitId}`,
      productId: l.productId,
      unitId: l.unitId,
      product: p ? { name: l.name, wholesalePrice: p.wholesalePrice, retailPrice: p.retailPrice, saleUnits: p.saleUnits } : { name: l.name, saleUnits: [{ unitId: l.unitId, unit: { id: l.unitId, symbol: l.unit } }] },
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
    };
  });

  return (
    <div className="space-y-3">
      {synced ? (
        <div className="rounded border border-line bg-paper px-3 py-2 text-sm text-good" role="status">
          Synced as {bill.server?.billNumber ?? bill.server?.orderNumber ?? "a server bill"}.{" "}
          {serverHref && (
            <Link href={serverHref} className="text-accent underline">
              Open the bill
            </Link>
          )}
        </div>
      ) : bill.state === "attention" ? (
        <div className="space-y-1 rounded border border-bad px-3 py-2 text-sm text-bad" role="alert">
          <p>Needs attention — the server refused this bill: {bill.error ?? "no reason given"}</p>
          <p className="text-muted">Fix it with Modify Bill (that sends it again), or retry as it is.</p>
          <div className="flex gap-2">
            <button type="button" className="btn text-xs" disabled={busy} onClick={() => act(() => retryAttention(bill.requestId))}>
              Retry
            </button>
            {bill.cash.length === 0 && (
              <button
                type="button"
                className="btn text-xs"
                disabled={busy}
                onClick={() =>
                  confirm(`Discard bill ${bill.offlineRef}? It was never on the server; this removes it from this PC.`) &&
                  act(async () => {
                    await dismissAttention(bill.requestId);
                    onClose();
                  })
                }
              >
                Discard this bill
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900" role="status">
          Waiting to sync — saved on this PC. It gets its INV number, dated {fmtDateTime(bill.billedAt)}, once the server has it.
        </div>
      )}

      {!!bill.displayChanges?.length && (
        <div className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900" role="status">
          Change waiting to sync — the lines below include it; the server gets it right after the bill.
        </div>
      )}

      {queued.map((i) => {
        const b = i.body as { amountReceived?: number; reason?: string };
        const amount = Number(b.amountReceived ?? 0);
        const what = i.kind === "revise" ? `Bill change "${b.reason ?? ""}"` : `Cash ₹${amount.toFixed(2)}`;
        return (
          <div key={i.id} className={`flex flex-wrap items-center gap-2 rounded border px-3 py-1 text-sm ${i.failedAt ? "border-bad text-bad" : "border-line text-muted"}`}>
            <span>{i.failedAt ? `${what} needs attention: ${i.error ?? "refused by the server"}` : `${what} — waiting to sync`}</span>
            {i.failedAt && (
              <>
                <button type="button" className="btn text-xs" disabled={busy} onClick={() => act(() => retryAttention(i.id))}>
                  Retry
                </button>
                {i.kind === "revise" && (
                  <button type="button" className="btn text-xs" disabled={busy} onClick={() => act(() => dismissAttention(i.id))}>
                    Discard my change
                  </button>
                )}
                {cashDismissable(i) && (
                  <button
                    type="button"
                    className="btn text-xs"
                    disabled={busy}
                    onClick={() => confirmDismissCash(amount, i.error) && act(() => dismissAttention(i.id, { confirmCashHandled: true }))}
                  >
                    Dismiss this cash
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {bill.offlineRef} <span className="badge bg-line">PROVISIONAL</span>
          </h1>
          <p className="text-sm text-muted">
            {d.customerName}
            {d.customerMobile ? ` (${d.customerMobile})` : ""} · {d.sellingMode} · Billed {fmtDateTime(bill.billedAt)}
          </p>
        </div>
        <button className="btn" disabled={busy} onClick={reprint} title={`Reprint (${getShortcutKey("print-bill")})`}>
          Reprint ({getShortcutKey("print-bill")})
        </button>
      </div>

      <section className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Bill items</h2>
          {!synced ? (
            <ModifyBill orderId={bill.requestId} sellingMode={d.sellingMode} lines={lines} onSaved={() => void refresh()} disabled={busy} saveWith={saveEdit} />
          ) : (
            serverHref && (
              <Link href={serverHref} className="text-sm text-accent underline">
                Modify on the synced bill
              </Link>
            )
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={`${l.productId}:${l.unitId}`}>
                <td>{l.name}</td>
                <td>
                  {fmtQty(l.quantity)} {l.unit}
                </td>
                <td>₹{l.unitPrice.toFixed(2)}</td>
                <td>₹{l.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 space-y-0.5 text-right text-sm">
          {d.discountTotal > 0 && <div>Discount: ₹{d.discountTotal.toFixed(2)}</div>}
          {d.taxTotal > 0 && <div>Tax: ₹{d.taxTotal.toFixed(2)}</div>}
          <div className="text-base font-semibold">Total: ₹{d.total.toFixed(2)}</div>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="text-sm font-semibold">Payment</h2>
        {synced ? (
          // The server bill is the truth now: it may have been paid there, and a
          // balance worked out from this PC's cash alone would take money twice.
          <p className="text-sm">
            This bill is on the server — take payment on the server bill.{" "}
            {online && serverHref ? (
              <Link href={serverHref} className="text-accent underline">
                Open {bill.server?.billNumber ?? "the bill"} to collect
              </Link>
            ) : (
              <span className="text-muted">No connection right now — collect on the server bill once online.</span>
            )}
          </p>
        ) : paidOnSync ? (
          <p className="text-sm text-good">Paid in cash: ₹{d.total.toFixed(2)}. It's recorded when the bill syncs.</p>
        ) : (
          <>
            <div className="flex gap-6 text-sm">
              <span>Due: ₹{d.total.toFixed(2)}</span>
              <span>Collected on this PC: ₹{collected.toFixed(2)}</span>
              <span className={balance > 0 ? "text-bad" : "text-good"}>Balance: ₹{balance.toFixed(2)}</span>
            </div>
            {balance > 0 && (
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                <div>
                  <label className="mb-1 block text-xs text-muted" htmlFor="cash-received">
                    Cash received
                  </label>
                  <input
                    id="cash-received"
                    className="w-32"
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void payCash();
                      }
                    }}
                  />
                </div>
                <button className="btn-primary" disabled={busy || !(received > 0)} onClick={payCash}>
                  Collect Cash
                </button>
                {change > 0 && <span className="text-sm font-semibold">Change: ₹{change.toFixed(2)}</span>}
              </div>
            )}
          </>
        )}
        {cashNote && <p className="text-sm text-muted">{cashNote}</p>}
        {bill.cash.length > 0 && (
          <table className="mt-2">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {bill.cash.map((c) => (
                <tr key={c.requestId}>
                  <td>₹{c.amountReceived.toFixed(2)}</td>
                  <td className={c.state === "attention" ? "text-bad" : undefined}>
                    {c.dismissedAt
                      ? `Dismissed ${fmtDateTime(c.dismissedAt)} — refused by the server (${c.error ?? ""}); handed back or recorded by hand`
                      : c.state === "synced"
                        ? "Synced"
                        : c.state === "attention"
                          ? `Needs attention: ${c.error ?? ""}`
                          : "Waiting to sync"}
                  </td>
                  <td>{fmtTime(c.clickedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {d.notes && (
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold">Notes</h2>
          <p className="text-sm">{d.notes}</p>
        </section>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

/**
 * The same screen over whatever page is open — no navigation, so it works
 * offline on a route this tab never loaded. The host page must ignore its own
 * Esc while this is open; Esc here closes it.
 */
export function LocalBillOverlay({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Bill saved on this PC"
        className="mx-auto max-w-3xl space-y-2 rounded bg-surface p-3 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button type="button" className="btn text-xs" onClick={onClose}>
            Close (Esc)
          </button>
        </div>
        <LocalBillView requestId={requestId} onClose={onClose} />
      </div>
    </div>
  );
}
