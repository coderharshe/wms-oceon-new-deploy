#!/usr/bin/env node
// Verify: sign out, warm (must NOT cache the login redirect under a /finance URL),
// sign in, go offline, reload a warmed page -> must show the real page, not /login.
import { launch, login, sleep, log, BASE } from "./lib.mjs";

const ctx = await launch();
await login(ctx);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("/finance");
await sleep(2500); // initial warm on load

log("--- signing out ---");
await ctx.request.post("/api/auth/logout").catch((e) => log("logout err", e.message));
await page.goto("/login");
await sleep(1000);

log("--- attempting a warm while logged out ---");
const warmResult = await page.evaluate(
  () =>
    new Promise((res) => {
      if (!navigator.serviceWorker.controller) return res({ noController: true });
      navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", urls: ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"] }));
      setTimeout(() => res({ posted: true }), 3000);
    })
);
log("warm post result:", JSON.stringify(warmResult));
await sleep(2000);

const cacheAfterLoggedOutWarm = await page.evaluate(async () => {
  const c = await caches.open("taresh-shell-v3");
  const keys = (await c.keys()).map((k) => new URL(k.url).pathname);
  const out = {};
  for (const p of ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"]) {
    if (!keys.includes(p)) { out[p] = "not cached"; continue; }
    const r = await c.match(p);
    const t = await r.text();
    out[p] = /Sign in|LOGIN|type="password"/i.test(t) ? "CACHED LOGIN PAGE (bug)" : "cached, looks like the real page";
  }
  return out;
});
log("cache contents for /finance URLs after logged-out warm attempt:", JSON.stringify(cacheAfterLoggedOutWarm, null, 1));

log("--- signing back in ---");
await login(ctx, "FIN-11");
await page.goto("/finance");
await sleep(2500);

log("--- going offline, reloading a warmed page ---");
await ctx.setOffline(true);
const res = await page.goto("/finance").catch((e) => (log("goto err", e.message), null));
await sleep(1000);
const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
const looksLikeLogin = /Sign in|type="password"/i.test(bodyText) || /\/login/.test(page.url());
log(`final url: ${page.url().replace(BASE, "")}, looksLikeLogin: ${looksLikeLogin}, status: ${res?.status?.()}, fromSW: ${res?.fromServiceWorker?.()}`);
log("body snippet:", bodyText.replace(/\s+/g, " ").slice(0, 200));
await ctx.setOffline(false);

await ctx.close();
