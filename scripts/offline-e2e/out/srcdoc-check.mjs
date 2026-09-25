import { launch, login, prints, sleep } from "../lib.mjs";
const ctx = await launch(); await login(ctx);
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto("/finance/orders");
await page.evaluate(() => { const f = document.createElement("iframe"); f.onload = () => f.contentWindow.print(); f.srcdoc = "<p>PROVISIONAL test</p>"; document.body.appendChild(f); });
await sleep(1500);
console.log("captured srcdoc print:", prints.length, prints[0]?.html);
// now: print then immediately navigate the tab offline, as submit() does
await ctx.setOffline(true);
await page.evaluate(() => { const f = document.createElement("iframe"); f.onload = () => f.contentWindow.print(); f.srcdoc = "<p>PROVISIONAL two</p>"; document.body.appendChild(f); location.href = "/finance/orders/local/never-visited"; });
await sleep(3000);
console.log("after nav:", prints.length, page.url());
await ctx.setOffline(false); await ctx.close();
