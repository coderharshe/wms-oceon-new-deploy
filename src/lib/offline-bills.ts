// Offline-first Finance billing. Every bill, cash collection and revision is
// written to this PC (IndexedDB) BEFORE any network call, then sent to the
// server from one FIFO outbox, strictly in the order it happened. Nothing
// leaves the PC until the server has confirmed it: the router at the counter
// goes down, the PC and printer are on a UPS, and a bill must survive both.
//
// Why each rule below exists:
// - Every item carries its own id, sent as clientRequestId, so a retry of a
//   send whose response was lost is recognised server-side as a duplicate
//   (src/lib/idempotency.ts). That is what makes retrying — and the 15s
//   timeout — safe.
// - A definite rejection (400/404/409/422) sets the item aside as "needs
//   attention" with the server's reason; the rest of the queue carries on.
//   Anything else (offline, timeout, 401/403, 5xx) stops the pass and tries
//   again later, so a later item never overtakes an earlier one.
// - Cash and revisions name the bill they belong to (billRequestId) and wait
//   while that bill is still in the outbox — cash for a bill the server has
//   never seen can only fail.
import { openOfflineDb } from "./offline-catalog";
import { buildInvoiceHtml } from "./invoice";
import { BUSINESS_TZ, invoiceStamp } from "./fmt";
import { printHtml } from "./print";

export type ReviseItem = { productId: string; quantity: number; unitId: string; discount: number; unitPrice?: number };
export type BillDisplay = {
  customerName: string;
  customerMobile: string | null;
  sellingMode: "WHOLESALE" | "RETAIL";
  notes: string | null;
  lines: { productId: string; unitId: string; name: string; unit: string; quantity: number; unitPrice: number; discount: number; lineTotal: number }[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};
export type SyncState = "pending" | "synced" | "attention";
export type LocalBill = {
  requestId: string; // = clientRequestId sent to the server; primary key
  offlineRef: string; // OFF-<STAFF>-<MMDD>-<NNN>
  billedAt: string; // ISO
  payload: Record<string, unknown>; // exact POST /api/finance/orders body (without clientRequestId/offlineRef/billedAt), every line with unitPrice
  display: BillDisplay;
  state: SyncState;
  error?: string;
  server?: { orderId: string; orderNumber: string; billId: string | null; billNumber: string | null };
  // dismissedAt: the server refused this cash and a person dismissed it, having
  // been told to hand it back or record it by hand. Kept, never deleted.
  cash: { requestId: string; amountReceived: number; clickedAt: string; state: SyncState; error?: string; dismissedAt?: string }[];
  updatedAt: string;
  // Changes queued as revisions (the bill was already on its way when edited):
  // `display` shows the changed bill, `payload` stays what was sent. One entry
  // per revision, oldest first; `before` is the display to go back to if that
  // revision is dismissed. Non-empty = "change waiting to sync".
  displayChanges?: { queueId: string; before: BillDisplay }[];
};

/** Thrown by submitBill when the basket differs from a bill that may already be on the server — the change was NOT applied. */
export class BillAlreadySentError extends Error {
  constructor(public bill: LocalBill) {
    super(`This bill was already sent as ${bill.server?.billNumber ?? bill.offlineRef} — your changes were not applied. Open it and use Modify Bill.`);
  }
}

export type QueuedAction = {
  id: string; // also the clientRequestId it is sent with
  url: string;
  body: Record<string, unknown>;
  queuedAt: string; // FIFO order
  kind?: "bill" | "cash" | "revise"; // absent: a plain queued POST (stock-in via offline-fetch.ts)
  billRequestId?: string; // held back while this bill is still in the outbox
  attempts?: number;
  // A send was started and may have reached the server, so the body is frozen:
  // editing it now would be answered "duplicate" and the edit silently lost.
  // Cleared again only by a definite rejection, which proves nothing was written.
  attempted?: boolean;
  lastError?: string; // why the last try didn't go through (still pending)
  failedAt?: string; // set aside — needs attention (name kept from the old outbox)
  error?: string; // the server's reason for setting it aside
  status?: number; // the HTTP status it was set aside with
};

type SyncStatus = { pending: number; attention: number; syncing: boolean; online: boolean };

const OUTBOX = "outbox";
const BILLS = "localBills";
const META = "meta";
const SEND_TIMEOUT_MS = 15_000;
const KEEP_SYNCED_MS = 7 * 24 * 60 * 60 * 1000; // reprint window for synced bills

// ── Pure logic (tested in __tests__/offline-client.ts) ───────────────────

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server: each line's figures are rounded before summing, so the printed total equals the billed one. */
export function lineMoney(l: { quantity: number; unitPrice: number; discount: number; taxPercent: number }) {
  const gross = round2(l.quantity * l.unitPrice);
  const discount = round2(l.discount);
  const net = round2(gross - discount);
  const tax = round2(net * (l.taxPercent / 100));
  return { gross, discount, net, tax, total: round2(net + tax) };
}

export function moneyTotals(lines: { gross: number; discount: number; tax: number }[]) {
  const subtotal = round2(lines.reduce((s, m) => s + m.gross, 0));
  const discountTotal = round2(lines.reduce((s, m) => s + m.discount, 0));
  const taxTotal = round2(lines.reduce((s, m) => s + m.tax, 0));
  return { subtotal, discountTotal, taxTotal, total: round2(subtotal - discountTotal + taxTotal) };
}

/** What a server answer means for a queued item. */
export function classifyStatus(status: number): "ok" | "reject" | "retry" {
  if (status >= 200 && status < 300) return "ok";
  // The server looked at the data and said no — retrying can't help. 401/403
  // (session), 408/425/429, 5xx and "no answer" (0) are all "try again later".
  if (status === 400 || status === 404 || status === 409 || status === 422) return "reject";
  return "retry";
}

/** "FIN-1" -> "FIN1": the provisional number is read aloud and typed into search. */
export const staffCode = (staffId: string) => staffId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16) || "PC";

