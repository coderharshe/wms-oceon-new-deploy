#!/usr/bin/env node
// Deeper diagnostic for the "never-opened bill offline -> chrome-error" bug:
// use CDP Network domain to see whether the SW's fetch handler ever produced
// a response, or whether the navigation failed before/without SW involvement.
import { launch, login, sql, sleep, log, db } from "./lib.mjs";

const ctx = await launch();
await login(ctx);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await db.connect();

const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.responseReceived", (e) => {
  if (e.response.url.includes("/finance/orders/")) log("responseReceived:", e.response.url, e.response.status, "fromServiceWorker=", e.response.fromServiceWorker, "fromDiskCache=", e.response.fromDiskCache);
});
cdp.on("Network.loadingFailed", (e) => {
  log("loadingFailed:", e.requestId, e.errorText, e.type, e.canceled);
});
cdp.on("Network.requestWillBeSent", (e) => {
  if (e.request.url.includes("/finance/orders/")) log("requestWillBeSent:", e.request.url, e.type);
});
cdp.on("Network.requestServedFromCache", (e) => log("requestServedFromCache:", e.requestId));

for (const u of ["/finance/orders/new", "/finance", "/finance/orders", "/finance/cash"]) {
  await page.goto(u);
  await sleep(1500);
}
await sleep(1500);

const [l] = await sql(`SELECT p.id "productId", pu."unitId" FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id WHERE p.name = '0 HELL CAN' LIMIT 1`);
const made = await ctx.request.post("/api/finance/orders", { data: { sellingMode: "WHOLESALE", customer: { ownerName: "DEBUG-CDP-NEVER", type: "WHOLESALE" }, items: [{ ...l, quantity: 1, discount: 0, unitPrice: 9 }] } });
const { order } = await made.json();
const never = `/finance/orders/${order.id}`;
log("never-opened bill url:", never);

await ctx.setOffline(true);
log("--- goto never-opened bill (offline) ---");
const nav = await page.goto(never).catch((e) => ({ gotoError: e.message.split("\n")[0] }));
log("goto result:", nav?.status ? nav.status() : JSON.stringify(nav));
log("final url:", page.url());
await sleep(1500);

await ctx.setOffline(false);
await ctx.close();
await db.end();
