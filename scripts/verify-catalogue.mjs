/**
 * Read-only check: does every row of the sheet exist in the catalogue, with a
 * price and a stock figure?
 *
 *   NURL=<file-with-conn-string> node scripts/verify-catalogue.mjs <sheet.csv>
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const norm = (s) =>
  s.toLowerCase().replace(/(\d)\s*(\/-|rs\b|\/)/g, "$1rs").replace(/[^a-z0-9]+/g, " ").trim();

// The sheet's Quantity column is free text: "313.33", "35 pkt", "5.550kg",
// "1+18 bag", "2 peti +3 pcs". Only a plain number or a plain <n>kg is a
// figure that can be trusted without a human reading it.
function parseQty(raw) {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return { kind: "blank" };
  if (/^\d+(\.\d+)?$/.test(t)) return { kind: "number", value: Number(t) };
  const kg = t.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kg) return { kind: "kg", value: Number(kg[1]) };
  return { kind: "messy", raw: t };
}

const rows = readFileSync(process.argv[2], "utf8")
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const cells = [];
    let cur = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  })
  .map((c) => ({ name: (c[1] || "").trim(), qty: (c[3] || "").trim(), ws: (c[5] || "").trim() }))
  .filter((r) => r.name);

const client = new pg.Client({ connectionString: readFileSync(process.env.NURL, "utf8").trim() });
await client.connect();
const db = (await client.query(`
  select p.name, p.active, p."needsReview", p."wholesalePrice" as ws,
         coalesce(sum(i."quantityOnHand"), 0) as on_hand,
         count(i.id) as inv_rows
  from "Product" p
  left join "Inventory" i on i."productId" = p.id
  group by p.id, p.name, p.active, p."needsReview", p."wholesalePrice"
`)).rows;
await client.end();

const byName = new Map(db.map((p) => [norm(p.name), p]));

const seen = new Set();
let missing = 0, priced = 0, unpriced = 0, hasStock = 0, noStockRow = 0, zeroStock = 0;
const qtyKinds = { number: 0, kg: 0, messy: 0, blank: 0 };
const missingNames = [];
const noStockNames = [];

for (const r of rows) {
  const k = norm(r.name);
  if (seen.has(k)) continue;
  seen.add(k);
  qtyKinds[parseQty(r.qty).kind]++;

  const hit = byName.get(k);
  if (!hit) { missing++; if (missingNames.length < 10) missingNames.push(r.name); continue; }
  if (Number(hit.ws) > 0) priced++; else unpriced++;
  if (Number(hit.inv_rows) === 0) { noStockRow++; if (noStockNames.length < 6) noStockNames.push(r.name); }
  else if (Number(hit.on_hand) > 0) hasStock++;
  else zeroStock++;
}

console.log(`sheet products (unique)      ${seen.size}`);
console.log(`  in the catalogue           ${seen.size - missing}`);
console.log(`  MISSING from catalogue     ${missing}`);
missingNames.forEach((n) => console.log(`      ${n}`));
console.log(`\nof those in the catalogue:`);
console.log(`  have a price > 0           ${priced}`);
console.log(`  price is 0 (flagged)       ${unpriced}`);
console.log(`  have stock on hand         ${hasStock}`);
console.log(`  have a stock row, but zero ${zeroStock}`);
console.log(`  NO stock row at all        ${noStockRow}`);
noStockNames.forEach((n) => console.log(`      ${n}`));
console.log(`\nthe sheet's Quantity column:`);
console.log(`  plain number               ${qtyKinds.number}`);
console.log(`  plain <n>kg                ${qtyKinds.kg}`);
console.log(`  free text ("35 pkt", …)    ${qtyKinds.messy}`);
console.log(`  blank                      ${qtyKinds.blank}`);