/** The business (IST) calendar date as "YYYYMMDD" — a bill at 00:30 IST is the new day, not UTC's yesterday. */
export function businessYmd(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at).replace(/-/g, "");
}

/** Counter key: per staff, per business day, so the number restarts at 001 each morning. */
export const offlineSeqKey = (staffId: string, at: Date) => `offline-seq:${staffCode(staffId)}:${businessYmd(at)}`;

/**
 * OFF-<STAFF>-<DEVICE>-<MMDD>-<NNN>. The counter lives in this browser's
 * IndexedDB, so another PC — or this one after its site data is cleared —
 * starts again at 001. The device code (random, made once per IndexedDB)
 * keeps those numbers apart.
 */
export const formatOfflineRef = (staffId: string, device: string, at: Date, n: number) =>
  `OFF-${staffCode(staffId)}-${device}-${businessYmd(at).slice(4)}-${String(n).padStart(3, "0")}`;

/** 3 base-36 characters: 46,656 codes, plenty for a handful of counters. */
export function newDeviceCode(random: Uint32Array = crypto.getRandomValues(new Uint32Array(1))): string {
  return (random[0]! % 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
}

/** The orders route answers a validation failure with zod's flatten() object, not a sentence. */
export function errorText(error: unknown): string | null {
  if (typeof error === "string") return error;
  const e = error as { formErrors?: unknown; fieldErrors?: Record<string, unknown> } | null;
  if (!e || typeof e !== "object") return null;
  const parts = [
    ...(Array.isArray(e.formErrors) ? e.formErrors.map(String) : []),
    ...Object.entries(e.fieldErrors ?? {}).map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`),
  ];
  return parts.length ? parts.join("; ") : null;
}

/** Cash the server refused on the data (not a lost connection) — the only cash a person may dismiss. */
export const cashDismissable = (i: QueuedAction) => i.kind === "cash" && !!i.failedAt && (i.status === 400 || i.status === 409);

/**
 * The next item to send, or undefined. FIFO by queuedAt; skips items set
 * aside, and cash/revisions whose bill is still in the outbox (pending or
 * set aside) — they go right after their bill does.
 */
export function firstSendable(items: QueuedAction[]): QueuedAction | undefined {
  const billsNotOnServer = new Set(items.filter((i) => i.kind === "bill").map((i) => i.id));
  return [...items]
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .find((i) => !i.failedAt && !(i.billRequestId && billsNotOnServer.has(i.billRequestId)));
}

/** Server ids from a create (201 {order, bill}) or duplicate (200 {duplicate, order, bill}) answer. */
export function serverIdsFrom(data: unknown): LocalBill["server"] {
  const d = data as { order?: { id?: string; orderNumber?: string } | null; bill?: { id?: string; billNumber?: string } | null } | null;
  if (!d?.order?.id) return undefined;
  return { orderId: d.order.id, orderNumber: d.order.orderNumber ?? "", billId: d.bill?.id ?? null, billNumber: d.bill?.billNumber ?? null };
}

// ── IndexedDB plumbing ───────────────────────────────────────────────────

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** One transaction; resolves only once it has COMMITTED. Only IDB requests may be awaited inside `fn`. */
async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openOfflineDb();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
  });
  done.catch(() => {}); // surfaced below; don't also report it as unhandled
  try {
    const result = await fn(t);
    await done;
    return result;
  } catch (err) {
    try {
      t.abort();
    } catch {
      /* already finished */
    }
    throw err;
  }
}

async function allItems(): Promise<QueuedAction[]> {
  if (typeof indexedDB === "undefined") return [];
  const items = await tx([OUTBOX], "readonly", (t) => req(t.objectStore(OUTBOX).getAll() as IDBRequest<QueuedAction[]>));
  return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

// Strictly increasing within the tab, so two items queued in the same
// millisecond (a bill and its cash) can't swap places.
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Status fan-out ───────────────────────────────────────────────────────

const listeners = new Set<(s: SyncStatus) => void>();
let syncing = false;
// Another tab (or the flusher in this one) changed the outbox — header counts
// in every open tab follow.
// Browser only: on the server (and under tsx tests) an open channel would keep
// the process alive.
const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("taresh-outbox") : null;
if (typeof window !== "undefined") {
  if (channel) channel.onmessage = () => void emit();
  window.addEventListener("online", () => void emit());
  window.addEventListener("offline", () => void emit());
}

async function emit() {
  if (listeners.size === 0) return;
  const items = await allItems().catch(() => []);
  const s: SyncStatus = {
    pending: items.filter((i) => !i.failedAt).length,
    attention: items.filter((i) => i.failedAt).length,
    syncing,
    online: typeof navigator === "undefined" || navigator.onLine,
  };
  listeners.forEach((l) => l(s));
}

function changed() {
  channel?.postMessage("changed");
  void emit();
}

export function subscribeSync(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  void emit();
  return () => void listeners.delete(cb);
}

// ── Flushing ─────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let again = false;

/** Sends what is queued, in order. Resolves when this tab's pass (including any pass requested meanwhile) is done. */
export function flushQueue(): Promise<void> {
  if (typeof indexedDB === "undefined" || !navigator.onLine) return Promise.resolve();
  if (running) {
    again = true; // something was queued mid-pass; that pass may already have read the outbox
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        // Two tabs flushing at once would send the same item twice (harmless
        // server-side, but it doubles every request). The Web Lock serialises
        // passes across tabs; the flag above covers this tab without it.
        if ("locks" in navigator) await navigator.locks.request("taresh-outbox-flush", runPass);
        else await runPass();
      } while (again);
    } catch {
      // IndexedDB unavailable — nothing can have been queued either
    } finally {
      running = null;
    }
  })();
  return running;
}

export const syncNow = flushQueue;

async function runPass() {
  syncing = true;
  void emit();
  try {
    // ponytail: re-reads the whole outbox per item (O(n²)); fine for the
    // hundreds a long outage queues. Keep a cursor if it ever reaches thousands.
    while (navigator.onLine) {
      const item = await claimNext();
      if (!item) return;
      const answer = await send(item);
      const verdict = await settle(item.id, answer);
      changed();
      if (verdict === "retry") return; // keep FIFO: nothing overtakes a pending item
    }
  } finally {
    syncing = false;
    void emit();
  }
}

/** Picks the next item and marks it attempted in the SAME transaction — the atomic step editQueuedBill races against. */
function claimNext(): Promise<QueuedAction | undefined> {
  return tx([OUTBOX], "readwrite", async (t) => {
    const store = t.objectStore(OUTBOX);
    const next = firstSendable(await req(store.getAll() as IDBRequest<QueuedAction[]>));
    if (!next) return undefined;
    const claimed = { ...next, attempted: true, attempts: (next.attempts ?? 0) + 1 };
    store.put(claimed);
    return claimed;
  });
}

async function send(item: QueuedAction): Promise<{ status: number; data: unknown; error?: string }> {
  // A hung request must not freeze the queue behind it. Aborting is safe:
  // if it did land, the retry is answered "duplicate".
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.body, clientRequestId: item.id }),
      signal: ac.signal,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null, error: ac.signal.aborted ? "The server took too long to answer" : "No connection to the server" };
  } finally {
    clearTimeout(timer);
  }
}

function reasonFrom(answer: { status: number; data: unknown; error?: string }): string {
  const fromServer = errorText((answer.data as { error?: unknown } | null)?.error);
  if (fromServer) return fromServer;
  if (answer.error) return answer.error;
  if (answer.status === 401) return "Signed out — sign in again to send it";
  return `The server returned ${answer.status}`;
}

async function settle(id: string, answer: { status: number; data: unknown; error?: string }) {
  const verdict = classifyStatus(answer.status);
  const reason = reasonFrom(answer);
  await tx([OUTBOX, BILLS], "readwrite", async (t) => {
    const out = t.objectStore(OUTBOX);
    const bills = t.objectStore(BILLS);
    const item = (await req(out.get(id))) as QueuedAction | undefined;
    if (!item) return;
    const billId = item.kind === "bill" ? item.id : item.billRequestId;
    const bill = billId ? ((await req(bills.get(billId))) as LocalBill | undefined) : undefined;
    const now = new Date().toISOString();

    if (verdict === "retry") {
      out.put({ ...item, lastError: reason });
      return;
    }
    // "Already on the server" with no order to show for it (a key claimed
    // before the order carried its request id, or another warehouse's) is not
    // a sync: marked synced, its cash and changes would 404 forever with no
    // bill to point at. Set it aside for a person instead.
    const serverIds = item.kind === "bill" && verdict === "ok" ? serverIdsFrom(answer.data) ?? bill?.server : undefined;
    const unlinked = item.kind === "bill" && verdict === "ok" && !serverIds;
    const ok = verdict === "ok" && !unlinked;
    const why = unlinked
      ? `The server says this bill was already received but didn't say which bill it became. Search Orders for ${bill?.offlineRef ?? "its OFF number"} before billing it again.`
      : reason;
    const state: SyncState = ok ? "synced" : "attention";
    if (ok) out.delete(id);
    // Set aside, never deleted. A rejection also proves nothing was written,
    // so a rejected bill may be edited and sent again — but an unlinked one
    // WAS written, so it stays attempted and can't be edited into a second bill.
    else out.put({ ...item, attempted: unlinked, failedAt: now, error: why, status: answer.status, lastError: undefined });

    if (!bill) return;
    if (item.kind === "bill") {
      bill.state = state;
      bill.error = ok ? undefined : why;
      if (ok) bill.server = serverIds;
    } else if (item.kind === "cash") {
      bill.cash = bill.cash.map((c) => (c.requestId === id ? { ...c, state, error: verdict === "ok" ? undefined : reason } : c));
    } else if (item.kind === "revise" && verdict === "ok" && bill.displayChanges?.some((c) => c.queueId === id)) {
      bill.displayChanges = bill.displayChanges.filter((c) => c.queueId !== id); // on the server now; the display is the bill
    } else return;
    bill.updatedAt = now;
    bills.put(bill);
  });
  return verdict;
}

