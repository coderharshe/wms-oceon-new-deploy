#!/usr/bin/env node
// Cache-hygiene check: no _rsc entries ever get cached, and a stale (old-build)
// static chunk left in the cache gets pruned after a full core-page warm.
// (Can't force a genuinely different build hash without touching src/**, which
// is off-limits here, so a fake leftover chunk stands in for "old build".)
import { launch, login, sleep, log } from "./lib.mjs";

const ctx = await launch();
await login(ctx);
const page = ctx.pages()[0] ?? (await ctx.newPage());

for (const u of ["/finance/orders/new", "/finance", "/finance/orders", "/finance/cash"]) {
  await page.goto(u);
  await sleep(2000);
}
await sleep(1500);

const dump = () =>
  page.evaluate(async () => {
    const c = await caches.open("taresh-shell-v3");
    const keys = (await c.keys()).map((k) => new URL(k.url).pathname + new URL(k.url).search);
    return { count: keys.length, keys, rscCount: keys.filter((k) => /_rsc=/.test(k)).length };
  });

const before = await dump();
log("cache before:", before.count, "entries, _rsc entries:", before.rscCount);

// Simulate a leftover chunk from an old build.
await page.evaluate(async () => {
  const c = await caches.open("taresh-shell-v3");
  await c.put("/_next/static/chunks/OLD-STALE-BUILD-fake123.js", new Response("stale old build content", { headers: { "content-type": "application/javascript" } }));
});
const withFake = await dump();
log("after injecting a fake stale chunk:", withFake.count, "entries; has fake:", withFake.keys.includes("/_next/static/chunks/OLD-STALE-BUILD-fake123.js"));

// Full core warm (matches sw.js's isCore check exactly) -> should prune the stale chunk.
await page.evaluate(
  () =>
    new Promise((res) => {
      navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", urls: ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"] }));
      setTimeout(res, 4000);
    })
);
const after = await dump();
log("cache after core warm (should have pruned the fake):", after.count, "entries, _rsc entries:", after.rscCount);
log("fake chunk still present?", after.keys.includes("/_next/static/chunks/OLD-STALE-BUILD-fake123.js"));
log("any _rsc-tainted keys anywhere?", JSON.stringify(after.keys.filter((k) => /_rsc/.test(k))));

await ctx.close();
