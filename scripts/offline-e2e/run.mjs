#!/usr/bin/env node
// Offline-first Finance billing — real-browser suite (Chrome via playwright-core).
//
//   npm run dev                                   # next dev on :3000, local Docker Postgres
//   node scripts/offline-e2e/run.mjs              # every scenario
//   node scripts/offline-e2e/run.mjs 2 7 13       # just these
//   HEADED=1 node scripts/offline-e2e/run.mjs 2   # watch it
//
// Each scenario ends with SQL against the local DB for the bills it made
// (matched on Order.clientRequestId = the LocalBill requestId).
import {
  launch, login, apiSession, db, sql, prints, idb, localBillsSince, headerText, keyboardBill,
  sqlForRequestIds, istYmd, expect, waitFor, sleep, log, fakeOffline, STAFF_CODE, STAFF, PASSWORD,
} from "./lib.mjs";

const RUN = Date.now().toString(36);

const results = [];
const findings = []; // soft failures worth reporting even when the scenario carries on
const note = (msg) => (findings.includes(msg) || findings.push(msg), log("FINDING:", msg));

let ctx, page;
const clientNav = async (key, re) => {
  await page.keyboard.press(key);
  return page.waitForURL(re, { timeout: 10_000 }).then(() => true, () => false);
};

async function start() {
  ctx = await launch();
  await login(ctx);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => log("pageerror:", e.message.slice(0, 200)));
}

/** Clean slate between scenarios: online, no routes, empty outbox + local bills, no saved basket. */
async function reset() {
  await ctx.setOffline(false);
  await ctx.unrouteAll({ behavior: "ignoreErrors" });
  if (page.isClosed()) page = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== page) await p.close();
  await page.goto("/finance/orders/new");
  await page.evaluate(() => {
    localStorage.removeItem("entries:new-order");
    localStorage.removeItem("entries:held-bills");
    localStorage.removeItem("new-order:key-guide-hidden");
    localStorage.removeItem("__e2e_fake_offline"); // a scenario that failed mid offlineBill leaves it set
  });
  await idb.clear(page, ["outbox", "localBills"]);
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(1500); // catalog cache loaded
  prints.length = 0;
}

const newPrints = (from) => prints.slice(from);
async function waitPrint(from, re, timeout = 15_000) {
  return waitFor(() => newPrints(from).find((p) => re.test(p.html)), { timeout, what: `a print matching ${re}` });
}
async function waitHeader(re, timeout = 30_000, p = page) {
  // "Synced ✓" is also what the badge shows before it has read the outbox, so
  // for that one the outbox itself must be empty too.
  return waitFor(
    async () => re.test(await headerText(p)) && (!re.test("Synced ✓") || (await idb.all(p, "outbox")).length === 0) && (await headerText(p)),
    { timeout, what: `header ${re}` }
  );
}
const kickFlush = (p = page) => p.evaluate(() => window.dispatchEvent(new Event("online")));

/** Offline, reaching a page nobody visited: try the real way, record what happens, then get there with the network up but sync blocked. */
async function reachOffline(url, how) {
  const ok = await how();
  if (ok) return true;
  note(`offline navigation to ${url} failed (landed on ${page.url()}, title "${await page.title().catch(() => "?")}")`);
  await ctx.route(/\/api\/finance\/(orders|payments)/, (r) => (r.request().method() === "POST" ? r.abort("internetdisconnected") : r.continue()));
  await ctx.setOffline(false);
  await page.goto(url);
  await ctx.setOffline(true);
  await ctx.unroute(/\/api\/finance\/(orders|payments)/);
  return false;
}

const blockSync = () => ctx.route(/\/api\/finance\/(orders|payments)/, (r) => (r.request().method() === "POST" ? r.abort("internetdisconnected") : r.continue()));
const unblockSync = () => ctx.unroute(/\/api\/finance\/(orders|payments)/);

/**
 * Generate Bill while the context is offline, as the cashier would, and
 * record what the counter actually gets: a slip? the local bill screen?
 * If the tab ends up on Chrome's error page, get back (network up, sync
 * blocked) so the rest of the scenario can still check syncing.
 */
async function offlineBill(name, { qty = "3", p = page } = {}) {
  const t0 = new Date().toISOString();
  const p0 = prints.length;
  await fakeOffline(p, true); // no-op while offline; keeps a workaround load from syncing
  await keyboardBill(p, { name, qty });
  const slip = await waitPrint(p0, /Bill No. OFF-/, 6000).catch(() => null);
  await sleep(1500);
  const url = p.url();
  // The bill opens in place over New Order (no navigation offline).
  const onLocal = /\/finance\/orders\/new/.test(url) && (await p.getByRole("dialog", { name: "Bill saved on this PC" }).getByText("PROVISIONAL").first().waitFor({ timeout: 3000 }).then(() => true, () => false));
  if (!slip) note("offline Generate Bill: no offline slip was printed");
  if (!onLocal) note(`offline Generate Bill: did not open the local bill in place (tab shows ${url.startsWith("chrome-error") ? "Chrome's 'This site can't be reached'" : url})`);
  if (!onLocal) {
    await blockSync();
    await ctx.setOffline(false);
    await p.goto("/finance/orders/new");
  }
  const bills = await waitFor(async () => {
    const all = await localBillsSince(p, t0);
    return all.length && all;
  }, { timeout: 10_000, what: `local bill ${name}` });
  const bill = bills.at(-1);
  expect(bill.display.customerName === name, `latest local bill is ${bill.display.customerName}, not ${name}`);
  if (!onLocal) {
    await p.goto(`/finance/orders/local/${bill.requestId}`);
    await p.getByRole("heading", { name: new RegExp(bill.offlineRef) }).waitFor({ timeout: 15_000 });
    await ctx.setOffline(true);
    await unblockSync();
  }
  await fakeOffline(p, false);
  const item = (await idb.all(p, "outbox")).find((i) => i.id === bill.requestId);
  expect(item && !item.attempted, `harness leak: bill ${name} was already attempted`);
  return { bill, slip, onLocal };
}