let started = false;
/** Call once (RegisterServiceWorker does) — flushes on load, on reconnect, and periodically as a backstop. */
export function startQueueFlusher() {
  if (started || typeof window === "undefined") return;
  started = true;
  void flushQueue();
  window.addEventListener("online", () => void flushQueue());
  setInterval(() => void flushQueue(), 30_000);
}

// ── Queue API ────────────────────────────────────────────────────────────

let staff = "";
/** The signed-in staff id, for provisional numbers. The session cookie is httpOnly, so the Finance layout hands it over (SyncStatus). */
export function setSyncStaff(staffId: string) {
  staff = staffId;
}

/** A plain queued POST (stock-in and friends via offline-fetch.ts). */
export async function queueAction(url: string, body: Record<string, unknown>, id: string = crypto.randomUUID()): Promise<string> {
  await tx([OUTBOX], "readwrite", async (t) => {
    t.objectStore(OUTBOX).put({ id, url, body, queuedAt: stamp() } satisfies QueuedAction);
  });
  changed();
  return id;
}

export async function getQueue(): Promise<QueuedAction[]> {
  return (await allItems()).filter((a) => !a.failedAt);
}

/** Items set aside — never deleted; surfaced so someone can act. */
export async function getFailedActions(): Promise<QueuedAction[]> {
  return (await allItems()).filter((a) => a.failedAt);
}

