// How often does an offline Generate Bill print its slip / reach the local screen? And can Back recover?
import { launch, login, prints, keyboardBill, sleep, idb } from "../lib.mjs";
const ctx = await launch(); await login(ctx);
const page = ctx.pages()[0] ?? await ctx.newPage();
const navs = [];
page.on("framenavigated", (f) => f === page.mainFrame() && navs.push(f.url()));
for (let i = 0; i < 5; i++) {
  await ctx.setOffline(false);
  await page.goto("/finance/orders/new"); await page.getByRole("button", { name: /Generate Bill/ }).waitFor(); await sleep(1500);
  await ctx.setOffline(true);
  navs.length = 0; const p0 = prints.length; const t = Date.now();
  await keyboardBill(page, { name: `PROBE-OFF-${i}` });
  await sleep(4000);
  const slip = prints.slice(p0).some((p) => /PROVISIONAL/.test(p.html));
  console.log(`#${i} slip=${slip} url=${page.url().slice(0, 60)} navs=${JSON.stringify(navs.map((u) => u.slice(0, 60)))}`);
  if (i === 4) {
    await page.goBack().catch((e) => console.log("back err", e.message.split("\n")[0]));
    await sleep(2000);
    console.log("after Back:", page.url(), await page.getByRole("button", { name: /Generate Bill/ }).isVisible().catch(() => false) ? "New Order usable" : "not usable", await page.getByText(/Picked up where you left off/).isVisible().catch(() => false) ? "(basket restored)" : "");
  }
}
await ctx.setOffline(false);
await page.goto("/finance/orders/new"); await sleep(8000);
await ctx.close();
