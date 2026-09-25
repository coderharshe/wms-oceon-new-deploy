/**
 * Pure logic of the Finance bill screens offline (src/lib/offline-screens.ts):
 * the Modify Bill body, editing a bill saved on this PC, the merged Orders
 * list and a bill's queued items. No IndexedDB, no React.
 * Run: npx tsx src/lib/__tests__/offline-screens.ts
 */
import assert from "node:assert/strict";
import { buildReviseItems, editLocalBill, unsyncedLocalRows, filterSavedRows, outboxForBill, type EditRow, type ListRow } from "../offline-screens";
import type { LocalBill, QueuedAction } from "../offline-bills";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const row = (id: string, extra: Partial<EditRow> = {}): EditRow => ({ product: { id, name: id.toUpperCase() }, unitId: "pc", qty: "2", rate: "10", rateSource: "bill", removed: false, ...extra });

check("revise body: online rule — catalogue rate left to the server, removed/zero lines dropped", () => {
  const r = buildReviseItems([row("a"), row("b", { rateSource: "catalogue", rate: "7" }), row("c", { removed: true }), row("d", { qty: "0" })], "  damaged ");
  assert.ok(!("error" in r));
  assert.deepEqual(r.items, [
    { productId: "a", unitId: "pc", quantity: 2, discount: 0, unitPrice: 10 },
    { productId: "b", unitId: "pc", quantity: 2, discount: 0 },
  ]);
  assert.equal(r.reason, "damaged");
});

check("revise body: a bill only on this PC freezes every rate, and refuses a line with none", () => {
  const r = buildReviseItems([row("b", { rateSource: "catalogue", rate: "7" })], "x", true);
  assert.ok(!("error" in r));
  assert.equal(r.items[0]!.unitPrice, 7);
  const bad = buildReviseItems([row("b", { rateSource: "catalogue", rate: "" })], "x", true);
  assert.ok("error" in bad && bad.error.includes("Set a rate"));
});

check("revise body: the editor's validation messages", () => {
  assert.ok("error" in buildReviseItems([row("a"), row("a")], "x"));
  assert.match((buildReviseItems([row("a", { unitId: "" })], "x") as { error: string }).error, /Pick a unit/);
  assert.match((buildReviseItems([row("a", { removed: true })], "x") as { error: string }).error, /at least one line/);
  assert.match((buildReviseItems([row("a")], "  ") as { error: string }).error, /Say why/);
});

const bill = (extra: Partial<LocalBill> = {}): LocalBill => ({
  requestId: "req-1",
  offlineRef: "OFF-FIN1-0917-003",
  billedAt: "2026-09-17T06:00:00.000Z",
  payload: { customer: { ownerName: "Ramesh" }, sellingMode: "RETAIL", items: [] },
  display: {
    customerName: "Ramesh Stores",
    customerMobile: "9876543210",
    sellingMode: "RETAIL",
    notes: null,
    // 3 x 100 - 10 discount = 290, 5% tax = 14.50 -> 304.50
    lines: [{ productId: "p1", unitId: "pc", name: "Rice", unit: "pc", quantity: 3, unitPrice: 100, discount: 10, lineTotal: 304.5 }],
    subtotal: 300,
    discountTotal: 10,
    taxTotal: 14.5,
    total: 304.5,
  },
  state: "pending",
  cash: [],
  updatedAt: "2026-09-17T06:00:00.000Z",
  ...extra,
});

check("editing a PC bill: discount stays with its line, tax from the catalogue, totals recomputed", () => {
  const { payload, display } = editLocalBill(
    bill(),
    [
      { productId: "p1", unitId: "pc", quantity: 5, discount: 0, unitPrice: 100 },
      { productId: "p2", unitId: "kg", quantity: 0.5, discount: 0, unitPrice: 80 },
    ],
    [{ id: "p2", name: "Dal", taxPercent: "0", saleUnits: [{ unitId: "kg", unit: { id: "kg", symbol: "kg" } }] }]
  );
  assert.equal((payload.customer as { ownerName: string }).ownerName, "Ramesh"); // rest of the body untouched
  assert.deepEqual(payload.items, [
    { productId: "p1", quantity: 5, unitId: "pc", discount: 10, unitPrice: 100 },
    { productId: "p2", quantity: 0.5, unitId: "kg", discount: 0, unitPrice: 80 },
  ]);
  // p1 not in the cache: 5% implied by its old line. 500-10=490 +24.50 = 514.50; p2 40.
  assert.equal(display.lines[0]!.lineTotal, 514.5);
  assert.deepEqual(display.lines[1], { productId: "p2", quantity: 0.5, unitId: "kg", discount: 0, unitPrice: 80, name: "Dal", unit: "kg", lineTotal: 40 });
  assert.equal(display.subtotal, 540);
  assert.equal(display.discountTotal, 10);
  assert.equal(display.taxTotal, 24.5);
  assert.equal(display.total, 554.5);
  assert.equal(display.customerName, "Ramesh Stores");
});