const billBody = (b: LocalBill) => ({ ...b.payload, offlineRef: b.offlineRef, billedAt: b.billedAt });

export async function getLocalBill(requestId: string): Promise<LocalBill | null> {
  if (typeof indexedDB === "undefined") return null;
  return ((await tx([BILLS], "readonly", (t) => req(t.objectStore(BILLS).get(requestId)))) as LocalBill | undefined) ?? null;
}

export async function listLocalBills(): Promise<LocalBill[]> {
  if (typeof indexedDB === "undefined") return [];
  const all = (await tx([BILLS], "readonly", (t) => req(t.objectStore(BILLS).getAll()))) as LocalBill[];
  return all.sort((a, b) => b.billedAt.localeCompare(a.billedAt));
}

/**
 * Saves the bill on this PC (with its provisional number) and starts sending
 * it. Resolves "synced" with server ids if the server confirmed within
 * `waitMs`, otherwise with the bill as it stands ("pending", or "attention" if
 * the server refused it). Throws only if the PC itself couldn't save it.
 *
 * `requestId` (optional, beyond the contract) is the New Order basket's id:
 * pressing Generate again on the same basket must not make a second bill. If
 * that bill is still editable (never sent, or refused) the new contents
 * replace it; otherwise it is left exactly as it is.
 */