/** Back to New Order while offline: F2 (client-side), then a hard load from the service worker, then the workaround. */
async function offlineNewOrder(p = page) {
  const ready = () => p.getByRole("button", { name: /Generate Bill/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  await fakeOffline(p, true);
  const dialog = p.getByRole("dialog", { name: "Bill saved on this PC" });
  if (await dialog.isVisible().catch(() => false)) {
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
  }
  // Closing the in-place bill already leaves a fresh basket on New Order; F2 is
  // only needed from another screen (F2 to the page you're on is a router.push
  // that, offline, Next turns into a hard load).
  let ok = /\/finance\/orders\/new/.test(p.url()) && (await ready());
  if (!ok) {
    await p.keyboard.press("F2");
    ok = await p.waitForURL(/\/finance\/orders\/new/, { timeout: 8000 }).then(ready, () => false);
  }
  if (!ok) {
    note(`offline F2 to New Order failed (tab shows ${p.url()})`);
    ok = await p.goto("/finance/orders/new").then(ready, () => false);
    if (!ok) note("offline hard load of /finance/orders/new (visited online before) failed");
  }
  if (!ok) {
    await blockSync();
    await ctx.setOffline(false);
    await p.goto("/finance/orders/new");
    await ctx.setOffline(true);
    await unblockSync();
  }
  await p.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await fakeOffline(p, false);
  await sleep(1000);
}

const S = {};

// ── 1 ────────────────────────────────────────────────────────────────────
S[1] = async function onlineRegression() {
  const t0 = new Date().toISOString();
  const p0 = prints.length;
  await keyboardBill(page, { name: "E2E-S1", submit: false });
  const tSubmit = Date.now();
  await page.keyboard.press("F10");
  // Online too, the slip prints from this PC and the bill opens in place —
  // nothing after the bill is saved waits on the network (weak Wi-Fi hung it).
  const inv = await waitPrint(p0, /<title>INV-\d{8}-\d+<\/title>/, 10_000);
  const took = Date.now() - tSubmit;
  log(`printed server-numbered slip in ${took}ms`);
  expect(took < 3000, `took ${took}ms to print the bill`);
  expect(!/PROVISIONAL/.test(inv.html), "synced bill's slip says PROVISIONAL");
  const dialog = page.getByRole("dialog", { name: "Bill saved on this PC" });
  await dialog.getByText(/Synced as INV-\d{8}-\d+/).waitFor({ timeout: 5000 });
  expect(/\/finance\/orders\/new$/.test(page.url()), `left New Order: ${page.url()}`);
  // F2 straight from the printed bill: a blank basket, cursor on the customer.
  await page.keyboard.press("F2");
  await dialog.waitFor({ state: "hidden", timeout: 3000 });
  expect((await page.locator("tbody tr", { hasText: "0 HELL CAN" }).count()) === 0, "F2 after a bill left the basket full");
  const [b] = await localBillsSince(page, t0);
  expect(b?.state === "synced" && b.server?.billNumber, `local bill ${JSON.stringify(b?.state)}`);
  const rows = await sqlForRequestIds([b.requestId]);
  expect(rows.length === 1 && rows[0].billNumber === b.server.billNumber && rows[0].versions === 1 && rows[0].payments === 1 && rows[0].txns === 1 && rows[0].paid === 27, `db ${JSON.stringify(rows)}`);
  expect(rows[0].items[0].qty === 3 && rows[0].items[0].price === 9, `items ${JSON.stringify(rows[0].items)}`);
  expect(inv.html.includes(rows[0].billNumber), "printed number != DB number");
  log(`${rows[0].orderNumber} ${rows[0].billNumber}`);

  // Keyboard features on New Order.
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(1000);
  await page.keyboard.press("F5");
  await page.keyboard.type("f s 5");
  await page.locator('[role="option"]', { hasText: "FENA SURF 500GM" }).first().waitFor({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.locator("input[placeholder^='Barcode']").fill("");
  await keyboardBill(page, { name: "HELD-ONE", submit: false });
  await page.keyboard.press("Alt+N");
  await page.getByRole("button", { name: /Held 1: .*HELD-ONE/ }).waitFor({ timeout: 5000 });
  expect((await page.locator("tbody tr", { hasText: "0 HELL CAN" }).count()) === 0, "Alt+N didn't clear the bill");
  await page.keyboard.press("Alt+1");
  await page.locator("tbody tr", { hasText: "0 HELL CAN" }).waitFor({ timeout: 5000 });
  await page.getByText("Keyboard — no mouse needed").waitFor();
  await page.keyboard.press("Alt+K");
  await page.getByRole("button", { name: /Show shortcuts/ }).waitFor({ timeout: 5000 });
  await page.keyboard.press("Alt+K");
  await page.getByText("Keyboard — no mouse needed").waitFor({ timeout: 5000 });
  await page.keyboard.press("F5");
  await page.keyboard.press("Alt+E");
  const focused = await page.evaluate(() => [document.activeElement?.value, document.activeElement?.selectionEnd - document.activeElement?.selectionStart]);
  expect(focused[0] === "HELD-ONE" && focused[1] === "HELD-ONE".length, `Alt+E focus ${JSON.stringify(focused)}`);
  return `${took}ms to ${rows[0].billNumber}, INV printed; f s 5 search, Alt+N/Alt+1, Alt+K, Alt+E ok`;
};

// ── 2 ────────────────────────────────────────────────────────────────────
S[2] = async function fullyOffline() {
  const t0 = new Date().toISOString();
  await ctx.setOffline(true);
  const { bill: a, slip, onLocal } = await offlineBill("E2E-S2-A", { qty: "3" });
  const ref = a.offlineRef;
  expect(new RegExp(`^OFF-${STAFF_CODE}-[0-9A-Z]{3}-[0-9]{4}-[0-9]{3}$`).test(ref) && ref.split("-")[3] === istYmd(new Date()).slice(4), `offlineRef ${ref}`);
  expect(a.state === "pending", `local state ${a.state}`);
  if (slip) expect(slip.html.includes(ref), "slip lacks the OFF number");
  if (slip) expect(!/PROVISIONAL/.test(slip.html), "printed slip still says PROVISIONAL");
  await waitHeader(/Waiting to sync \(1\)/, 5000);
  // Reprint from the local screen (Ctrl+P) must give the provisional slip.
  let p0 = prints.length;
  await page.getByRole("button", { name: /Reprint/ }).click();
  (await import("node:fs")).writeFileSync("scripts/offline-e2e/out/s2-reprint.html", (await waitPrint(p0, /Bill No. OFF-/, 5000)).html);
  const reprint = await waitPrint(p0, /Bill No. OFF-/, 5000);
  expect(reprint.html.includes(ref) && reprint.html.includes("27.00"), "reprint lacks OFF number / total 27.00");

  // Paid on creation: the local bill says so and offers no second cash box.
  await page.getByText(/Paid in cash: ₹27.00/).waitFor({ timeout: 5000 });
  expect((await page.locator("#cash-received").count()) === 0, "offline bill still offers Collect Cash");

  // Second bill: F2 from the local bill screen, still offline.
  await offlineNewOrder();
  const { bill: bLocal } = await offlineBill("E2E-S2-B", { qty: "2" });
  const ref2 = bLocal.offlineRef;
  expect(Number(ref2.slice(-3)) === Number(ref.slice(-3)) + 1, `second number ${ref2} after ${ref}`);
  await waitHeader(/Waiting to sync \(2\)/, 8000);

  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  const bills = await localBillsSince(page, t0);
  expect(bills.every((b) => b.state === "synced" && b.cash.every((c) => c.state === "synced")), `local ${JSON.stringify(bills.map((b) => [b.state, b.cash]))}`);
  await page.goto(`/finance/orders/local/${a.requestId}`);
  await page.getByText(/Synced as INV-\d{8}-\d+/).waitFor({ timeout: 10_000 });

  const rows = await sqlForRequestIds([a.requestId, bLocal.requestId]);
  expect(rows.length === 2, `${rows.length} orders`);
  const [ra, rb] = [rows.find((r) => r.clientRequestId === a.requestId), rows.find((r) => r.clientRequestId === bLocal.requestId)];
  const ymd = istYmd(new Date(a.billedAt));
  for (const [r, l, qty] of [[ra, a, 3], [rb, bLocal, 2]]) {
    expect(r.offlineRef === l.offlineRef, `offlineRef ${r.offlineRef}`);
    expect(r.oc.getTime() === new Date(l.billedAt).getTime() && r.bc.getTime() === r.oc.getTime() && r.vc.getTime() === r.oc.getTime(), `createdAt ${r.oc.toISOString()} vs billedAt ${l.billedAt}`);
    expect(r.billNumber.startsWith(`INV-${ymd}-`), `bill number ${r.billNumber}`);
    expect(r.items.length === 1 && r.items[0].qty === qty && r.items[0].price === 9, `items ${JSON.stringify(r.items)}`);
    expect(r.versions === 1 && r.payments === 1, `versions/payments ${r.versions}/${r.payments}`);
    expect(r.txns === 1 && r.paid === qty * 9, `paid on creation: ${r.txns} txns, paid ${r.paid}`);
  }
  expect(Number(ra.billNumber.split("-")[2]) < Number(rb.billNumber.split("-")[2]), `INV order ${ra.billNumber} ${rb.billNumber}`);
  return `${ref}->${ra.billNumber} (paid ₹27), ${ref2}->${rb.billNumber} (paid ₹18); createdAt = billedAt`;
};

// ── 3 ────────────────────────────────────────────────────────────────────
S[3] = async function internetDead() {
  const t0 = new Date().toISOString();
  let release;
  const gate = new Promise((r) => (release = r));
  let posts = 0;
  await ctx.route("**/api/finance/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await gate;
    return route.continue().catch(() => {});
  });
  const p0 = prints.length;
  const tSubmit = Date.now();
  await keyboardBill(page, { name: "E2E-S3" });
  const slip = await waitPrint(p0, /Bill No. OFF-/, 8000);
  const after = slip.at - tSubmit;
  log(`provisional slip after ${after}ms`);
  expect(after >= 2500 && after < 6000, `slip after ${after}ms`);
  // The provisional bill opens in place over New Order (no navigation).
  await page.getByRole("dialog", { name: "Bill saved on this PC" }).waitFor({ timeout: 10_000 });
  await sleep(2000);
  release();
  await waitHeader(/Synced ✓/, 40_000).catch(async () => {
    await kickFlush();
    await waitHeader(/Synced ✓/, 30_000);
  });
  const [b] = await localBillsSince(page, t0);
  const rows = await sqlForRequestIds([b.requestId]);
  expect(rows.length === 1 && b.state === "synced" && b.server?.orderId === rows[0].id, `db ${rows.length}, local ${b.state}`);
  return `slip at ${after}ms; ${posts} POST(s) held; 1 order ${rows[0].billNumber}`;
};

// ── 4 ────────────────────────────────────────────────────────────────────
S[4] = async function cutAfterCommit() {
  const t0 = new Date().toISOString();
  let cut = 0;
  await ctx.route("**/api/finance/orders", async (route) => {
    if (route.request().method() !== "POST" || cut) return route.continue();
    cut++;
    const res = await route.fetch(); // the server commits
    log(`server answered ${res.status()} — dropping the response`);
    return route.abort("connectionreset");
  });
  const p0 = prints.length;
  await keyboardBill(page, { name: "E2E-S4" });
  await waitPrint(p0, /Bill No. OFF-/, 8000);
  // The provisional bill opens in place over New Order (no navigation).
  await page.getByRole("dialog", { name: "Bill saved on this PC" }).waitFor({ timeout: 10_000 });
  let [b] = await localBillsSince(page, t0);
  expect(b.state === "pending", `local state ${b.state}`);
  let rows = await sqlForRequestIds([b.requestId]);
  expect(rows.length === 1, `server should already have it, has ${rows.length}`);
  await kickFlush();
  await waitHeader(/Synced ✓/, 30_000);
  [b] = await localBillsSince(page, t0);
  rows = await sqlForRequestIds([b.requestId]);
  expect(rows.length === 1, `${rows.length} orders`);
  expect(b.state === "synced" && b.server?.orderId === rows[0].id && b.server.billNumber === rows[0].billNumber, `local ${JSON.stringify(b.server)} vs ${rows[0].id}`);
  await page.getByText(new RegExp(`Synced as ${rows[0].billNumber}`)).waitFor({ timeout: 10_000 });
  return `1 order, local bill linked to ${rows[0].billNumber} via duplicate answer`;
};

// ── 5 ────────────────────────────────────────────────────────────────────
S[5] = async function powerCut() {
  const out = [];
  // (a) crash right after Generate Bill, offline
  let t0 = new Date().toISOString();
  await ctx.setOffline(true);
  await keyboardBill(page, { name: `E2E-S5-A-${RUN}` });
  await sleep(150);
  await ctx.close();
  await start(); // relaunch, same profile — online
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(1500);
  let bills = await localBillsSince(page, t0);
  const restored = await page.getByText(/Picked up where you left off/).isVisible().catch(() => false);
  log(`after crash: ${bills.length} local bill(s) [${bills.map((b) => b.state)}], basket restored: ${restored}`);
  expect(bills.length === 1 || restored, "bill neither queued nor basket restored — lost");
  if (restored) {
    // The cashier presses Generate again on the recovered basket.
    await page.keyboard.press("F10");
    await page.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 15_000 });
  }
  await waitHeader(/Synced ✓/, 30_000);
  bills = await localBillsSince(page, t0);
  let rows = await sqlForRequestIds(bills.map((b) => b.requestId));
  const byName = await sql(`SELECT count(*)::int n FROM "Order" o JOIN "Customer" c ON c.id = o."customerId" WHERE c."ownerName" = $1`, [`E2E-S5-A-${RUN}`]);
  expect(bills.length === 1 && rows.length === 1 && byName[0].n === 1, `local ${bills.length}, orders by id ${rows.length}, by name ${byName[0].n}`);
  out.push(`(a) crash after F10: 1 order ${rows[0].billNumber}${restored ? ", basket restored + re-Generate didn't double" : ""}`);

  // (c) the crash window between the bill committing to IndexedDB and the basket being cleared:
  // the saved basket (with the bill's requestId) comes back after the bill has synced.
  {
    await reset();
    const tc = new Date().toISOString();
    await keyboardBill(page, { name: `E2E-S5-C-${RUN}`, submit: false });
    const basket = await page.evaluate(() => localStorage.getItem("entries:new-order"));
    await ctx.setOffline(true);
    const { bill } = await offlineBill(`E2E-S5-C2-${RUN}`, { qty: "3" }).catch(() => ({}));
    void bill;
    await ctx.setOffline(false);
    await kickFlush();
    await waitHeader(/Synced ✓/, 30_000);
    const [synced] = (await localBillsSince(page, tc)).slice(-1);
    // what localStorage held in that window: the basket as submitted, carrying the bill's id
    const saved = JSON.parse(basket);
    saved.requestId = synced.requestId;
    saved.details.ownerName = synced.display.customerName;
    saved.savedAt = Date.now();
    await page.evaluate((v) => localStorage.setItem("entries:new-order", v), JSON.stringify(saved));
    await page.goto("/finance/orders/new");
    const notice = await page.getByText(/This bill was already saved as/).waitFor({ timeout: 8000 }).then(() => page.getByText(/This bill was already saved as/).innerText(), () => "");
    const banner = await page.getByText(/Picked up where you left off/).isVisible().catch(() => false);
    const lines = await page.locator("tbody input[data-col=qty]").count();
    expect(notice.includes(synced.server.billNumber) && !banner && lines === 0, `restore of a saved bill: notice "${notice}", "Picked up" banner ${banner}, ${lines} editable lines`);
    await page.getByRole("button", { name: "Open it" }).click();
    await page.getByRole("dialog", { name: "Bill saved on this PC" }).getByText(new RegExp(`Synced as ${synced.server.billNumber}`)).waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    const rowsC = await sql(`SELECT o."orderNumber", i.quantity::float q FROM "Order" o JOIN "Customer" c ON c.id = o."customerId" JOIN "OrderItem" i ON i."orderId" = o.id WHERE c."ownerName" = $1`, [synced.display.customerName]);
    expect(rowsC.length === 1 && rowsC[0].q === 3, `server rows ${JSON.stringify(rowsC)}`);
    out.push(`(c) restored basket of an already-synced bill: not restored, notice "${notice.slice(0, 60)}…", Open it shows ${synced.server.billNumber}`);
  }

  // (b) crash while a sync is in flight (server committed, answer never came)
  await reset();
  t0 = new Date().toISOString();
  await ctx.setOffline(true);
  await offlineBill("E2E-S5-B");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  let committed;
  const done = new Promise((r) => (committed = r));
  await ctx.route("**/api/finance/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    committed();
    await new Promise(() => {}); // never answer
  });
  await ctx.setOffline(false);
  await done;
  bills = await localBillsSince(page, t0);
  await ctx.close().catch(() => {});
  await start();
  await page.goto("/finance/orders/new");
  await waitHeader(/Synced ✓/, 40_000);
  const after = await localBillsSince(page, t0);
  rows = await sqlForRequestIds(after.map((b) => b.requestId));
  expect(after.length === 1 && after[0].state === "synced" && rows.length === 1 && after[0].server?.orderId === rows[0].id, `local ${JSON.stringify(after.map((b) => b.state))}, db ${rows.length}`);
  out.push(`(b) crash mid-sync: still queued, synced once as ${rows[0].billNumber}`);
  return out.join("; ");
};

