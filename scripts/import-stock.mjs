/**
 * Sets opening stock from the sheet's Quantity column.
 *
 *   node scripts/import-stock.mjs <sheet.csv>            # dry run
 *   node scripts/import-stock.mjs <sheet.csv> --commit   # writes
 *
 * ── Why this is a separate step from the catalogue import ────────────────
 * Stock is not a product attribute, it is a ledger. Every figure written here
 * gets an InventoryMovement beside it so the shop can see where the number
 * came from, the same way a GRN or a stock count would.
 *
 * ── What the Quantity column means ───────────────────────────────────────
 * As with the price columns, the sheet is not consistent. Measured against
 * the 398 products that already carry stock: 306 hold the sheet figure as-is,
 * 52 hold it multiplied by the pack size, 37 match neither. `502 BIRI` is
 * stored as 109 with 48 per pack; `AK Gold Rice` as 8892 = 342 x 26kg.
 *
 * The rule taken here is the majority one — the figure is a count of base
 * units — with a single exception that is unambiguous rather than a guess: a
 * product whose base unit is the KILO, whose sheet row gives a sack size, and
 * whose quantity is written as a bare number is a count of sacks, so it
 * multiplies out to kilos. That is the only shape where the as-is reading is
 * impossible (342 kg of rice is not 342 sacks). A quantity already written
 * with its unit — "195kg" — is kilos and is taken as it stands.
 *
 * Anything the column cannot be read as a number at all ("35 pkt",
 * "1+18 bag", "2 peti +3 pcs") or that is blank is left at zero and flagged
 * for the manager, where the quantity field is editable.
 *
 * Products that ALREADY hold stock are never touched: their figures have
 * moved since the earlier import (Bhoona Chana reads 150 against the sheet's
 * 160) and the shelf, not this spreadsheet, is right about those.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const norm = (s) =>
  s.toLowerCase().replace(/(\d)\s*(\/-|rs\b|\/)/g, "$1rs").replace(/[^a-z0-9]+/g, " ").trim();

/** Only a plain number or a plain "<n>kg" is a figure worth trusting unread. */
function parseQty(raw) {
  const t = raw.replace(/,/g, "").trim();
  if (!t) return { kind: "blank" };
  if (/^\d+(\.\d+)?$/.test(t)) return { kind: "number", value: Number(t) };
  const kg = t.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kg) return { kind: "kg", value: Number(kg[1]) };
  return { kind: "messy", raw: t };
}

const sackSize = (per) => {
  const m = per.trim().match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  return m ? Number(m[1]) : null;
};

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
  .map((c) => ({ name: (c[1] || "").trim(), qty: (c[3] || "").trim(), per: (c[4] || "").trim() }))
  .filter((r) => r.name);

const commit = process.argv.includes("--commit");
const client = new pg.Client({ connectionString: readFileSync(process.env.NURL, "utf8").trim() });
await client.connect();

const [warehouse] = (await client.query('select id from "Warehouse" order by "createdAt" limit 1')).rows;
const [actor] = (await client.query(`select id from "User" where role = 'ADMIN' order by "createdAt" limit 1`)).rows;
if (!warehouse || !actor) { console.error("No warehouse or admin user to attribute the movement to."); process.exit(1); }

const products = (await client.query(`
  select p.id, p.name, p."needsReview", p."reviewNotes", u.symbol as base,
         count(i.id) as inv_rows
  from "Product" p
  join "Unit" u on u.id = p."baseUnitId"
  left join "Inventory" i on i."productId" = p.id
  group by p.id, p.name, p."needsReview", p."reviewNotes", u.symbol
`)).rows;
const byName = new Map(products.map((p) => [norm(p.name), p]));

const plan = { set: [], flag: [], skipHasStock: 0, notFound: 0 };
const seen = new Set();