export async function submitBill(input: { payload: Record<string, unknown>; display: BillDisplay; requestId?: string }, waitMs = 3000): Promise<LocalBill> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const existing = await getLocalBill(requestId);
  if (existing) {
    // Same contents (a second press of Generate) is fine; different contents
    // that can't be applied must never be swallowed.
    if ((await editQueuedBill(requestId, input)) === "already-sent" && JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) {
      throw new BillAlreadySentError(existing);
    }
  } else {
    await tx([BILLS, OUTBOX, META], "readwrite", async (t) => {
      const at = new Date();
      const meta = t.objectStore(META);
      // Allocated inside the save transaction: two tabs can't take the same
      // number, and a number is never used by a bill that didn't save.
      const key = offlineSeqKey(staff, at);
      const n = (((await req(meta.get(key))) as { value?: number } | undefined)?.value ?? 0) + 1;
      meta.put({ key, value: n });
      let device = ((await req(meta.get("device-code"))) as { value?: string } | undefined)?.value;
      if (!device) meta.put({ key: "device-code", value: (device = newDeviceCode()) });
      const bill: LocalBill = {
        requestId,
        offlineRef: formatOfflineRef(staff, device, at, n),
        billedAt: at.toISOString(),
        payload: input.payload,
        display: input.display,
        state: "pending",
        cash: [],
        updatedAt: at.toISOString(),
      };
      t.objectStore(BILLS).put(bill);
      t.objectStore(OUTBOX).put({ id: requestId, kind: "bill", url: "/api/finance/orders", body: billBody(bill), queuedAt: stamp() } satisfies QueuedAction);
    });
    changed();
    void pruneSynced();
  }
  // A pass that finds no connection returns at once, so an outage prints the
  // slip immediately instead of making the counter wait out the 3 seconds.
  await Promise.race([flushQueue(), sleep(waitMs)]);
  return (await getLocalBill(requestId))!;
}

async function pruneSynced() {
  const cutoff = new Date(Date.now() - KEEP_SYNCED_MS).toISOString();
  await tx([BILLS], "readwrite", async (t) => {
    const store = t.objectStore(BILLS);
    for (const b of (await req(store.getAll())) as LocalBill[]) {
      if (b.state === "synced" && b.cash.every((c) => c.state === "synced" || c.dismissedAt) && b.updatedAt < cutoff) store.delete(b.requestId);
    }
  }).catch(() => {});
}

export async function collectCashOffline(requestId: string, amountReceived: number): Promise<LocalBill> {
  const cashId = crypto.randomUUID();
  const clickedAt = new Date().toISOString(); // when the cash was taken, not when it synced
  const bill = await tx([BILLS, OUTBOX], "readwrite", async (t) => {
    const bill = (await req(t.objectStore(BILLS).get(requestId))) as LocalBill | undefined;
    if (!bill) throw new Error("This bill isn't saved on this PC");
    bill.cash = [...bill.cash, { requestId: cashId, amountReceived, clickedAt, state: "pending" }];
    bill.updatedAt = clickedAt;
    t.objectStore(BILLS).put(bill);
    t.objectStore(OUTBOX).put({
      id: cashId,
      kind: "cash",
      billRequestId: requestId,
      url: "/api/finance/payments/cash",
      body: { orderRequestId: requestId, amountReceived, clickedAt },
      queuedAt: stamp(),
    } satisfies QueuedAction);
    return bill;
  });
  changed();
  void flushQueue();
  return bill;
}