// ── 6 ────────────────────────────────────────────────────────────────────
S[6] = async function backdated() {
  const t0 = new Date().toISOString();
  await ctx.setOffline(true);
  await offlineBill("E2E-S6-Y");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  await offlineNewOrder();
  await offlineBill("E2E-S6-OLD");
  await waitHeader(/Waiting to sync \(2\)/, 10_000);
  const [y, old] = await localBillsSince(page, t0);
  const yesterday = new Date(Date.now() - 24 * 3600e3).toISOString();
  const eightDays = new Date(Date.now() - 8 * 24 * 3600e3).toISOString();
  const outbox = await idb.all(page, "outbox");
  for (const [bill, at] of [[y, yesterday], [old, eightDays]]) {
    await idb.put(page, "localBills", { ...bill, billedAt: at });
    const item = outbox.find((i) => i.id === bill.requestId);
    await idb.put(page, "outbox", { ...item, body: { ...item.body, billedAt: at } });
  }
  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  const rows = await sqlForRequestIds([y.requestId, old.requestId]);
  const ry = rows.find((r) => r.clientRequestId === y.requestId);
  const ro = rows.find((r) => r.clientRequestId === old.requestId);
  expect(rows.length === 2, `${rows.length} orders`);
  expect(ry.billNumber.startsWith(`INV-${istYmd(new Date(yesterday))}-`) && ry.orderNumber.includes(istYmd(new Date(yesterday))) && ry.oc.toISOString() === yesterday && !/accepted window/.test(ry.reviewNotes ?? ""), `yesterday: ${ry.billNumber} ${ry.oc.toISOString()} notes=${ry.reviewNotes}`);
  expect(ro.billNumber.startsWith(`INV-${istYmd(new Date())}-`) && Date.now() - ro.oc.getTime() < 120_000 && ro.needsReview && /outside the accepted window/.test(ro.reviewNotes), `8 days: ${ro.billNumber} ${ro.oc.toISOString()} review=${ro.needsReview} ${ro.reviewNotes}`);
  return `yesterday -> ${ry.billNumber} dated ${ry.oc.toISOString()}; 8 days -> ${ro.billNumber} today + needsReview`;
};

