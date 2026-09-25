import { launch, login, sleep } from "../lib.mjs";
const ctx = await launch(); await login(ctx);
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto("/finance/cash"); await sleep(1500);
const probe = async (label) => console.log(label, await page.evaluate(async () => {
  const t = (p) => fetch(p, { signal: AbortSignal.timeout(5000) }).then((r) => r.status, (e) => "ERR " + e.name);
  return { onLine: navigator.onLine, controlled: !!navigator.serviceWorker.controller, get: await t("/api/finance/print-settings") };
}));
await probe("online, before:");
await ctx.setOffline(true);
await page.goto("/finance/cash").catch((e) => console.log("goto offline failed", e.message.split("\n")[0]));
await sleep(1000);
await probe("offline, SW-served page:");
await ctx.setOffline(false); await sleep(1500);
await probe("back online, same page:");
const p2 = await ctx.newPage(); await p2.goto("/finance/cash").then(() => console.log("new page load ok"), (e) => console.log("new page fail", e.message));
await ctx.close();
