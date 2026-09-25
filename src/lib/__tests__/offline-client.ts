/**
 * Pure logic of the offline billing client (src/lib/offline-bills.ts): the
 * provisional number, queue order and how a server answer is classified, and
 * the totals printed on a provisional slip. No IndexedDB here.
 * Run: npx tsx src/lib/__tests__/offline-client.ts
 */
import assert from "node:assert/strict";
import { formatOfflineRef, offlineSeqKey, staffCode, newDeviceCode, errorText, cashDismissable, classifyStatus, firstSendable, lineMoney, moneyTotals, serverIdsFrom, type QueuedAction } from "../offline-bills";
import { buildInvoiceHtml } from "../invoice";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check("provisional number: staff without dashes, device code, IST month-day, 3 digits", () => {
  assert.equal(staffCode("FIN-1"), "FIN1");
  assert.equal(formatOfflineRef("FIN-1", "K7Q", new Date("2026-09-17T06:00:00Z"), 3), "OFF-FIN1-K7Q-0917-003");
  assert.equal(formatOfflineRef("fin-1", "K7Q", new Date("2026-09-17T06:00:00Z"), 1234), "OFF-FIN1-K7Q-0917-1234");
  assert.ok(formatOfflineRef("A-VERY-LONG-STAFF-ID-THAT-GOES-ON", "ZZZ", new Date(), 999).length <= 40); // Order.offlineRef max 40
});

check("device code: 3 base-36 characters, zero-padded, random", () => {
  assert.equal(newDeviceCode(new Uint32Array([0])), "000");
  assert.equal(newDeviceCode(new Uint32Array([36 ** 3 - 1])), "ZZZ");
  assert.equal(newDeviceCode(new Uint32Array([36 ** 3 + 35])), "00Z"); // wraps, never 4 chars
  for (let i = 0; i < 50; i++) assert.match(newDeviceCode(), /^[0-9A-Z]{3}$/);
  assert.ok(new Set(Array.from({ length: 50 }, () => newDeviceCode())).size > 40); // two PCs almost never share one
});

check("server error text: string as is, zod flatten() made readable", () => {
  assert.equal(errorText("bill already paid"), "bill already paid");
  assert.equal(errorText({ formErrors: ["Bad body"], fieldErrors: { "customer.ownerName": ["Required"], items: ["Too short", "Empty"] } }), "Bad body; customer.ownerName: Required; items: Too short, Empty");
  assert.equal(errorText({ formErrors: [], fieldErrors: {} }), null);
  assert.equal(errorText(undefined), null);
});

check("provisional number rolls over at IST midnight, not UTC", () => {
  // 18:29Z = 23:59 IST on the 17th; 18:31Z = 00:01 IST on the 18th.
  assert.equal(formatOfflineRef("FIN-1", "K7Q", new Date("2026-09-17T18:29:00Z"), 1), "OFF-FIN1-K7Q-0917-001");
  assert.equal(formatOfflineRef("FIN-1", "K7Q", new Date("2026-09-17T18:31:00Z"), 1), "OFF-FIN1-K7Q-0918-001");
  assert.notEqual(offlineSeqKey("FIN-1", new Date("2026-09-17T18:29:00Z")), offlineSeqKey("FIN-1", new Date("2026-09-17T18:31:00Z")));
  assert.equal(offlineSeqKey("FIN-1", new Date("2026-12-31T19:00:00Z")), "offline-seq:FIN1:20270101"); // year rolls too
  assert.notEqual(offlineSeqKey("FIN-1", new Date()), offlineSeqKey("FIN-2", new Date())); // per staff
});

check("server answers: rejections set aside, everything else retried", () => {
  for (const s of [200, 201]) assert.equal(classifyStatus(s), "ok");
  for (const s of [400, 404, 409, 422]) assert.equal(classifyStatus(s), "reject");
  for (const s of [0, 401, 403, 408, 425, 429, 500, 502, 503]) assert.equal(classifyStatus(s), "retry");
});

const q = (id: string, at: number, extra: Partial<QueuedAction> = {}): QueuedAction => ({ id, url: "/x", body: {}, queuedAt: new Date(at * 1000).toISOString(), ...extra });

check("FIFO: oldest first regardless of storage order", () => {
  assert.equal(firstSendable([q("b", 2), q("a", 1), q("c", 3)])?.id, "a");
  assert.equal(firstSendable([]), undefined);
});