// ── 7 ────────────────────────────────────────────────────────────────────
async function modifyQty(qty, reason) {
  await page.getByRole("button", { name: "Modify Bill" }).click();
  await page.getByLabel("Quantity for 0 HELL CAN").fill(String(qty));
  await page.getByPlaceholder(/peti returned/).fill(reason);
  await page.getByRole("button", { name: /Save Changes/ }).click();
}
async function onlineBill(name, qty = "3") {
  const t0 = new Date().toISOString();
  await keyboardBill(page, { name, qty });
  // The bill prints and opens in place on New Order (no navigation after a
  // bill); the scenarios using this want the server bill's own screen.
  await page.getByRole("dialog", { name: "Bill saved on this PC" }).getByText(/Synced as INV-/).waitFor({ timeout: 15_000 });
  const [b] = await localBillsSince(page, t0);
  await page.goto(`/finance/orders/${b.server.orderId}`);
  await page.getByRole("button", { name: "Modify Bill" }).waitFor({ timeout: 20_000 });
  await sleep(1500);
  return b;
}
S[7] = async function modifyOffline() {
  const out = [];
  // (a) unsynced local bill, edited twice before it ever syncs
  let t0 = new Date().toISOString();
  await ctx.setOffline(true);
  const { bill: a } = await offlineBill("E2E-S7-A");
  await page.getByRole("button", { name: "Modify Bill" }).waitFor({ timeout: 15_000 });
  await modifyQty(5, "customer took 5");
  await page.getByText(/Bill changed on this PC/).waitFor({ timeout: 5000 });
  await modifyQty(7, "make it 7");
  await page.getByText(/Bill changed on this PC/).waitFor({ timeout: 5000 });
  const edited = (await localBillsSince(page, t0))[0];
  expect(edited.display.lines[0].quantity === 7 && edited.display.total === 63, `local after edits ${JSON.stringify(edited.display.lines)}`);
  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  let rows = await sqlForRequestIds([a.requestId]);
  expect(rows.length === 1 && rows[0].versions === 1 && rows[0].items[0].qty === 7 && rows[0].due === 63, `db ${JSON.stringify(rows)}`);
  out.push(`(a) 2 local edits -> 1 order, 1 BillVersion, qty 7, due 63`);

  // (b) synced bill, modified offline
  await reset();
  const b = await onlineBill("E2E-S7-B");
  await ctx.setOffline(true);
  await modifyQty(4, "offline edit");
  await page.getByText(/Saved on this PC — will sync/).waitFor({ timeout: 8000 });
  await waitHeader(/Waiting to sync \(1\)/, 5000);
  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  await sleep(3000);
  await kickFlush();
  await sleep(2000);
  rows = await sqlForRequestIds([b.requestId]);
  expect(rows[0].versions === 2 && rows[0].currentVersion === 2, `versions ${rows[0].versions} current ${rows[0].currentVersion}`);
  const v2 = await sql(`SELECT count(*)::int n FROM "BillItem" bi JOIN "BillVersion" v ON v.id = bi."billVersionId" WHERE v."billId" = $1 AND v."versionNumber" = 2 AND bi.quantity = 4`, [rows[0].bill_id]).catch((e) => [{ n: `? ${e.message}` }]);
  out.push(`(b) offline revise -> version 2 once (qty-4 lines in v2: ${v2[0].n})`);

  // (c) conflict with a manager's change made meanwhile
  await reset();
  const c = await onlineBill("E2E-S7-C");
  const [rc] = await sqlForRequestIds([c.requestId]);
  await ctx.setOffline(true);
  await modifyQty(2, "offline edit that will conflict");
  await page.getByText(/Saved on this PC — will sync/).waitFor({ timeout: 8000 });
  const mgr = await apiSession("MGR-1");
  const line = (await sql(`SELECT "productId","unitId" FROM "OrderItem" WHERE "orderId" = $1`, [rc.id]))[0];
  const m = await mgr("POST", `/api/finance/orders/${rc.id}/revise`, { items: [{ ...line, quantity: 6, discount: 0, unitPrice: 9 }], reason: "manager fixed it" });
  expect(m.status === 200, `manager revise ${m.status} ${JSON.stringify(m.json)}`);
  await ctx.setOffline(false);
  await waitHeader(/Needs attention \(1\)/, 30_000);
  await page.getByText(/needs attention: This bill was changed by someone else \(now version 2\)/).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Retry" }).first().waitFor();
  const discard = page.getByRole("button", { name: /Discard my change/ });
  expect(await discard.isVisible(), "no Discard button");
  rows = await sqlForRequestIds([c.requestId]);
  const qtyNow = await sql(`SELECT bi.quantity::float q FROM "BillItem" bi JOIN "BillVersion" v ON v.id = bi."billVersionId" JOIN "Bill" b ON b.id = v."billId" AND v."versionNumber" = b."currentVersion" WHERE b.id = $1`, [rows[0].bill_id]).catch(() => [{ q: "?" }]);
  expect(rows[0].currentVersion === 2 && rows[0].versions === 2, `server bill ${rows[0].currentVersion}/${rows[0].versions}`);
  await discard.click();
  await waitHeader(/Synced ✓/, 10_000);
  out.push(`(c) 409 -> Needs attention with Retry/Discard; server stayed on manager's v2 (qty ${JSON.stringify(qtyNow.map((r) => r.q))}); discard cleared it`);
  return out.join("; ");
};

