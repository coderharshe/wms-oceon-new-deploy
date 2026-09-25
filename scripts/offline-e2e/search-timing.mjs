// Measures the window a cashier types Enter into: from the first dropdown paint
// (local catalogue, instant) to the live /api/products paint, and checks that the
// row under the highlight cannot change in between.
//
// Run: node scripts/offline-e2e/search-timing.mjs [query ...]
import { launch, login, BASE } from "./lib.mjs";

const queries = process.argv.slice(2).length ? process.argv.slice(2) : ["c", "co", "coke", "ri", "te", "s 1"];

const ctx = await launch();
await login(ctx);
const page = await ctx.newPage();
await page.goto(`${BASE}/finance/orders/new`, { waitUntil: "load" });
await page.waitForTimeout(2500); // let the catalogue cache settle

console.log("query | first paint | live paint | gap | top row at first paint | top row after live | moved?");
for (const q of queries) {
  const box = page.getByPlaceholder(/Barcode \/ SKU \/ name/i);
  await box.fill("");
  await page.waitForTimeout(400);
  // Type all but the last character and let that settle, so every paint we
  // time below belongs to the SAME finished text — the window the cashier
  // actually presses Enter into. (Timing the whole word instead compares the
  // list for "c" against the list for "coke", which of course differs.)
  if (q.length > 1) {
    await box.type(q.slice(0, -1), { delay: 0 });
    await page.waitForTimeout(1500);
  }

  // Watch the dropdown's rows: every change, with a timestamp, plus the API reply time.
  await page.evaluate(() => {
    window.__paints = [];
    window.__api = null;
    const box = document.querySelector('[role="listbox"]');
    window.__t0 = performance.now();
    const read = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((el) => el.textContent?.trim().slice(0, 40));
    window.__obs = new MutationObserver(() => {
      const rows = read();
      if (rows.length) window.__paints.push({ at: Math.round(performance.now() - window.__t0), rows });
    });
    window.__obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    void box;
  });
  const apiWait = page
    .waitForResponse((r) => r.url().includes("/api/products?q=") && r.status() === 200, { timeout: 15000 })
    .catch(() => null);

  await page.evaluate(() => {
    window.__before = [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((el) => el.textContent?.trim().slice(0, 40)).join("|");
    window.__t0 = performance.now();
  });
  await box.type(q.slice(-1), { delay: 0 });
  const res = await apiWait;
  await page.waitForTimeout(1200); // let the live paint land and settle

  const out = await page.evaluate(() => {
    window.__obs?.disconnect();
    // Ignore paints that still show the PREVIOUS text's rows: the observer also
    // catches re-renders of the old list (a highlight ring, stock filling in).
    const key = (p) => p.rows.join("|");
    const before = window.__before ?? "";
    const paints = window.__paints.filter((p) => key(p) !== before);
    const first = paints[0];
    const last = paints[paints.length - 1];
    // Which row the arrow-key highlight is on now
    const sel = document.querySelector('[role="listbox"] [aria-selected="true"]');
    return {
      count: paints.length,
      first: first ? { at: first.at, top: first.rows[0], id: (first.rows[0] ?? "").match(/\(([^)]+)\)/)?.[1] ?? null, n: first.rows.length } : null,
      last: last ? { at: last.at, top: last.rows[0], id: (last.rows[0] ?? "").match(/\(([^)]+)\)/)?.[1] ?? null, n: last.rows.length } : null,
      highlighted: sel?.textContent?.trim().slice(0, 40) ?? null,
    };
  });

  const gap = out.first && out.last ? out.last.at - out.first.at : null;
  const moved = out.first && out.last ? (out.first.id === out.last.id ? "no" : "YES — DIFFERENT PRODUCT") : "n/a";
  // Enter pressed INSIDE the window: does the product the cashier read land on the bill?
  let billed = "-";
  if (out.first) {
    await box.fill("");
    await page.waitForTimeout(500);
    if (q.length > 1) {
      await box.type(q.slice(0, -1), { delay: 0 });
      await page.waitForTimeout(1500);
    }
    await box.type(q.slice(-1), { delay: 0 });
    await page.waitForTimeout(120); // mid-window: after the instant paint, before the live one
    await box.press("Enter");
    await page.waitForTimeout(700);
    const rows = await page.locator("tbody tr").first().textContent().catch(() => null);
    billed = (rows ?? "").trim().slice(0, 26) || "-";
    await page.locator('button[title^="Remove"]').first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  console.log(
    `${JSON.stringify(q).padEnd(7)} | ${String(out.first?.at ?? "-").padStart(5)}ms | ${String(out.last?.at ?? "-").padStart(5)}ms | ${String(gap ?? "-").padStart(5)}ms | ` +
      `${(out.first?.top ?? "-").padEnd(30)} | ${moved.padEnd(23)} | billed@120ms: ${billed}` +
      (out.highlighted && out.first && !out.highlighted.startsWith(out.first.top?.split(" (")[0] ?? "") ? "  HIGHLIGHT MOVED" : "")
  );
}

await ctx.close();
