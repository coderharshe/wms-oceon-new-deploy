#!/usr/bin/env node
// Offline navigation matrix against a production build (service worker behaviour).
//   E2E_BASE=http://localhost:8787 E2E_PROFILE=<short fresh dir> node scripts/offline-e2e/prod-nav.mjs once|clientnav|warm|deploy
// once:      New Order loaded a single time online, then offline (F2 guard + reload).
// clientnav: screens reached only with F2/Alt+O (client-side), then offline reloads.
// warm:      Finance screens hard-loaded online + a server bill, then the offline matrix.
// deploy:    parks on the old build until <profile>.go exists (rebuild + restart the server, then touch it).
import fs from "node:fs";
import { launch, login, sql, db, sleep, log, keyboardBill, BASE, PROFILE } from "./lib.mjs";

const mode = process.argv[2] ?? "warm";
const rows = [];
let ctx, page;

const ready = (p = page) => p.getByRole("button", { name: /Generate Bill/ }).waitFor({ timeout: 8000 }).then(() => true, () => false);

async function state(label, how, res) {
  await sleep(3500);
  const url = page.url();
  const body = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const markers = {
    newOrder: await page.getByRole("button", { name: /Generate Bill/ }).isVisible().catch(() => false),
    savedList: /Showing saved list from/i.test(body),
    savedBill: /No connection — showing the copy saved on this PC/i.test(body),
    chromeError: url.startsWith("chrome-error") || /can.t be reached|ERR_INTERNET_DISCONNECTED|No internet/i.test(body),
    login: /\/login/.test(url),
  };
  const r = { label, how, url: url.replace(BASE, ""), fromSW: res?.fromServiceWorker?.() ?? null, status: res?.status?.() ?? null, ...markers, h1: (await page.locator("h1").first().innerText({ timeout: 500 }).catch(() => "")).slice(0, 40), body: body.replace(/\s+/g, " ").replace(/^.*?RECEIVE STOCK/, "").slice(0, 220) };
  rows.push(r);
  log(JSON.stringify(r));
  return r;
}

async function key(label, k, re) {
  await page.keyboard.press(k);
  await page.waitForURL(re, { timeout: 8000 }).catch(() => {});
  return state(label, k);
}
async function go(label, url) {
  const res = await page.goto(url).catch((e) => (log(label, e.message.split("\n")[0]), null));
  return state(label, "goto", res);
}
/** Back to a working New Order while offline; if the SW can't serve it, load it online (no outbox, nothing to sync). */
async function backToNew() {
  if (/\/finance\/orders\/new/.test(page.url()) && (await ready())) return;
  const res = await page.goto("/finance/orders/new").catch(() => null);
  if (res !== undefined && (await ready())) return;
  log("recovering New Order online");
  await ctx.setOffline(false);
  await page.goto("/finance/orders/new");
  await ready();
  await sleep(1500);
  await ctx.setOffline(true);
}
const swCache = () => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url.replace(location.origin, ""));
  return out;
}).catch((e) => ({ error: e.message }));
const scripts = () => page.evaluate(() => [...document.scripts].map((s) => s.src.replace(location.origin, "")).filter(Boolean).sort());
const buildId = () => page.evaluate(() => {
  const m = document.documentElement.innerHTML.match(/"buildId":"([^"]+)"|\\"b\\":\\"([^"\\]+)\\"|"b":"([^"]+)"/);
  return m ? m[1] ?? m[2] ?? m[3] : null;
});

await db.connect();
ctx = await launch();
await login(ctx);
page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("pageerror", (e) => log("pageerror:", e.message.slice(0, 160)));
if (process.env.E2E_DEBUG_NET) {
  page.on("requestfailed", (r) => log("requestfailed:", r.method(), r.url().replace(BASE, ""), r.failure()?.errorText, "mode=" + r.resourceType()));
  page.on("framenavigated", (f) => log("framenavigated:", f.url().replace(BASE, "")));
}

