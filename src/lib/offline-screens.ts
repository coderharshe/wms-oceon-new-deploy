// Pure logic behind the Finance bill screens when the server can't be
// reached: which rows the Orders list shows, what an edit to a bill saved on
// this PC turns into, and which queued items belong to one bill. No IndexedDB
// and no React here, so it is tested directly (__tests__/offline-screens.ts).
import { lineMoney, moneyTotals, round2, type BillDisplay, type LocalBill, type QueuedAction, type ReviseItem } from "./offline-bills";

// ── Modify Bill ──────────────────────────────────────────────────────────

export type EditRow = {
  product: { id: string; name: string } | null;
  unitId: string;
  qty: string;
  rate: string;
  rateSource: "bill" | "typed" | "catalogue";
  removed: boolean;
};

/**
 * The editor's rows as the revise body. `freezeRates` is for a bill that only
 * exists on this PC: it has no server to price a line later, and the slip it
 * reprints must show what will be charged — so every line carries its rate,
 * catalogue ones included. Without it this is exactly the online editor's
 * rule: a catalogue rate is display only and left for the server to resolve.
 */
export function buildReviseItems(rows: EditRow[], reason: string, freezeRates = false): { items: ReviseItem[]; reason: string } | { error: string } {
  // Keyed by product+unit, the same identity the server diffs on.
  const items = new Map<string, ReviseItem>();
  for (const r of rows) {
    if (r.removed || !r.product) continue;
    if (!r.unitId) return { error: `Pick a unit for ${r.product.name || "every line"}` };
    const quantity = Number(r.qty);
    // Taken to zero = dropped, same as an X'd line.
    if (!(quantity > 0)) continue;
    const key = `${r.product.id}:${r.unitId}`;
    if (items.has(key)) return { error: `${r.product.name} appears twice in that unit — combine it into one line` };
    const rate = Number(r.rate);
    if (freezeRates && !(rate > 0)) return { error: `Set a rate for ${r.product.name} — this bill isn't on the server yet to price it` };
    const sendRate = rate > 0 && (freezeRates || r.rateSource !== "catalogue");
    // discount 0 is what the server defaults an omitted one to — the editor has no discount box.
    items.set(key, { productId: r.product.id, unitId: r.unitId, quantity, discount: 0, ...(sendRate ? { unitPrice: rate } : {}) });
  }
  if (items.size === 0) return { error: "A bill must keep at least one line — cancel the order instead" };
  if (!reason.trim()) return { error: "Say why the bill is being modified" };
  return { items: [...items.values()], reason: reason.trim() };
}

type ProductInfo = { id: string; name?: string; taxPercent?: string | number; saleUnits?: { unitId?: string; unit: { id: string; symbol: string } | null }[] };

/**
 * A bill not yet on the server, re-made from edited lines: the new POST body
 * and the copy the slip prints from. A line's discount stays with its
 * product+unit (the editor has no discount box to lose it through). Tax comes
 * from the cached catalogue; a product missing from it keeps the rate its old
 * line implies.
 */
export function editLocalBill(bill: LocalBill, items: ReviseItem[], products: ProductInfo[]): { payload: Record<string, unknown>; display: BillDisplay } {
  const old = new Map(bill.display.lines.map((l) => [`${l.productId}:${l.unitId}`, l]));
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = items.map((i) => {
    const was = old.get(`${i.productId}:${i.unitId}`);
    const product = byId.get(i.productId);
    const unitPrice = i.unitPrice ?? was?.unitPrice ?? 0;
    const discount = was?.discount ?? i.discount;
    let taxPercent = product?.taxPercent != null ? Number(product.taxPercent) : 0;
    if (product?.taxPercent == null && was) {
      const net = round2(was.quantity * was.unitPrice - was.discount);
      taxPercent = net ? round2(((was.lineTotal - net) / net) * 100) : 0;
    }
    const unit = product?.saleUnits?.find((u) => (u.unitId ?? u.unit?.id) === i.unitId)?.unit?.symbol ?? was?.unit ?? "";
    return { item: { productId: i.productId, quantity: i.quantity, unitId: i.unitId, discount, unitPrice }, name: was?.name ?? product?.name ?? "", unit, money: lineMoney({ quantity: i.quantity, unitPrice, discount, taxPercent }) };
  });
  return {
    payload: { ...bill.payload, items: lines.map((l) => l.item) },
    display: {
      ...bill.display,
      lines: lines.map((l) => ({ ...l.item, name: l.name, unit: l.unit, lineTotal: l.money.total })),
      ...moneyTotals(lines.map((l) => l.money)),
    },
  };
}

// ── Orders list ──────────────────────────────────────────────────────────

export type ListRow = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  offlineRef?: string | null;
  clientRequestId?: string | null;
  customer: { shopName: string } | null;
  bill: { billNumber: string; paymentStatus: string } | null;
};

const has = (text: string | null | undefined, q: string) => !!text && text.toLowerCase().includes(q);

/**
 * This PC's bills the server doesn't have yet, for the top of the list. A
 * synced bill is already a server row. So is an unsynced one whose answer got
 * lost on the way back — matched on its request id or server order id, so it
 * isn't listed twice. Never on the OFF number: before device codes those
 * repeated across PCs, and a match there hid a real unsynced bill.
 */
export function unsyncedLocalRows(server: ListRow[], local: LocalBill[], q: string): LocalBill[] {
  const ids = new Set(server.flatMap((r) => [r.id, r.clientRequestId].filter(Boolean)));
  const query = q.trim().toLowerCase();
  return local.filter(
    (b) =>
      b.state !== "synced" &&
      !ids.has(b.requestId) &&
      !(b.server && ids.has(b.server.orderId)) &&
      (!query || has(b.offlineRef, query) || has(b.display.customerName, query) || has(b.display.customerMobile, query))
  );
}

/** The saved list, narrowed on this PC the way the server would have (search + status; dates need the server). */
export function filterSavedRows(rows: ListRow[], q: string, status: string): ListRow[] {
  const query = q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!query || has(r.orderNumber, query) || has(r.offlineRef, query) || has(r.customer?.shopName, query) || has(r.bill?.billNumber, query))
  );
}

// ── One bill's queued changes ────────────────────────────────────────────

/**
 * Cash and revisions queued for one bill (not the bill itself — its own state
 * is on the LocalBill). Three ways an item names its bill: a revision's URL
 * (server id or request id), a plain queued cash POST's billId, or
 * billRequestId for anything queued against a bill made on this PC.
 */
export function outboxForBill(items: QueuedAction[], ids: { orderId?: string | null; billId?: string | null; requestId?: string | null }): QueuedAction[] {
  const reviseUrls = [ids.orderId, ids.requestId].filter(Boolean).map((id) => `/api/finance/orders/${encodeURIComponent(id!)}/revise`);
  return items.filter(
    (i) =>
      i.kind !== "bill" &&
      (reviseUrls.includes(i.url) ||
        (!!ids.billId && (i.body as { billId?: unknown }).billId === ids.billId) ||
        (!!ids.requestId && i.billRequestId === ids.requestId))
  );
}
