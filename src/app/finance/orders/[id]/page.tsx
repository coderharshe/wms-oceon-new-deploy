"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiGet } from "@/lib/useApiGet";
import { useLiveEvents } from "@/lib/live-events";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonTable, SkeletonCard } from "@/components/Skeleton";
import { printUrl } from "@/lib/print";
import { useShortcuts, getShortcutKey } from "@/lib/shortcuts";
import { useEscapeKey } from "@/lib/keynav";
import { submitQueueable } from "@/lib/offline-fetch";
import { cacheOrderDetail, getCachedOrderDetail } from "@/lib/offline-catalog";
import { warmPages } from "@/components/RegisterServiceWorker";
import { fmtTime, fmtQty } from "@/lib/fmt";
import { ModifyBill } from "@/components/ModifyBill";
import { collectRemovedLines, isActiveLine } from "@/lib/bill-lines";
import { describeHttpError } from "@/lib/http-error";
import { PaymentAdjustments } from "@/components/PaymentAdjustments";
import { subscribeSync, getQueue, getFailedActions, retryAttention, dismissAttention, listLocalBills, type QueuedAction } from "@/lib/offline-bills";
import { outboxForBill } from "@/lib/offline-screens";
import { LocalBillOverlay } from "@/components/LocalBillView";
import Link from "next/link";
import CancelOrderDialog from "@/components/CancelOrderDialog";
import { MultiTenderPaymentModal } from "@/components/MultiTenderPaymentModal";