// ── 8 ────────────────────────────────────────────────────────────────────
S[8] = async function rejection() {
  const t0 = new Date().toISOString();
  await ctx.setOffline(true);
  await offlineBill("E2E-S8-BAD");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  await offlineNewOrder();
  await offlineBill("E2E-S8-GOOD");
  await waitHeader(/Waiting to sync \(2\)/, 10_000);
  const [bad, good] = await localBillsSince(page, t0);
  const item = (await idb.all(page, "outbox")).find((i) => i.id === bad.requestId);
  await idb.put(page, "outbox", { ...item, body: { ...item.body, sellingMode: "BOGUS" } });
  await ctx.setOffline(false);
  await waitHeader(/Needs attention \(1\)/, 30_000);
  const [bad2, good2] = await waitFor(async () => {
    const b = await localBillsSince(page, t0);
    return b[1]?.state === "synced" && b;
  }, { timeout: 30_000, what: "the later bill to sync past the rejected one" });
  const rows = await sqlForRequestIds([bad.requestId, good.requestId]);
  expect(bad2.state === "attention" && good2.state === "synced", `states ${bad2.state} ${good2.state}`);
  expect(rows.length === 1 && rows[0].clientRequestId === good.requestId, `db ${rows.map((r) => r.clientRequestId)}`);
  const kept = (await idb.all(page, "outbox")).find((i) => i.id === bad.requestId);
  expect(kept?.failedAt, "rejected item was removed from the outbox");
  log(`attention reason shown: "${bad2.error}"`);
  if (/The server returned 400/.test(bad2.error ?? "")) note(`a 400 from zod shows "${bad2.error}" — the server's field errors (an object) are dropped`);
  await page.goto("/finance/orders");
  await page.locator("tr", { hasText: bad.offlineRef }).getByText("Needs attention").waitFor({ timeout: 10_000 });
  return `bad bill set aside ("${bad2.error}"), kept in outbox; later bill synced; 1 order in DB`;
};

// ── 9 ────────────────────────────────────────────────────────────────────
S[9] = async function twoTabs() {
  const t0 = new Date().toISOString();
  await ctx.setOffline(true);
  await offlineBill("E2E-S9-1");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  const tab2 = await ctx.newPage();
  // tab 2 has to be open on New Order before the network returns: load it with the network up but both tabs believing they're offline
  await fakeOffline(page, true);
  await blockSync();
  await ctx.setOffline(false);
  await tab2.goto("/finance/orders/new");
  await page.goto("/finance/orders/new");
  await tab2.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await ctx.setOffline(true);
  await unblockSync();
  await fakeOffline(page, false);
  await sleep(1000);
  await offlineBill("E2E-S9-2", { p: tab2 });
  await waitHeader(/Waiting to sync \(2\)/, 10_000, tab2);
  const sent = {};
  await ctx.route("**/api/finance/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const id = route.request().postDataJSON().clientRequestId;
    sent[id] = (sent[id] ?? 0) + 1;
    await sleep(800); // widen the window for a double send
    return route.continue();
  });
  await ctx.setOffline(false); // both tabs get "online" and flush at once
  await Promise.all([kickFlush(page), kickFlush(tab2)]);
  await waitHeader(/Synced ✓/, 30_000);
  await waitHeader(/Synced ✓/, 30_000, tab2);
  await sleep(2000);
  const bills = await localBillsSince(page, t0);
  const rows = await sqlForRequestIds(bills.map((b) => b.requestId));
  expect(bills.length === 2 && rows.length === 2, `local ${bills.length} db ${rows.length}`);
  expect(Object.values(sent).every((n) => n === 1), `POSTs per bill ${JSON.stringify(sent)}`);
  await tab2.close();
  return `2 bills, POSTs per bill ${JSON.stringify(Object.values(sent))}, 2 orders`;
};