if (mode === "once") {
  await page.goto("/finance/orders/new");
  await ready();
  await sleep(3000); // SW registered + claimed
  log("controller:", await page.evaluate(() => !!navigator.serviceWorker.controller));
  log("cache after one visit:", JSON.stringify(await swCache()));
  await keyboardBill(page, { name: "PROD-C-BASKET", submit: false });
  const before = await page.locator("tbody tr", { hasText: "0 HELL CAN" }).count();
  await ctx.setOffline(true);
  const c = await key("C: F2 on New Order (offline)", "F2", /never/);
  const after = await page.locator("tbody tr", { hasText: "0 HELL CAN" }).count().catch(() => -1);
  const name = await page.locator("input").evaluateAll((els) => els.map((e) => e.value).filter((v) => v === "PROD-C-BASKET").length).catch(() => -1);
  log(`C: basket lines before ${before} after ${after}, name kept ${name}`);
  rows.push({ label: "C basket", before, after, name, stayed: c.newOrder && !c.chromeError });
  await go("B0: reload /finance/orders/new after ONE online visit", "/finance/orders/new");
  await ctx.setOffline(false);
}

if (mode === "clientnav") {
  // The real morning: the SW is already controlling (login page), the cashier lands on the
  // Dashboard and reaches New Order / Orders with F2 / Alt+O — client-side, never a document load.
  await page.goto("/finance");
  await sleep(3000);
  await page.reload();
  await sleep(2500);
  log("controller:", await page.evaluate(() => !!navigator.serviceWorker.controller));
  await key("online F2 Dashboard -> New Order", "F2", /\/finance\/orders\/new/);
  await ready();
  await key("online Alt+O -> Orders", "Alt+O", /\/finance\/orders$/);
  await key("online F2 -> New Order", "F2", /\/finance\/orders\/new/);
  await sleep(2000);
  log("cache:", JSON.stringify(await swCache()));
  await ctx.setOffline(true);
  await key("offline Alt+O -> Orders (visited client-side)", "Alt+O", /\/finance\/orders$/);
  await key("offline Alt+D -> Dashboard (document cached)", "Alt+D", /\/finance$/);
  await key("offline F2 -> New Order (visited client-side)", "F2", /\/finance\/orders\/new/);
  await go("offline reload /finance/orders/new (only visited client-side)", "/finance/orders/new");
  await go("offline load /finance (document cached)", "/finance");
  await ctx.setOffline(false);
}