/** Replaces a bill that the server can't have seen yet. "already-sent" once a send has started (or it synced) — revise it instead. */
export async function editQueuedBill(requestId: string, input: { payload: Record<string, unknown>; display: BillDisplay }): Promise<"edited" | "already-sent"> {
  const result = await tx([BILLS, OUTBOX], "readwrite", async (t) => {
    const item = (await req(t.objectStore(OUTBOX).get(requestId))) as QueuedAction | undefined;
    const bill = (await req(t.objectStore(BILLS).get(requestId))) as LocalBill | undefined;
    // Same transaction as the flusher's claim, so the check can't go stale.
    if (!item || !bill || item.attempted) return "already-sent" as const;
    const edited: LocalBill = { ...bill, payload: input.payload, display: input.display, state: "pending", error: undefined, updatedAt: new Date().toISOString() };
    t.objectStore(BILLS).put(edited);
    // Keeps its place in the queue (queuedAt); a set-aside bill goes back in.
    t.objectStore(OUTBOX).put({ ...item, body: billBody(edited), failedAt: undefined, error: undefined, lastError: undefined });
    return "edited" as const;
  });
  if (result === "edited") {
    changed();
    void flushQueue();
  }
  return result;
}

/**
 * Queues a revision. `orderIdOrRequestId` may be a server order id or a
 * LocalBill requestId (the revise route accepts either). A revision queued
 * while an earlier one for the same bill is still unsent replaces it — both
 * carry the full item list, and sending the stale one first would only make
 * the second a version conflict.
 */
export async function queueRevision(
  orderIdOrRequestId: string,
  body: { items: ReviseItem[]; reason: string; expectedVersion: number | null },
  /** Beyond the contract: the bill as it looks with this change, for a bill saved on this PC — shown and reprinted until the revision syncs. */
  display?: BillDisplay
): Promise<{ requestId: string }> {
  const local = (await listLocalBills()).find((b) => b.requestId === orderIdOrRequestId || b.server?.orderId === orderIdOrRequestId);
  const target = local?.requestId ?? orderIdOrRequestId;
  const url = `/api/finance/orders/${encodeURIComponent(target)}/revise`;
  const id = await tx([OUTBOX, BILLS], "readwrite", async (t) => {
    const store = t.objectStore(OUTBOX);
    const items = (await req(store.getAll())) as QueuedAction[];
    const unsent = items.find((i) => i.kind === "revise" && i.url === url && !i.attempted && !i.failedAt);
    let id: string;
    if (unsent) {
      id = unsent.id;
      store.put({ ...unsent, body: { ...unsent.body, items: body.items, reason: body.reason } });
    } else {
      id = crypto.randomUUID();
      store.put({
        id,
        kind: "revise",
        billRequestId: local?.requestId,
        url,
        body: { items: body.items, reason: body.reason, expectedVersion: body.expectedVersion ?? undefined },
        queuedAt: stamp(),
      } satisfies QueuedAction);
    }
    if (local && display) {
      const bill = (await req(t.objectStore(BILLS).get(local.requestId))) as LocalBill | undefined;
      if (bill) {
        const changes = bill.displayChanges ?? [];
        // A merged revision keeps the `before` it already had.
        if (!changes.some((c) => c.queueId === id)) changes.push({ queueId: id, before: bill.display });
        t.objectStore(BILLS).put({ ...bill, display, displayChanges: changes, updatedAt: new Date().toISOString() });
      }
    }
    return id;
  });
  changed();
  void flushQueue();
  return { requestId: id };
}