type Money = string;
type OrderDetail = {
  id: string;
  orderNumber: string;
  clientRequestId?: string | null;
  offlineRef?: string | null;
  status: string;
  sellingMode: string;
  notes: string | null;
  customer: { shopName: string; ownerName: string | null; mobile: string };
  financeUser: { name: string };
  items: { id: string; productId: string; unitId: string; product: { name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits?: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: Money; wholesalePrice: Money; retailPrice: Money; unit: { id: string; symbol: string } | null }[] }; quantity: Money; unitPrice: Money; lineTotal: Money }[];
  bill: {
    id: string;
    billNumber: string;
    paymentStatus: string;
    currentVersion: number;
    payment: {
      id: string;
      amountDue: Money;
      amountPaid: Money;
      transactions: { id: string; type: string; method: string; amount: Money; status: string; timestamp: string }[];
    } | null;
    versions: {
      id: string;
      versionNumber: number;
      versionType: string;
      total: Money;
      reason: string | null;
      createdAt: string;
      createdByUser: { name: string; role: string } | null;
      items: { id: string; productId: string; unitId: string; product: { name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits?: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: Money; wholesalePrice: Money; retailPrice: Money; unit: { id: string; symbol: string } | null }[] }; quantity: Money; unitPrice: Money; lineTotal: Money; changeType: string; previousQuantity: Money | null }[];
    }[];
    adjustments: {
      id: string;
      previousTotal: Money;
      newTotal: Money;
      difference: Money;
      resolutionType: string | null;
    }[];
    unpaidMarks?: { at: string; by: string | null; reason: string | null; amount: string | null }[];
  } | null;
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: fresh, error: loadError, loading, reload: load } = useApiGet<OrderDetail>(`/api/finance/orders/${id}`);
  const { data: qc } = useApiGet<{ enabled: boolean }>("/api/settings/qc");
  const [cached, setCached] = useState<OrderDetail | null>(null);
  // Paint the last-seen copy of this bill immediately, then let the live
  // fetch replace it. `stale` stays true until the server answers — money
  // actions stay disabled that whole time (see the Collect buttons below).
  const order = fresh ?? cached;
  const stale = !fresh;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  // null = the "Mark unpaid" box is closed; a string = open, holding the reason.
  const [unpaidReason, setUnpaidReason] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [upi, setUpi] = useState<{ transactionId: string; link: string; qrDataUrl: string } | null>(null);
  const [otherViewers, setOtherViewers] = useState<Map<string, string>>(new Map());
  const [cashQueued, setCashQueued] = useState(false);
  // Cash and bill changes made on this PC that the server hasn't got yet.
  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  // Offline, and this bill was never opened on this PC: it may still be one
  // this PC made (its saved copy is on the local bill screen).
  const [localCopyId, setLocalCopyId] = useState<string | null>(null);
  // Offline, the saved copy opens in place — its route may never have been loaded in this tab.
  const [showLocalCopy, setShowLocalCopy] = useState(false);
  const [showMultiTender, setShowMultiTender] = useState(false);

  useEffect(() => {
    let live = true;
    getCachedOrderDetail<OrderDetail>(id).then((c) => {
      if (live) setCached(c);
    });
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (fresh) cacheOrderDetail(id, fresh);
  }, [id, fresh]);

  // Reached in-app, this bill's HTML was never loaded — store it (without ?print=1) so a
  // reload during a power cut still opens it. Each bill needs its own: the id is baked in.
  const loaded = !!fresh;
  useEffect(() => {
    if (loaded) warmPages([`/finance/orders/${id}`]);
  }, [id, loaded]);

  const orderId = order?.id;
  const billId = order?.bill?.id;
  const requestId = order?.clientRequestId;
  const pendingCount = useRef(0);
  useEffect(() => {
    return subscribeSync(() => {
      Promise.all([getFailedActions(), getQueue()])
        .then(([failed, waiting]) => {
          const mine = outboxForBill([...failed, ...waiting], { orderId: orderId ?? id, billId, requestId });
          const stillWaiting = mine.filter((i) => !i.failedAt).length;
          // Something of ours just reached the server — show the bill it made.
          if (stillWaiting < pendingCount.current) load();
          pendingCount.current = stillWaiting;
          setQueued(mine);
        })
        .catch(() => setQueued([]));
    });
  }, [id, orderId, billId, requestId, load]);

  useEffect(() => {
    if (!loadError || order) return;
    listLocalBills()
      .then((bills) => setLocalCopyId(bills.find((b) => b.requestId === id || b.server?.orderId === id)?.requestId ?? null))
      .catch(() => {});
  }, [loadError, order, id]);

  async function actOnQueued(fn: () => Promise<void>) {
    setQueueError(null);
    await fn().catch((err: unknown) => setQueueError(err instanceof Error ? err.message : String(err)));
  }

  // One shared stream carries both the order's own events and the advisory
  // "someone else is on this order too" presence (staff scope only — the
  // unauthenticated payment display never gets names; see /api/events).
  const myUserIdRef = useRef<string | null>(null);
  useLiveEvents((data) => {
    if (["resync", "payment:updated", "payment:confirmed", "bill:revised", "status:updated"].includes(data.type)) {
      load();
      return;
    }
    if (data.type !== "presence:joined" && data.type !== "presence:left") return;
    if (data.payload.orderId !== id || data.payload.userId === myUserIdRef.current) return;
    setOtherViewers((prev) => {
      const next = new Map(prev);
      if (data.type === "presence:joined") next.set(data.payload.userId, data.payload.name);
      else next.delete(data.payload.userId);
      return next;
    });
  }, id);

  useEffect(() => {
    myUserIdRef.current = null;
    fetch(`/api/finance/orders/${id}/presence`, { method: "POST", body: JSON.stringify({ event: "joined" }) })
      .then((r) => r.json())
      .then((body) => {
        myUserIdRef.current = body.userId ?? null;
      })
      .catch(() => {});
    const leave = () => navigator.sendBeacon(`/api/finance/orders/${id}/presence`, JSON.stringify({ event: "left" }));
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, [id]);

  const autoPrintedRef = useRef(false);

  // Straight to the printer, no tab in between — the counter wants the
  // customer copy out, not a PDF to look at. Same hidden-iframe print
  // send-to-QC already uses, so no popup blocker is involved.
  // Declared above the early returns below: useShortcuts is a hook and must
  // run on every render, and this must not close over `bill`, which is only
  // in scope once those returns are past.
  async function sendToPrinter() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/orders/${id}/invoice`, { method: "POST" });
      // Every failure used to collapse into one sentence: a signed-out
      // session, a warehouse the login can't see and a server that fell over
      // all read identically, so the counter had no idea whether to sign in
      // again or call someone. The status is the one thing always available.
      if (!res.ok) throw new Error(await describeHttpError(res));
      const { url } = await res.json();
      printUrl(url);
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "no response from the server";
      setError(`Could not print the bill: ${detail} — try the Invoice button.`);
    } finally {
      setBusy(false);
    }
  }

  // Button/shortcut entry point: only meaningful once a bill exists. Callers
  // that just created one (finalizeDraft) go straight to sendToPrinter — their
  // `order` in scope is still the pre-bill one.
  async function printBill() {
    if (!order?.bill || busy) return;
    await sendToPrinter();
  }

  // Fixing a name typed wrong at the counter, after the bill exists. It
  // corrects the customer record, which the next print reads fresh.
  const [nameForm, setNameForm] = useState<{ name: string; saving: boolean; error: string | null } | null>(null);
  function openNameForm() {
    if (!order) return;
    setNameForm({ name: order.customer.shopName || order.customer.ownerName || "", saving: false, error: null });
  }
  async function saveName() {
    if (!nameForm || nameForm.saving) return;
    const name = nameForm.name.trim();
    if (!name) return setNameForm({ ...nameForm, error: "Name cannot be empty" });
    setNameForm({ ...nameForm, saving: true, error: null });
    const res = await fetch(`/api/finance/orders/${id}/customer-name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerName: name, shopName: name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setNameForm({ ...nameForm, saving: false, error: typeof body.error === "string" ? body.error : `Could not save the name (HTTP ${res.status})` });
    }
    setNameForm(null);
    load();
  }

  useShortcuts({ "print-bill": printBill, "edit-customer-name": openNameForm });

  // Arriving from the new-bill screen (?print=1): print once, as soon as the
  // bill has loaded. window.location instead of useSearchParams so this page
  // doesn't need a Suspense boundary. The flag is stripped afterwards, so a
  // reload doesn't reprint.
  useEffect(() => {
    if (autoPrintedRef.current || !order?.bill) return;
    if (!new URLSearchParams(window.location.search).has("print")) return;
    autoPrintedRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    printBill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.bill?.id]);
  // Esc steps back one screen, Tally-style: the bill is done, the next thing
  // the counter does is start another one. A nested editor (ModifyBill) claims
  // Esc first, so this never discards an open edit.
  useEscapeKey(() => {
    if (showLocalCopy) return; // the overlay answers its own Esc
    router.push("/finance/orders/new");
  });

  if (loading && !order) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-6 w-64" />
        <SkeletonTable rows={4} cols={4} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  if (loadError && !order) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <ErrorRetry message={loadError} onRetry={load} />
        {localCopyId &&
          (typeof navigator !== "undefined" && navigator.onLine ? (
            <Link href={`/finance/orders/local/${localCopyId}`} className="text-accent underline">
              Open the copy saved on this PC
            </Link>
          ) : (
            <button type="button" className="text-accent underline" onClick={() => setShowLocalCopy(true)}>
              Open the copy saved on this PC
            </button>
          ))}
        {localCopyId && showLocalCopy && <LocalBillOverlay requestId={localCopyId} onClose={() => setShowLocalCopy(false)} />}
      </div>
    );
  }
  if (!order) return null;
  const bill = order.bill;
  const due = bill ? Number(bill.payment?.amountDue ?? 0) : 0;
  const paid = bill ? Number(bill.payment?.amountPaid ?? 0) : 0;
  const balance = due - paid;
  const currentVersion = bill?.versions.find((v) => v.versionNumber === bill.currentVersion) ?? bill?.versions.at(-1);
  // Every product ever dropped from this order, newest removal first — not
  // just the current version's, so a line removed two revisions ago is still
  // accounted for on screen.
  const removedLines = bill ? collectRemovedLines(bill.versions, bill.currentVersion) : [];

  // Safe to queue offline (you asked for this explicitly): idempotency-keyed
  // server-side so a retried flush can't double-charge, and clickedAt is
  // stamped right here — at the moment the button is actually pressed, not
  // whenever the queue eventually syncs — so the record stays accurate for
  // reconciliation either way.
  async function payCash() {
    if (!bill || stale) return; // never take money against a cached balance
    const clickedAt = new Date().toISOString(); // captured at the click, before any await — for camera cross-reference
    setBusy(true);
    setError(null);
    setCashQueued(false);
    try {
      const { queued } = await submitQueueable("/api/finance/payments/cash", { billId: bill.id, amountReceived: Number(cashReceived), clickedAt });
      setCashReceived("");
      setCashQueued(queued);
      if (!queued) load(); // a queued payment isn't in the DB yet — nothing to reload until it syncs
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  // Not queueable offline: it takes money back out of the drawer, so it must
  // run against the live balance, not a saved copy.
  async function markUnpaid() {
    if (stale || !unpaidReason?.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/orders/${order!.id}/mark-unpaid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: unpaidReason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Could not mark the bill unpaid");
    }
    setUnpaidReason(null);
    load();
  }

  async function startUpi() {
    if (stale) return; // same: the amount due here may be a cached figure
    if (!bill) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/finance/payments/upi/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId: bill.id }),
    });
    setBusy(false);
    if (!res.ok) return setError("Could not start UPI payment");
    const data = await res.json();
    setUpi({ transactionId: data.transaction.id, link: data.link, qrDataUrl: data.qrDataUrl });
  }

  async function confirmUpi() {
    if (!upi) return;
    const clickedAt = new Date().toISOString();
    setBusy(true);
    const res = await fetch("/api/finance/payments/upi/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: upi.transactionId, clickedAt }),
    });
    setBusy(false);
    if (!res.ok) return setError("Could not confirm payment");
    setUpi(null);
    load();
  }

  async function sendToQc() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/orders/${id}/send-to-qc`, { method: "POST" });
    if (!res.ok) {
      setBusy(false);
      const body = await res.json().catch(() => ({}));
      return setError(body.error ?? "Could not complete the order");
    }
    // The order has moved on at this point (to QC, or straight to COMPLETED
    // when QC is off), so release the screen now —
    // generating the invoice takes a second or two and the counter has no
    // reason to sit on a disabled button waiting for it.
    setBusy(false);
    load();

    // Invoice generation + print then runs on its own. Backgrounded, but not
    // silent: if it fails the customer copy never comes out of the printer,
    // and that has to be visible rather than swallowed.
    fetch(`/api/finance/orders/${id}/invoice`, { method: "POST" })
      .then(async (invRes) => {
        if (!invRes.ok) throw new Error();
        const { url } = await invRes.json();
        printUrl(url);
      })
      .catch(() =>
        setError(
          qc?.enabled === false
            ? "Order completed, but the bill could not be printed — use Print Bill to retry."
            : "Sent to QC, but the bill could not be printed — use Print Bill to retry."
        )
      );
  }

  async function viewInvoice() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/orders/${id}/invoice`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError("Could not generate invoice");
    const { url } = await res.json();
    window.open(url, "_blank");
  }

  async function finalizeDraft() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/finance/orders/${id}/finalize`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(body.error ?? "Could not generate the bill");
    }
    load();
    sendToPrinter(); // finalizing a draft is when its bill is born — print it, same as a fresh bill
  }


  const canSendToQc = ["BILLED", "PAYMENT_PENDING", "PAID"].includes(order.status);
  const canCancel = ["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID"].includes(order.status);
  const displayTotal = currentVersion ? Number(currentVersion.total) : order.items.reduce((s, i) => s + Number(i.lineTotal), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {stale && loadError && (
        <div className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
          No connection — showing the copy saved on this PC. Changes you make are saved here and sync later.
        </div>
      )}
      {queued.length > 0 && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900" role="status">
          {queued.map((i) => {
            const b = i.body as { amountReceived?: number; reason?: string };
            const what = i.kind === "revise" || i.url.endsWith("/revise") ? `Bill change "${b.reason ?? ""}"` : `Cash ₹${Number(b.amountReceived ?? 0).toFixed(2)}`;
            return (
              <div key={i.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {i.failedAt ? `${what} needs attention: ${i.error ?? "refused by the server"}` : `${what} — saved on this PC, waiting to sync. The figures below don't include it yet.`}
                </span>
                {i.failedAt && (
                  <>
                    <button type="button" className="btn text-xs" onClick={() => actOnQueued(() => retryAttention(i.id))}>
                      Retry
                    </button>
                    {i.kind !== "cash" && !("billId" in (i.body as object)) && (
                      <button type="button" className="btn text-xs" onClick={() => actOnQueued(() => dismissAttention(i.id))}>
                        Discard my change
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {queueError && <p className="text-bad">{queueError}</p>}
        </div>
      )}
      {otherViewers.size > 0 && (
        <div className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
          ⚠ Also viewing this order: {[...otherViewers.values()].join(", ")}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {order.orderNumber} — {bill?.billNumber}
          </h1>
          <p className="text-sm text-muted">
            {order.customer.ownerName || order.customer.shopName}
            {order.customer.ownerName && order.customer.shopName !== order.customer.ownerName ? ` · ${order.customer.shopName}` : ""}
            {order.customer.mobile ? ` (${order.customer.mobile})` : ""} · {order.sellingMode} · Billed by {order.financeUser.name}{" "}
            {!nameForm && (
              <button type="button" className="text-accent underline" onClick={openNameForm}>
                Edit name ({getShortcutKey("edit-customer-name")})
              </button>
            )}
          </p>
          {nameForm && (
            <div
              className="mt-2 flex flex-wrap items-end gap-2 rounded border border-line bg-paper p-2"
              onKeyDown={(e) => {
                // Esc closes this form, not the bill screen behind it.
                if (e.key === "Escape") {
                  e.preventDefault();
                  setNameForm(null);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
            >
              <label className="text-xs text-muted">
                Shop / Customer name
                <input
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  className="block w-64"
                  placeholder="Enter shop or customer name"
                  value={nameForm.name}
                  onChange={(e) => setNameForm({ ...nameForm, name: e.target.value })}
                />
              </label>
              <button type="button" className="btn-primary text-sm" disabled={nameForm.saving} onClick={saveName}>
                {nameForm.saving ? "Saving…" : "Save (Enter)"}
              </button>
              <button type="button" className="btn text-sm" onClick={() => setNameForm(null)}>
                Cancel (Esc)
              </button>
              <p className="w-full text-xs text-muted">
                Corrects this customer&rsquo;s record, so the reprint and their other bills show the new name.
              </p>
              {nameForm.error && <p className="w-full text-xs text-bad">{nameForm.error}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-line">{order.status}</span>
          {bill && <span className="badge bg-line">{bill.paymentStatus}</span>}
          {bill && (
            <button className="btn" disabled={busy} onClick={viewInvoice}>
              Invoice
            </button>
          )}
          {bill && (
            <button className="btn" disabled={busy} onClick={printBill} title={`Print bill (${getShortcutKey("print-bill")})`}>
              Print Bill
            </button>
          )}
          {canCancel && (
            <button className="btn-danger" disabled={busy} onClick={() => setCancelling(true)}>
              Cancel Order
            </button>
          )}
          {cancelling && <CancelOrderDialog orderId={id} paid={paid} onClose={() => setCancelling(false)} onDone={load} />}
        </div>
      </div>

      <section className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Bill items {currentVersion && `(v${currentVersion.versionNumber} — ${currentVersion.versionType})`}
            {currentVersion?.createdByUser && (
              <span className="ml-2 font-normal text-muted">
                edited by {currentVersion.createdByUser.name} ({currentVersion.createdByUser.role})
              </span>
            )}
          </h2>
          {bill && order.status !== "CANCELLED" && (
            <ModifyBill
              orderId={order.id}
              sellingMode={order.sellingMode}
              lines={currentVersion?.items ?? order.items}
              onSaved={load}
              // Offline the saved copy is all there is; the edit carries the
              // version it was made on, so a stale base is refused on sync.
              disabled={busy || (stale && !loadError)}
              expectedVersion={bill.currentVersion}
              queueOffline
            />
          )}
        </div>

        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
              {currentVersion?.versionNumber !== 1 && <th>Change</th>}
            </tr>
          </thead>
          <tbody>
            {(currentVersion?.items ?? order.items).filter(isActiveLine).map((it) => (
              <tr key={it.id}>
                <td>{it.product.name}</td>
                <td>{fmtQty(it.quantity)}</td>
                <td>₹{Number(it.unitPrice).toFixed(2)}</td>
                <td>₹{Number(it.lineTotal).toFixed(2)}</td>
                {currentVersion?.versionNumber !== 1 && "changeType" in it && (
                  <td>{(it as { changeType: string }).changeType}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-right text-base font-semibold">Total: ₹{displayTotal.toFixed(2)}</div>

        {/* Kept out of the table above and off the printed bill — these are
            not goods the customer is getting. They stay on screen because
            "why is this bill smaller than the one I was shown" is the first
            question asked about a revision. */}
        {removedLines.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-1 text-xs font-semibold text-muted">Removed from this bill</h3>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Was</th>
                  <th>Removed in</th>
                </tr>
              </thead>
              <tbody>
                {removedLines.map(({ item, versionNumber }) => (
                  <tr key={item.id} className="text-muted">
                    <td className="line-through">{item.product?.name}</td>
                    <td>{fmtQty(item.previousQuantity ?? 0)}</td>
                    <td>v{versionNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bill && (
        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Payment</h2>
          <div className="flex gap-6 text-sm">
            <span>Due: ₹{due.toFixed(2)}</span>
            <span>Paid: ₹{paid.toFixed(2)}</span>
            <span className={balance > 0 ? "text-bad" : "text-good"}>Balance: ₹{balance.toFixed(2)}</span>
          </div>

          {bill.unpaidMarks?.map((m) => (
            <p key={m.at} className="text-sm text-bad">
              Marked unpaid by {m.by ?? "unknown"} · {fmtTime(m.at)}
              {m.amount ? ` · ₹${Number(m.amount).toFixed(2)}` : ""}
              {m.reason ? ` — ${m.reason}` : ""}
            </p>
          ))}

          {bill.payment?.transactions.some((t) => t.status === "CONFIRMED" && t.method === "CASH" && t.type === "PAYMENT") &&
            (unpaidReason === null ? (
              <button className="btn text-xs" disabled={busy || stale} onClick={() => setUnpaidReason("")}>
                Mark unpaid
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-muted">Why is this bill unpaid? (required)</label>
                  <input
                    className="w-full"
                    autoFocus
                    placeholder="e.g. customer will pay tomorrow"
                    value={unpaidReason}
                    onChange={(e) => setUnpaidReason(e.target.value)}
                  />
                </div>
                <button className="btn-primary" disabled={busy || stale || !unpaidReason.trim()} onClick={markUnpaid}>
                  Mark unpaid
                </button>
                <button className="btn" disabled={busy} onClick={() => setUnpaidReason(null)}>
                  Cancel
                </button>
              </div>
            ))}

          {balance > 0 && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
              <div>
                <label className="mb-1 block text-xs text-muted">Cash received</label>
                <input
                  className="w-32"
                  type="number"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
              </div>
              <button className="btn-primary" disabled={busy || stale || !cashReceived} onClick={payCash}>
                Collect Cash
              </button>
              <button className="btn" disabled={busy || stale} onClick={startUpi}>
                Collect via UPI
              </button>
              <button
                type="button"
                className="btn border-accent text-accent hover:bg-accent/10"
                disabled={busy || stale}
                onClick={() => setShowMultiTender(true)}
              >
                💳 Multi-Tender / Cheque / Bank / Khata
              </button>
              {stale && (
                <span className="text-sm text-muted">
                  {loadError ? "No connection — cash needs the latest balance, so collect once back online." : "Showing your saved copy — checking the latest balance…"}
                </span>
              )}
              {cashQueued && <span className="text-sm text-muted">Recorded offline — will sync once back online.</span>}
            </div>
          )}

          {showMultiTender && bill && (
            <MultiTenderPaymentModal
              billId={bill.id}
              billNumber={bill.billNumber}
              totalDue={due}
              totalPaid={paid}
              customer={order.customer}
              onSuccess={load}
              onClose={() => setShowMultiTender(false)}
            />
          )}

          {upi && (
            <div className="flex items-center gap-4 border-t border-line pt-2">
              <img src={upi.qrDataUrl} alt="UPI QR" width={140} height={140} />
              <div>
                <p className="text-sm text-muted">Waiting for payment confirmation…</p>
                <button className="btn mt-1" disabled={busy} onClick={confirmUpi}>
                  Mark as Confirmed
                </button>
              </div>
            </div>
          )}

          {bill.payment && bill.payment.transactions.length > 0 && (
            <table className="mt-2">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {bill.payment.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{t.method}</td>
                    <td>{t.type}</td>
                    <td>₹{Number(t.amount).toFixed(2)}</td>
                    <td>{t.status === "VOIDED" ? "Cancelled (marked unpaid)" : t.status}</td>
                    <td>{fmtTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {bill && <PaymentAdjustments adjustments={bill.adjustments} onResolved={load} disabled={stale} />}

      {order.notes && (
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold">Notes</h2>
          <p className="text-sm">{order.notes}</p>
        </section>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
      {order.status === "DRAFT" && (
        <button className="btn-primary w-full py-2" disabled={busy} onClick={finalizeDraft}>
          Generate Bill
        </button>
      )}
      {canSendToQc && (
        <button className="btn-primary w-full py-2" disabled={busy} onClick={sendToQc}>
          {qc?.enabled === false ? "Complete Order" : "Send to QC"}
        </button>
      )}
    </div>
  );
}