for (const row of rows) {
  const key = norm(row.name);
  if (seen.has(key)) continue;
  seen.add(key);
  const p = byName.get(key);
  if (!p) { plan.notFound++; continue; }
  // The shelf is right about anything already counted; the sheet is not.
  if (Number(p.inv_rows) > 0) { plan.skipHasStock++; continue; }

  const q = parseQty(row.qty);
  if (q.kind === "messy" || q.kind === "blank") {
    plan.flag.push({
      p,
      note:
        q.kind === "blank"
          ? `The sheet gives no quantity for this product, so it starts at zero stock.||Count what is on the shelf and enter it here.`
          : `The sheet records the quantity as "${q.raw}", which is not a number the system can read, so it starts at zero stock.||Work out how many ${p.base} that is and enter it here.`,
    });
    continue;
  }

  // Base unit kg + a sack size in the row + a PLAIN COUNT: the figure counts
  // sacks, so it multiplies out to kilos ("342" x 26kg = 8892kg of rice).
  // A figure already written as "195kg" is kilos and must not be multiplied —
  // the unit in the cell is the whole difference.
  const sack = p.base === "kg" && q.kind === "number" ? sackSize(row.per) : null;
  const qty = sack && sack > 1 ? q.value * sack : q.value;
  plan.set.push({ p, qty, sack, sheet: row.qty });
}

console.log(`sheet products                ${seen.size}`);
console.log(`  not in the catalogue        ${plan.notFound}`);
console.log(`  already hold stock (skip)   ${plan.skipHasStock}`);
console.log(`  stock to set                ${plan.set.length}`);
console.log(`  unreadable quantity (flag)  ${plan.flag.length}`);
console.log(`\nsample:`);
plan.set.slice(0, 8).forEach((s) =>
  console.log(`   ${s.p.name.padEnd(30)} sheet "${s.sheet}"${s.sack ? ` x ${s.sack}kg sack` : ""} -> ${s.qty} ${s.p.base}`)
);
console.log(`\nflagged sample:`);
plan.flag.slice(0, 6).forEach((f) => console.log(`   ${f.p.name.padEnd(30)} ${f.note.split("||")[0]}`));

if (!commit) {
  console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply.`);
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  for (const s of plan.set) {
    await client.query(
      `insert into "Inventory" (id, "productId", "warehouseId", "quantityOnHand", "quantityReserved")
       values ($1,$2,$3,$4,0)
       on conflict ("productId","warehouseId") do nothing`,
      [randomUUID(), s.p.id, warehouse.id, s.qty.toFixed(3)]
    );
    // The movement is what makes this auditable rather than a number that
    // appeared from nowhere — same shape a stock count writes.
    await client.query(
      `insert into "InventoryMovement" (id, "productId", "warehouseId", "beforeQty", "movementQty", "afterQty", "movementType", "referenceType", "referenceId", "userId")
       values ($1,$2,$3,0,$4,$4,'STOCK_COUNT_ADJUSTMENT','OPENING_STOCK',$5,$6)`,
      [randomUUID(), s.p.id, warehouse.id, s.qty.toFixed(3), "catalogue-sheet", actor.id]
    );
  }
  for (const f of plan.flag) {
    await client.query(
      `insert into "Inventory" (id, "productId", "warehouseId", "quantityOnHand", "quantityReserved")
       values ($1,$2,$3,0,0) on conflict ("productId","warehouseId") do nothing`,
      [randomUUID(), f.p.id, warehouse.id]
    );
    // Keep any existing note — a product can be flagged for its price and its
    // quantity at once, and dropping one to write the other hides half of it.
    const existing = f.p.needsReview && f.p.reviewNotes ? `${f.p.reviewNotes} ` : "";
    await client.query('update "Product" set "needsReview" = true, "reviewNotes" = $1 where id = $2', [
      existing + f.note,
      f.p.id,
    ]);
  }
  await client.query("commit");
  console.log(`\nWROTE stock for ${plan.set.length} products, flagged ${plan.flag.length} for counting.`);
} catch (err) {
  await client.query("rollback");
  console.error("\nRolled back — nothing written:", err.message);
  process.exitCode = 1;
}
await client.end();