if (mode === "warm") {
  // Online: use the screens like a cashier would.
  for (const u of ["/finance/orders/new", "/finance", "/finance/orders", "/finance/cash", "/finance/orders/new"]) {
    await page.goto(u);
    await sleep(2500);
  }
  await ready();
  const t0 = new Date().toISOString();
  await keyboardBill(page, { name: "PROD-NAV-OPENED" });
  await page.waitForURL(/\/finance\/orders\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Modify Bill" }).waitFor({ timeout: 20_000 });
  await sleep(2000);
  const opened = new URL(page.url()).pathname;
  // A second bill made elsewhere, never opened in this browser.
  const [l] = await sql(`SELECT p.id "productId", pu."unitId" FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id WHERE p.name = '0 HELL CAN' LIMIT 1`);
  const made = await ctx.request.post("/api/finance/orders", { data: { sellingMode: "WHOLESALE", customer: { ownerName: "PROD-NAV-NEVER", type: "WHOLESALE" }, items: [{ ...l, quantity: 1, discount: 0, unitPrice: 9 }] } });
  const { order } = await made.json();
  const never = `/finance/orders/${order.id}`;
  log("opened", opened, "never", never, t0);
  await page.goto("/finance/orders/new");
  await ready();
  await sleep(2500);
  log("cache:", JSON.stringify(await swCache()));
  await ctx.setOffline(true);

  await key("Alt+O New Order -> Orders", "Alt+O", /\/finance\/orders$/);
  await key("Alt+D Orders -> Dashboard", "Alt+D", /\/finance$/);
  await key("F2 Dashboard -> New Order", "F2", /\/finance\/orders\/new/);
  await backToNew();
  await key("Alt+D New Order -> Dashboard", "Alt+D", /\/finance$/);
  await backToNew();
  await go("reload /finance/orders/new", "/finance/orders/new");
  await backToNew();
  await go("reload /finance/orders", "/finance/orders");
  await backToNew();
  await go("load opened server bill", opened);
  await backToNew();
  await go("load opened server bill ?print=1", opened + "?print=1");
  await backToNew();
  await go("load NEVER-opened server bill", never);
  await backToNew();
  // In-app ways into the bill that was opened online via F10 (client-side, so no document was cached).
  await key("Alt+O -> Orders (for row click)", "Alt+O", /\/finance\/orders$/);
  await page.locator("tbody tr", { hasText: "PROD-NAV-OPENED" }).first().getByRole("link").first().click({ timeout: 5000 }).catch((e) => log("row link:", e.message.slice(0, 120)));
  await page.waitForURL(/\/finance\/orders\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {});
  await state("click opened bill on saved Orders list", "click");
  await backToNew();
  await key("Alt+O -> Orders (for never-opened row click)", "Alt+O", /\/finance\/orders$/);
  await page.locator("tbody tr", { hasText: "PROD-NAV-NEVER" }).first().getByRole("link").first().click({ timeout: 5000 }).catch((e) => log("row link:", e.message.slice(0, 120)));
  await page.waitForURL(/\/finance\/orders\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {});
  await state("click NEVER-opened bill on saved Orders list", "click");
  await backToNew();
  await go("load /finance (visited online)", "/finance");
  await backToNew();
  await go("load /finance/inventory (never visited)", "/finance/inventory");
  await backToNew();
  // client-side into a server bill from the saved Orders list
  await ctx.setOffline(false);
}

if (mode === "deploy") {
  // Old build: use the screens, leave the tab open, wait for the rebuild+restart (touch <profile>.go).
  for (const u of ["/finance/orders/new", "/finance/orders", "/finance/orders/new"]) (await page.goto(u), await sleep(2500));
  await ready();
  const snap = { before: { buildId: await buildId(), scripts: await scripts(), cache: await swCache() } };
  log("old build", snap.before.buildId, "- waiting for", `${PROFILE}.go`);
  while (!fs.existsSync(`${PROFILE}.go`)) await sleep(2000);
  // The tab still runs the old build: client-side nav first, as the cashier would.
  await key("deploy: old tab Alt+O (online)", "Alt+O", /\/finance\/orders$/);
  snap.afterClientNav = { buildId: await buildId(), scripts: await scripts() };
  await key("deploy: F2 back (online)", "F2", /\/finance\/orders\/new/);
  const res = await page.reload();
  await state("deploy: reload New Order (online)", "reload", res);
  await sleep(2000);
  snap.afterReload = { buildId: await buildId(), scripts: await scripts(), cache: await swCache() };
  // Were any scripts served from the SW cache that the new server no longer has?
  snap.staleScripts = [];
  for (const s of snap.afterReload.scripts) {
    const r = await ctx.request.get(s);
    if (!r.ok()) snap.staleScripts.push([s, r.status()]);
  }
  await ctx.setOffline(true);
  await go("deploy: offline reload New Order", "/finance/orders/new");
  snap.offline = { buildId: await buildId().catch(() => null), scripts: await scripts().catch(() => null) };
  await backToNew();
  await key("deploy: offline Alt+O", "Alt+O", /\/finance\/orders$/);
  await go("deploy: offline reload Orders", "/finance/orders");
  await ctx.setOffline(false);
  fs.writeFileSync(`${PROFILE}-deploy.json`, JSON.stringify(snap, null, 1));
  log("snapshot", `${PROFILE}-deploy.json`);
}

await ctx.close();
await db.end();
console.log(JSON.stringify(rows.map(({ body, ...r }) => r), null, 1));