// ── 10 ───────────────────────────────────────────────────────────────────
S[10] = async function idbUpgrade() {
  // A real server bill to hang an old-shape queued cash payment on.
  const fin = await ctx.request.post("/api/finance/orders", {
    // Unpaid, or the bill is paid on creation and the old queued cash is refused as a second payment.
    data: { sellingMode: "WHOLESALE", unpaid: true, customer: { ownerName: "E2E-S10", type: "WHOLESALE" }, items: [await (async () => {
      const [l] = await sql(`SELECT p.id "productId", pu."unitId" FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id WHERE p.name = '0 HELL CAN' LIMIT 1`);
      return { ...l, quantity: 2, discount: 0, unitPrice: 9 };
    })()] },
  });
  expect(fin.status() === 201, `setup bill ${fin.status()} ${await fin.text()}`);
  const { bill } = await fin.json();
  // Old app state: close every app page, then build a version-2 database from a page with no app JS.
  const blank = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== blank) await p.close();
  page = blank;
  await page.goto("/icon.svg");
  const cashId = crypto.randomUUID();
  const clickedAt = new Date(Date.now() - 5 * 60e3).toISOString();
  const made = await page.evaluate(
    ({ cashId, billId, clickedAt }) =>
      new Promise((res, rej) => {
        const del = indexedDB.deleteDatabase("taresh-offline");
        del.onblocked = () => rej(new Error("delete blocked"));
        del.onsuccess = () => {
          const r = indexedDB.open("taresh-offline", 2);
          r.onupgradeneeded = () => {
            const d = r.result;
            for (const s of ["products", "customers", "units", "bills"]) d.createObjectStore(s, { keyPath: "id" });
            d.createObjectStore("meta", { keyPath: "key" });
            d.createObjectStore("outbox", { keyPath: "id" });
          };
          r.onsuccess = () => {
            const d = r.result;
            const t = d.transaction(["outbox", "meta", "products"], "readwrite");
            t.objectStore("outbox").put({ id: cashId, url: "/api/finance/payments/cash", body: { billId, amountReceived: 18, clickedAt }, queuedAt: new Date().toISOString(), attempts: 3 });
            t.objectStore("meta").put({ key: "syncedAt", value: new Date().toISOString() });
            t.objectStore("products").put({ id: "old-cached-product", sku: "X", name: "OLD CACHED", barcode: null, wholesalePrice: "1", retailPrice: "1", taxPercent: "0", baseUnit: null, saleUnits: [] });
            t.oncomplete = () => (d.close(), res(d.version));
          };
          r.onerror = () => rej(r.error);
        };
      }),
    { cashId, billId: bill.id, clickedAt }
  );
  expect(made === 2, `made v${made}`);
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await waitHeader(/Synced ✓/, 40_000);
  const info = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("taresh-offline");
        r.onsuccess = () => {
          const d = r.result;
          res({ v: d.version, stores: [...d.objectStoreNames] });
          d.close();
        };
      })
  );
  expect(info.v === 3 && ["outbox", "localBills", "bills", "products", "meta"].every((s) => info.stores.includes(s)), `db after ${JSON.stringify(info)}`);
  const tx = await sql(`SELECT t.amount::float amount, t."clickedAt" FROM "PaymentTransaction" t JOIN "Payment" p ON p.id = t."paymentId" WHERE p."billId" = $1`, [bill.id]);
  expect(tx.length === 1 && tx[0].amount === 18 && tx[0].clickedAt.toISOString() === clickedAt, `payments ${JSON.stringify(tx)}`);
  // The v2 database had no localBills store: a new offline bill must work after the upgrade.
  const t0 = new Date().toISOString();
  // The seeded v2 cache holds only a fake product and a fresh syncedAt, so offline billing needs
  // the background catalogue refresh to have landed first.
  const tr = Date.now();
  const refreshed = await waitFor(async () => (await idb.all(page, "products")).some((p) => p.name === "0 HELL CAN"), { timeout: 30_000, what: "catalogue refresh after the upgrade" }).then(() => true, () => false);
  log(`catalogue refresh after upgrade: ${refreshed ? `${Date.now() - tr}ms` : "never within 30s"}`);
  if (!refreshed) note("after the IndexedDB v2->v3 upgrade the catalogue was not refreshed within 30s (products store still the old cache)");
  // New Order read the cache once at mount (before that refresh) and never re-reads it: offline
  // search would still see only the old list. Record it, then reload so the upgrade path is what's tested.
  const stale = await (async () => {
    await page.keyboard.press("F5");
    await page.keyboard.type("0 hell can");
    await sleep(300);
    await ctx.setOffline(true);
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    const seen = await page.locator('[role="option"]', { hasText: "0 HELL CAN" }).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    await ctx.setOffline(false);
    return !seen;
  })();
  if (stale) note("New Order keeps the product list it read at mount: a background catalogue refresh isn't picked up, so offline search misses products until the page is reloaded");
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(1500);
  await ctx.setOffline(true);
  await offlineBill("E2E-S10-AFTER");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  const [nb] = await localBillsSince(page, t0);
  expect(nb?.state === "synced", `post-upgrade bill ${nb?.state}`);
  return `v2 -> v${info.v}, old queued cash ₹18 synced with original clickedAt, new offline bill works`;
};

// ── 11 ───────────────────────────────────────────────────────────────────
S[11] = async function screensOffline() {
  const b = await onlineBill("E2E-S11-SERVER");
  const serverUrl = new URL(page.url()).pathname;
  await page.goto("/finance/orders");
  await page.getByText("E2E-S11-SERVER").first().waitFor({ timeout: 15_000 });
  await page.goto(serverUrl);
  await page.getByRole("button", { name: "Modify Bill" }).waitFor({ timeout: 15_000 });
  await sleep(1500);
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(1000);
  const t0 = new Date().toISOString();
  await ctx.setOffline(true);
  const { bill: local } = await offlineBill("E2E-S11-LOCAL");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  const out = [];

  // Orders list, the keyboard way (Alt+O), then a hard reload.
  const viaKey = await clientNav("Alt+O", /\/finance\/orders$/).then(async (ok) => ok && page.getByText(/Showing saved list from/).waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  if (!viaKey) note(`Alt+O to the Orders list while offline did not show the saved list (url ${page.url()})`);
  const hard = await page.goto("/finance/orders").then(() => page.getByText(/Showing saved list from/).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false), (e) => (log(e.message.split("\n")[0]), false));
  if (!hard) note("hard-loading /finance/orders offline (after visiting it online) did not show the saved list");
  if (!viaKey && !hard) await reachOffline("/finance/orders", async () => false);
  await page.getByText(/Showing saved list from/).waitFor({ timeout: 10_000 });
  // This PC's rows come from IndexedDB a moment after the saved list paints.
  await page.locator("tbody tr").first().filter({ hasText: local.offlineRef }).waitFor({ timeout: 10_000 }).catch(() => {});
  const firstRow = await page.locator("tbody tr").first().innerText();
  if (!(firstRow.includes(local.offlineRef) && /Waiting to sync/i.test(firstRow))) {
    const clash = await sql(`SELECT "orderNumber" FROM "Order" WHERE "offlineRef" = $1`, [local.offlineRef]);
    throw new Error(`unsynced ${local.offlineRef} not listed; first row "${firstRow.replace(/\s+/g, " ")}"${clash.length ? ` — server already has ${local.offlineRef} on ${clash.map((c) => c.orderNumber)} (OFF number reused), see scenario 14` : ""}`);
  }
  expect(await page.getByText("E2E-S11-SERVER").first().isVisible(), "server bill missing from saved list");
  await page.locator("tbody tr").first().getByRole("button", { name: "Open" }).click();
  const dlg = page.getByRole("dialog", { name: "Bill saved on this PC" });
  await dlg.getByRole("heading", { name: new RegExp(local.offlineRef) }).waitFor({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "hidden", timeout: 5000 });
  expect(/\/finance\/orders$/.test(page.url()), `Esc from the list overlay left the list: ${page.url()}`);
  out.push(`list: saved banner, ${local.offlineRef} badged on top and opens in place offline (Alt+O ${viaKey ? "ok" : "FAILED"}, reload ${hard ? "ok" : "FAILED"})`);

  // Server bill page from the saved copy.
  const opened = await page.goto(serverUrl).then(() => page.getByText(/No connection — showing the copy saved on this PC/).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false), () => false);
  if (!opened) {
    note(`hard-loading the visited server bill ${serverUrl} offline did not show the saved copy`);
    await reachOffline(serverUrl, async () => false);
  }
  await page.getByText(/No connection — showing the copy saved on this PC/).waitFor({ timeout: 15_000 });
  // Paid on creation, so there is no balance to collect.
  expect((await page.getByRole("button", { name: "Collect Cash" }).count()) === 0, "paid server bill offers Collect Cash");
  expect(await page.getByRole("button", { name: "Modify Bill" }).isEnabled(), "Modify Bill disabled offline");
  out.push("server bill: saved copy, paid (no cash box), Modify enabled");
  await ctx.setOffline(false);
  // A document the service worker served while emulated-offline reports navigator.onLine = true
  // (Playwright/Chrome quirk), so it never sees an "online" event — nudge it.
  await sleep(500);
  await kickFlush();
  await waitHeader(/Synced ✓/, 30_000);
  return out.join("; ");
};