check("set-aside items are skipped; the rest carry on", () => {
  assert.equal(firstSendable([q("a", 1, { failedAt: "x" }), q("b", 2)])?.id, "b");
  assert.equal(firstSendable([q("a", 1, { failedAt: "x" })]), undefined);
});

check("cash and revisions wait while their bill is not on the server", () => {
  const bill = q("bill1", 1, { kind: "bill", failedAt: "x" });
  const cash = q("cash1", 2, { kind: "cash", billRequestId: "bill1" });
  const stock = q("stock", 3);
  assert.equal(firstSendable([bill, cash, stock])?.id, "stock"); // bill set aside -> its cash waits, unrelated work goes
  assert.equal(firstSendable([{ ...bill, failedAt: undefined }, cash])?.id, "bill1"); // bill pending -> bill first
  assert.equal(firstSendable([cash])?.id, "cash1"); // bill synced (gone from outbox) -> cash goes
  assert.equal(firstSendable([q("rev", 1, { kind: "revise", billRequestId: "old-synced-bill" })])?.id, "rev");
});

check("only cash the server refused on the data can be dismissed", () => {
  assert.ok(cashDismissable(q("c", 1, { kind: "cash", failedAt: "x", status: 409 })));
  assert.ok(cashDismissable(q("c", 1, { kind: "cash", failedAt: "x", status: 400 })));
  assert.ok(!cashDismissable(q("c", 1, { kind: "cash", failedAt: "x", status: 404 })));
  assert.ok(!cashDismissable(q("c", 1, { kind: "cash", status: 409 }))); // not set aside
  assert.ok(!cashDismissable(q("r", 1, { kind: "revise", failedAt: "x", status: 409 })));
});

check("server ids from a create and from a duplicate answer", () => {
  assert.deepEqual(serverIdsFrom({ order: { id: "o1", orderNumber: "ORD-1" }, bill: { id: "b1", billNumber: "INV-1" } }), { orderId: "o1", orderNumber: "ORD-1", billId: "b1", billNumber: "INV-1" });
  assert.deepEqual(serverIdsFrom({ duplicate: true, order: { id: "o1", orderNumber: "ORD-1" }, bill: null }), { orderId: "o1", orderNumber: "ORD-1", billId: null, billNumber: null });
  assert.equal(serverIdsFrom({ ok: true, duplicate: true }), undefined); // an older server's duplicate answer
  assert.equal(serverIdsFrom(null), undefined);
});

check("display totals round per line, like the server", () => {
  const a = lineMoney({ quantity: 3, unitPrice: 33.333, discount: 0.004, taxPercent: 5 });
  assert.deepEqual(a, { gross: 100, discount: 0, net: 100, tax: 5, total: 105 });
  const b = lineMoney({ quantity: 0.5, unitPrice: 41, discount: 1.5, taxPercent: 0 });
  assert.deepEqual(b, { gross: 20.5, discount: 1.5, net: 19, tax: 0, total: 19 });
  assert.deepEqual(moneyTotals([a, b]), { subtotal: 120.5, discountTotal: 1.5, taxTotal: 5, total: 124 });
  assert.deepEqual(moneyTotals([]), { subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 });
});

const slip = { businessName: "Store", billNumber: "OFF-FIN1-K7Q-0917-003", orderNumber: "OFF-FIN1-K7Q-0917-003", date: "2026-09-17", time: "10:00", customerName: "CASH", customerMobile: null, sellingMode: "WHOLESALE", items: [], subtotal: "0", discountTotal: "0", taxTotal: "0", total: "0" };
check("provisional slip prints its OFF number but no PROVISIONAL banner; lines A→Z", () => {
  const line = (name: string) => ({ name, quantity: "1", unit: "kg", unitPrice: "1", lineTotal: "1" });
  const html = buildInvoiceHtml({ ...slip, items: [line("sugar"), line("Atta"), line("rice")] });
  assert.match(html, /OFF-FIN1-K7Q-0917-003/);
  assert.doesNotMatch(html, /PROVISIONAL/);
  assert.ok(html.indexOf("Atta") < html.indexOf("rice") && html.indexOf("rice") < html.indexOf("sugar"));
});

console.log(`\n${passed} passed`);