const srv = (id: string, extra: Partial<ListRow> = {}): ListRow => ({ id, orderNumber: `ORD-${id}`, status: "BILLED", createdAt: "2026-09-17", customer: { shopName: "Shop" }, bill: { billNumber: `INV-${id}`, paymentStatus: "UNPAID" }, ...extra });

check("orders list: unsynced PC bills on top, synced and already-on-server ones not doubled", () => {
  const local = [
    bill({ requestId: "r-pending" , offlineRef: "OFF-A-001" }),
    bill({ requestId: "r-attention", offlineRef: "OFF-A-002", state: "attention" }),
    bill({ requestId: "r-synced", offlineRef: "OFF-A-003", state: "synced" }),
    bill({ requestId: "r-lost-answer", offlineRef: "OFF-A-004" }), // server has it by clientRequestId
    bill({ requestId: "r-by-ref", offlineRef: "OFF-A-005" }), // a DIFFERENT server bill shares its OFF number (another PC): still listed
    bill({ requestId: "r-by-id", offlineRef: "OFF-A-006", server: { orderId: "o9", orderNumber: "", billId: null, billNumber: null } }),
  ];
  const server = [srv("o1", { clientRequestId: "r-lost-answer" }), srv("o2", { offlineRef: "OFF-A-005" }), srv("o9")];
  assert.deepEqual(unsyncedLocalRows(server, local, "").map((b) => b.requestId), ["r-pending", "r-attention", "r-by-ref"]);
});

check("orders list: search matches a PC bill's OFF number, customer and mobile", () => {
  const local = [bill({ requestId: "a", offlineRef: "OFF-FIN1-0917-001" }), bill({ requestId: "b", offlineRef: "OFF-FIN1-0917-002", display: { ...bill().display, customerName: "Gupta", customerMobile: null } })];
  assert.deepEqual(unsyncedLocalRows([], local, "0917-002").map((b) => b.requestId), ["b"]);
  assert.deepEqual(unsyncedLocalRows([], local, "gUPta").map((b) => b.requestId), ["b"]);
  assert.deepEqual(unsyncedLocalRows([], local, "98765").map((b) => b.requestId), ["a"]);
  assert.deepEqual(unsyncedLocalRows([], local, "nobody"), []);
});

check("saved list offline: narrowed by search and status on this PC", () => {
  const rows = [srv("1", { customer: { shopName: "Gupta Traders" } }), srv("2", { status: "PAID", offlineRef: "OFF-X-9" }), srv("3", { customer: null, bill: null })];
  assert.deepEqual(filterSavedRows(rows, "gupta", "").map((r) => r.id), ["1"]);
  assert.deepEqual(filterSavedRows(rows, "off-x", "").map((r) => r.id), ["2"]);
  assert.deepEqual(filterSavedRows(rows, "INV-1", "").map((r) => r.id), ["1"]);
  assert.deepEqual(filterSavedRows(rows, "", "PAID").map((r) => r.id), ["2"]);
  assert.equal(filterSavedRows(rows, "", "").length, 3);
});

check("a bill's queued items: revisions by URL, cash by billId or billRequestId, never the bill itself", () => {
  const q = (id: string, extra: Partial<QueuedAction>): QueuedAction => ({ id, url: "/x", body: {}, queuedAt: id, ...extra });
  const items = [
    q("bill", { kind: "bill", url: "/api/finance/orders" }),
    q("rev-server", { kind: "revise", url: "/api/finance/orders/o1/revise" }),
    q("rev-local", { kind: "revise", url: "/api/finance/orders/req-1/revise", billRequestId: "req-1" }),
    q("cash-plain", { url: "/api/finance/payments/cash", body: { billId: "b1" } }),
    q("cash-local", { kind: "cash", billRequestId: "req-1" }),
    q("other-bill", { kind: "revise", url: "/api/finance/orders/o2/revise" }),
    q("stock-in", { url: "/api/purchases", body: {} }),
  ];
  const ids = (xs: QueuedAction[]) => xs.map((x) => x.id);
  assert.deepEqual(ids(outboxForBill(items, { orderId: "o1", billId: "b1", requestId: "req-1" })), ["rev-server", "rev-local", "cash-plain", "cash-local"]);
  assert.deepEqual(ids(outboxForBill(items, { requestId: "req-1" })), ["rev-local", "cash-local"]);
  assert.deepEqual(ids(outboxForBill(items, { orderId: "o1", billId: null, requestId: null })), ["rev-server"]);
});

console.log(`\n${passed} passed`);