// ── 12 ───────────────────────────────────────────────────────────────────
S[12] = async function cashWarning() {
  await ctx.setOffline(true);
  await offlineBill("E2E-S12");
  await waitHeader(/Waiting to sync \(1\)/, 10_000);
  let closes = 0;
  await ctx.route(/\/api\/finance\/(orders|payments)/, (r) => (r.request().method() === "POST" ? r.abort("internetdisconnected") : r.continue()));
  await ctx.route("**/api/finance/cash/close", (r) => (closes++, r.abort()));
  await ctx.setOffline(false);
  // The warning is client-side, so a fixed drawer is enough.
  await ctx.route("**/api/finance/cash/today", (r) =>
    r.fulfill({ json: { today: "2026-01-01", open: { id: "e2e-fake", businessDate: "2026-01-01", openedAt: "2026-01-01 03:00:00", bills: 0 }, movements: [], counts: [] } })
  );
  await page.goto("/finance/cash");
  await page.getByRole("heading", { name: "Cash / End of Day" }).waitFor({ timeout: 20_000 });
  const closeBtn = page.getByRole("button", { name: "Save count" });
  await closeBtn.waitFor({ timeout: 10_000 });
  await page.getByLabel("₹100 ×").fill("1");
  await closeBtn.click();
  await page.getByText(/1 item is still waiting to sync/).waitFor({ timeout: 5000 });
  expect(closes === 0, "close was sent despite pending items");
  await page.getByRole("button", { name: "Wait", exact: true }).click();
  await ctx.unrouteAll({ behavior: "ignoreErrors" });
  await kickFlush();
  await waitHeader(/Synced ✓/, 30_000);
  return "Save count with 1 pending item -> warning, nothing sent";
};

// ── 13 ───────────────────────────────────────────────────────────────────
S[13] = async function slowServer() {
  const t0 = new Date().toISOString();
  let n = 0;
  await ctx.route("**/api/finance/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (n++ > 0) return route.continue();
    const res = await route.fetch(); // lands on the server...
    await sleep(17_000); // ...but the answer takes longer than the 15s timeout
    return route.fulfill({ response: res }).catch(() => log("late answer discarded (request aborted)"));
  });
  const p0 = prints.length;
  await keyboardBill(page, { name: "E2E-S13" });
  await waitPrint(p0, /Bill No. OFF-/, 8000);
  const [b] = await localBillsSince(page, t0);
  const item = await waitFor(async () => (await idb.all(page, "outbox")).find((i) => i.id === b.requestId && i.lastError), { timeout: 25_000, what: "timeout recorded" });
  log(`after timeout: lastError="${item.lastError}", attempts=${item.attempts}`);
  expect(/too long/.test(item.lastError), `lastError ${item.lastError}`);
  await kickFlush();
  await waitHeader(/Synced ✓/, 30_000);
  const rows = await sqlForRequestIds([b.requestId]);
  const [b2] = await localBillsSince(page, t0);
  expect(rows.length === 1 && b2.server?.orderId === rows[0].id, `db ${rows.length}, local ${JSON.stringify(b2.server)}`);
  return `aborted at 15s ("${item.lastError}"), retried -> duplicate -> 1 order ${rows[0].billNumber}, POSTs ${n}`;
};

// ── 14 ───────────────────────────────────────────────────────────────────
S[14] = async function offNumberReuse() {
  // A PC whose browser data was cleared (or a second counter PC) starts the day's OFF counter again.
  await page.goto("/icon.svg");
  await page.evaluate(() => new Promise((res) => {
    const d = indexedDB.deleteDatabase("taresh-offline");
    d.onsuccess = d.onerror = d.onblocked = () => res();
  }));
  await page.goto("/finance/orders/new");
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(2500);
  // the same day's number, already used by a bill that synced earlier today?
  await ctx.setOffline(true);
  const { bill } = await offlineBill(`E2E-S14-${RUN}`);
  const clash = await sql(`SELECT "orderNumber" FROM "Order" WHERE "offlineRef" = $1`, [bill.offlineRef]);
  // Device codes: a cleared PC starts a new series that can't collide with the old one.
  expect(!clash.length, `OFF number reused: ${bill.offlineRef} already on ${clash.map((c) => c.orderNumber)}`);
  const earlier = await sql(`SELECT count(*)::int n FROM "Order" WHERE "offlineRef" LIKE $1`, [`OFF-${STAFF_CODE}-%-${bill.offlineRef.split("-")[3]}-${bill.offlineRef.split("-")[4]}`]);
  await ctx.setOffline(false);
  await blockSync(); // keep it unsynced while we look at the list
  await kickFlush();
  await page.goto("/finance/orders");
  await page.getByRole("button", { name: /Waiting to sync \(1\)/ }).waitFor({ timeout: 15_000 });
  await sleep(2000);
  const listed = await page.locator("tbody tr", { hasText: `E2E-S14-${RUN}` }).count();
  const byRef = await page.locator("tbody tr", { hasText: bill.offlineRef }).allInnerTexts();
  await unblockSync();
  await kickFlush();
  await waitHeader(/Synced ✓/, 30_000);
  const [row] = await sqlForRequestIds([bill.requestId]);
  expect(listed === 1, `unsynced bill ${bill.offlineRef} (E2E-S14) is not on the Orders list; rows with that OFF number: ${JSON.stringify(byRef)}`);
  return `after clearing site data: ${bill.offlineRef} (same day-counter used ${earlier[0].n}x on the server before, none with this device code); listed, synced as ${row.billNumber}`;
};

