#!/usr/bin/env node
// Attaches a SECOND, purely observational fetch listener inside the already-running
// SW (via Playwright Worker.evaluate) to print event.request.mode for the failing
// "never-opened bill, offline" navigation, without touching public/sw.js on disk.
import { launch, login, sql, sleep, log, db } from "./lib.mjs";

const ctx = await launch();
let swWorker;
ctx.on("serviceworker", (sw) => { swWorker = sw; log("SW registered:", sw.url()); });
await login(ctx);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await db.connect();

await page.goto("/finance/orders/new");
await sleep(2000);
if (!swWorker) { log("no SW worker captured yet, waiting..."); await sleep(2000); }
log("attaching observer listener inside live SW...");
await swWorker.evaluate(() => {
  self.addEventListener("fetch", (e) => {
    if (e.request.url.includes("/finance/orders/") && !e.request.url.includes("_rsc") && !e.request.url.includes("/new")) {
      self.__lastMode = { url: e.request.url, mode: e.request.mode, destination: e.request.destination };
      console.log("OBSERVED", e.request.url, "mode=", e.request.mode, "destination=", e.request.destination);
    }
  });
});

const [l] = await sql(`SELECT p.id "productId", pu."unitId" FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id WHERE p.name = '0 HELL CAN' LIMIT 1`);
const made = await ctx.request.post("/api/finance/orders", { data: { sellingMode: "WHOLESALE", customer: { ownerName: "DEBUG-MODE-NEVER", type: "WHOLESALE" }, items: [{ ...l, quantity: 1, discount: 0, unitPrice: 9 }] } });
const { order } = await made.json();
const never = `/finance/orders/${order.id}`;
log("never-opened bill url:", never);

swWorker.on("console", (msg) => log("SW console:", msg.text()));

await ctx.setOffline(true);
const nav = await page.goto(never).catch((e) => ({ gotoError: e.message.split("\n")[0] }));
log("goto result:", nav?.status ? nav.status() : JSON.stringify(nav));
log("final url:", page.url());
await sleep(1000);
const captured = await swWorker.evaluate(() => self.__lastMode);
log("captured request info:", JSON.stringify(captured));

await ctx.setOffline(false);
await ctx.close();
await db.end();
