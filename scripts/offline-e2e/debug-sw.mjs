#!/usr/bin/env node
// Ad-hoc diagnostic: capture the service worker's own console/error output while
// reproducing the "never-opened bill offline -> chrome-error instead of offline.html" bug.
import { launch, login, sql, db, sleep, log } from "./lib.mjs";

const ctx = await launch();
ctx.on("serviceworker", (sw) => {
  log("SW registered:", sw.url());
  sw.on("console", (msg) => log("SW console:", msg.type(), msg.text()));
  sw.on("pageerror", (e) => log("SW pageerror:", e.message));
});
await db.connect();
await login(ctx);
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (msg) => log("PAGE console:", msg.type(), msg.text()));
page.on("pageerror", (e) => log("PAGE pageerror:", e.message));

for (const u of ["/finance/orders/new", "/finance", "/finance/orders", "/finance/cash"]) {
  await page.goto(u);
  await sleep(1500);
}
await sleep(2000);
log("controller:", await page.evaluate(() => !!navigator.serviceWorker.controller));

const [l] = await sql(`SELECT p.id "productId", pu."unitId" FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id WHERE p.name = '0 HELL CAN' LIMIT 1`);
const made = await ctx.request.post("/api/finance/orders", { data: { sellingMode: "WHOLESALE", customer: { ownerName: "DEBUG-NEVER", type: "WHOLESALE" }, items: [{ ...l, quantity: 1, discount: 0, unitPrice: 9 }] } });
const { order } = await made.json();
const never = `/finance/orders/${order.id}`;
log("never-opened bill url:", never);

const cacheCheck = await page.evaluate(async () => {
  const c = await caches.open("taresh-shell-v3");
  const r = await c.match("/offline.html");
  const keys = (await c.keys()).map((k) => k.url);
  return { found: !!r, status: r?.status, keysHasOffline: keys.some((u) => u.endsWith("/offline.html")) };
});
log("cache check (online):", JSON.stringify(cacheCheck));

await ctx.setOffline(true);
const cacheCheckOffline = await page.evaluate(async () => {
  const c = await caches.open("taresh-shell-v3");
  const r = await c.match("/offline.html");
  return { found: !!r, status: r?.status };
});
log("cache check (offline):", JSON.stringify(cacheCheckOffline));
log("--- raw fetch() from page context ---");
const res = await page.evaluate(async (u) => {
  try {
    const r = await fetch(u, { cache: "no-store" });
    return { ok: r.ok, status: r.status, type: r.type, url: r.url };
  } catch (e) {
    return { error: e.message, name: e.name };
  }
}, never);
log("fetch() result:", JSON.stringify(res));

log("--- page.goto() ---");
const nav = await page.goto(never).catch((e) => ({ gotoError: e.message.split("\n")[0] }));
log("goto result:", nav?.status ? nav.status() : JSON.stringify(nav));
log("final url:", page.url());
await sleep(1000);

await ctx.setOffline(false);
await ctx.close();
await db.end();