// ── 15 ───────────────────────────────────────────────────────────────────
S[15] = async function localCashAfterServerPayment() {
  await ctx.setOffline(true);
  const { bill } = await offlineBill("E2E-S15");
  await ctx.setOffline(false);
  await kickFlush();
  await page.getByText(/Synced as INV-/).waitFor({ timeout: 30_000 });
  const [row] = await sqlForRequestIds([bill.requestId]);
  // Paid in full on the server the moment it synced.
  expect(row.txns === 1 && row.paid === 27, `paid on creation: ${row.txns} txns, paid ${row.paid}`);
  // Reload = the local route (the in-place view doesn't survive a reload).
  await page.goto(`/finance/orders/local/${bill.requestId}`);
  await page.getByText(/Synced as INV-/).waitFor({ timeout: 15_000 });
  const pointer = await page.getByText(/take payment on the server bill/).innerText({ timeout: 5000 }).catch(() => "");
  const canCollect = await page.getByRole("button", { name: "Collect Cash" }).isVisible();
  const cashBox = await page.locator("#cash-received").count();
  expect(!canCollect && cashBox === 0 && pointer, `synced local bill still offers cash (Collect Cash ${canCollect}, box ${cashBox}, pointer "${pointer}")`);
  const link = page.getByRole("link", { name: new RegExp(`Open ${row.billNumber} to collect`) });
  expect(await link.isVisible(), "no link to the server bill");
  await link.click();
  await page.waitForURL(new RegExp(`/finance/orders/${row.id}`), { timeout: 15_000 });
  return `paid on the server -> local view hides cash, says "${pointer.slice(0, 50)}…", links to ${row.billNumber}`;
};

// ── runner ───────────────────────────────────────────────────────────────
// ── 16 ───────────────────────────────────────────────────────────────────
S[16] = async function offlineSignIn() {
  const t0 = new Date().toISOString();
  // Online sign-in through the form, so this PC remembers it.
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await page.locator("input[name=staffId]").fill(STAFF);
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.locator("input[name=password]").press("Enter");
  await page.waitForURL(/\/finance/, { timeout: 15_000 });
  const saved = await page.evaluate(() => localStorage.getItem("offline-logins") ?? "");
  expect(saved.includes(STAFF.toUpperCase()) && !saved.includes(PASSWORD), `remembered login ${saved.slice(0, 80)}`);
  await page.goto("/finance/orders/new"); // warm the screens under this login
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await sleep(2500);

  await ctx.setOffline(true);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await page.locator("input[name=staffId]").waitFor({ timeout: 10_000 });
  // Logged out offline: the saved screens must not open by URL.
  await page.goto("/finance/orders/new").catch(() => {});
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await page.locator("input[name=staffId]").waitFor({ timeout: 10_000 });

  const tryLogin = async (id, pw) => {
    await page.locator("input[name=staffId]").fill(id);
    await page.locator("input[name=password]").fill(pw);
    await page.locator("input[name=password]").press("Enter");
  };
  await tryLogin(STAFF, "wrong-password");
  await page.getByText("Invalid credentials").waitFor({ timeout: 10_000 });
  await tryLogin("NOBODY-9", PASSWORD);
  await page.getByText(/hasn.t signed in on this PC before/).waitFor({ timeout: 10_000 });

  // "Connected" but dead: the page thinks it is online, the server never answers.
  await ctx.setOffline(false);
  await ctx.route("**/api/auth/login", () => {}); // never answered
  await blockSync();
  const tLogin = Date.now();
  await tryLogin(STAFF.toLowerCase(), PASSWORD);
  await page.waitForURL(/\/finance\/orders\/new/, { timeout: 20_000 });
  log(`signed in on a dead line in ${Date.now() - tLogin}ms`);
  await ctx.setOffline(true);
  await ctx.unroute("**/api/auth/login");
  await unblockSync();
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor({ timeout: 10_000 });
  await sleep(1500);

  const { bill } = await offlineBill("E2E-S16", { qty: "3" });
  expect(bill.offlineRef.startsWith(`OFF-${STAFF_CODE}-`), `offline ref ${bill.offlineRef}`);
  await ctx.setOffline(false);
  await waitHeader(/Synced ✓/, 30_000);
  const [b] = (await localBillsSince(page, t0)).filter((x) => x.display.customerName === "E2E-S16");
  const rows = await sqlForRequestIds([b.requestId]);
  expect(b.state === "synced" && rows.length === 1, `synced ${b.state}, db rows ${rows.length}`);
  return `online sign-in remembered; offline logout sticks; wrong/unknown refused; dead-line sign-in in ${Date.now() - tLogin}ms; ${bill.offlineRef} -> ${rows[0].billNumber}`;
};

const pick = process.argv.slice(2).map(Number).filter(Boolean);
const order = pick.length ? pick : Object.keys(S).map(Number);
await db.connect();
await start();
// Warm next dev's on-demand compiles so timings mean something.
for (const u of ["/finance/orders", "/finance/cash", "/finance/orders/local/warmup", "/finance/orders/new"]) await page.goto(u).catch(() => {});
for (const n of order) {
  console.log(`\n== ${n}. ${S[n].name}`);
  const f0 = findings.length;
  try {
    await reset();
    const evidence = await S[n]();
    results.push([n, S[n].name, /^BLOCKED/.test(evidence) ? "BLOCKED" : "PASS", evidence]);
  } catch (e) {
    const shot = `scripts/offline-e2e/out/s${n}-fail.png`;
    await page?.screenshot({ path: shot }).catch(() => {});
    const state = await Promise.all([headerText(page), idb.all(page, "outbox"), idb.all(page, "localBills")]).catch((err) => [err.message]);
    (await import("node:fs")).writeFileSync(`scripts/offline-e2e/out/s${n}-state.json`, JSON.stringify({ url: page.url(), header: state[0], outbox: state[1], localBills: state[2]?.slice?.(0, 5) }, null, 1));
    results.push([n, S[n].name, "FAIL", e.message.split("\n")[0]]);
    console.log("   FAIL:", e.message.split("\n").slice(0, 3).join(" | "), `(screenshot ${shot})`);
    if (ctx.pages().length === 0 || page.isClosed()) await start().catch(() => {});
  }
  (await import("node:fs")).writeFileSync(`scripts/offline-e2e/out/s${n}-prints.json`, JSON.stringify(prints, null, 1));
  if (findings.length > f0) results.at(-1)[3] += ` [findings: ${findings.slice(f0).join(" / ")}]`;
}
await ctx.setOffline(false).catch(() => {});
await ctx.close().catch(() => {});
await db.end();
console.log("\n| # | scenario | result | evidence |\n|---|---|---|---|");
for (const r of results) console.log(`| ${r.join(" | ")} |`);
process.exit(results.some((r) => r[2] === "FAIL") ? 1 : 0);