/** Puts set-aside items back in the queue: the item with this id, or everything set aside for the bill with this requestId. */
export async function retryAttention(requestIdOrQueueId: string): Promise<void> {
  await tx([OUTBOX, BILLS], "readwrite", async (t) => {
    const out = t.objectStore(OUTBOX);
    const bills = t.objectStore(BILLS);
    const now = new Date().toISOString();
    for (const item of (await req(out.getAll())) as QueuedAction[]) {
      if (!item.failedAt || (item.id !== requestIdOrQueueId && item.billRequestId !== requestIdOrQueueId)) continue;
      out.put({ ...item, failedAt: undefined, error: undefined });
      const bill = (await req(bills.get(item.kind === "bill" ? item.id : (item.billRequestId ?? "")))) as LocalBill | undefined;
      if (!bill) continue;
      if (item.kind === "bill") bill.state = "pending";
      else if (item.kind === "cash") bill.cash = bill.cash.map((c) => (c.requestId === item.id ? { ...c, state: "pending", error: undefined } : c));
      else continue;
      bill.error = item.kind === "bill" ? undefined : bill.error;
      bill.updatedAt = now;
      bills.put(bill);
    }
  });
  changed();
  await flushQueue();
}

/**
 * Beyond the contract: removes a set-aside item after a person has read why
 * — a revision that lost a version conflict (redone by hand), a refused
 * stock-in, a refused bill nobody took money for.
 *
 * Cash only when the server refused it on the data (400/409, e.g. the bill was
 * already paid) AND `confirmCashHandled` says the person was told to hand it
 * back or record it by hand. The LocalBill keeps that cash, marked dismissed.
 * A bill with cash on it can't be dismissed.
 */
export async function dismissAttention(queueId: string, opts: { confirmCashHandled?: boolean } = {}): Promise<void> {
  await tx([OUTBOX, BILLS], "readwrite", async (t) => {
    const item = (await req(t.objectStore(OUTBOX).get(queueId))) as QueuedAction | undefined;
    if (!item?.failedAt) throw new Error("Only an item that needs attention can be dismissed");
    const billId = item.kind === "bill" ? queueId : item.billRequestId;
    const bill = billId ? ((await req(t.objectStore(BILLS).get(billId))) as LocalBill | undefined) : undefined;
    if (item.kind === "cash") {
      if (!cashDismissable(item)) throw new Error("This cash can't be dismissed — retry it once the bill is fixed");
      if (!opts.confirmCashHandled) throw new Error("Confirm the cash was handed back or recorded by hand first");
      if (bill) {
        const now = new Date().toISOString();
        bill.cash = bill.cash.map((c) => (c.requestId === queueId ? { ...c, dismissedAt: now } : c));
        t.objectStore(BILLS).put({ ...bill, updatedAt: now });
      }
    } else if (item.kind === "bill") {
      if (bill?.cash.length) throw new Error("Cash was taken on this bill — fix and retry it instead");
      t.objectStore(BILLS).delete(queueId);
    } else if (item.kind === "revise" && bill?.displayChanges) {
      // Undo what this change did to the saved copy; a later change built on
      // top of it now reverts to what came before this one.
      const changes = bill.displayChanges;
      const i = changes.findIndex((c) => c.queueId === queueId);
      if (i >= 0) {
        if (i === changes.length - 1) bill.display = changes[i]!.before;
        else changes[i + 1] = { ...changes[i + 1]!, before: changes[i]!.before };
        changes.splice(i, 1);
        t.objectStore(BILLS).put({ ...bill, displayChanges: changes, updatedAt: new Date().toISOString() });
      }
    }
    t.objectStore(OUTBOX).delete(queueId);
  });
  changed();
}

/** The provisional slip, built and printed on this PC — no network needed. */
export async function printLocalBill(bill: LocalBill): Promise<void> {
  const d = bill.display;
  const { date, time } = invoiceStamp(bill.billedAt);
  await printHtml(
    buildInvoiceHtml({
      // Not printed by the invoice template today, so no settings fetch to cache.
      businessName: "Store",
      billNumber: bill.server?.billNumber ?? bill.offlineRef,
      orderNumber: bill.server?.orderNumber ?? bill.offlineRef,
      date,
      time,
      customerName: d.customerName,
      customerMobile: d.customerMobile,
      sellingMode: d.sellingMode,
      notes: d.notes,
      items: d.lines.map((l) => ({ name: l.name, quantity: String(l.quantity), unit: l.unit, unitPrice: l.unitPrice.toFixed(2), lineTotal: l.lineTotal.toFixed(2) })),
      subtotal: d.subtotal.toFixed(2),
      discountTotal: d.discountTotal.toFixed(2),
      taxTotal: d.taxTotal.toFixed(2),
      total: d.total.toFixed(2),
    })
  );
}
