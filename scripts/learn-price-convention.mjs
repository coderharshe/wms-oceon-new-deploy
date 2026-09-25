/**
 * Read-only diagnostic: for sheet rows that are ALREADY in the catalogue,
 * report whether the earlier import stored the sheet's wholesale figure
 * as-is or divided it by the pack size. Used to settle what the ambiguous
 * rows should do, rather than guessing at a new convention.
 *
 *   NURL=<file-with-conn-string> node scripts/learn-price-convention.mjs <sheet.csv>
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const norm = (s) =>
  s.toLowerCase().replace(/(\d)\s*(\/-|rs\b|\/)/g, "$1rs").replace(/[^a-z0-9]+/g, " ").trim();
const pricePoint = (n) => {
  const m = n.match(/(\d+(?:\.\d+)?)\s*(?:\/-|rs\b)/i);
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
  .map((c) => ({ name: (c[1] || "").trim(), per: (c[4] || "").trim(), ws: Number(c[5]) }))
  .filter((r) => r.name && r.ws > 0);

const client = new pg.Client({ connectionString: readFileSync(process.env.NURL, "utf8").trim() });
await client.connect();
const db = (await client.query('select name, "wholesalePrice" as ws from "Product"')).rows;
await client.end();

const stored = new Map(db.map((p) => [norm(p.name), Number(p.ws)]));
const near = (a, b) => Math.abs(a - b) / Math.max(b, 0.01) < 0.02;

let asIs = 0, divided = 0, other = 0;
const examples = [];
for (const r of rows) {
  if (pricePoint(r.name) === null) continue;
  const have = stored.get(norm(r.name));
  if (have === undefined) continue;
  const n = Number(r.per);
  if (near(have, r.ws)) asIs++;
  else if (n > 1 && near(have, r.ws / n)) divided++;
  else {
    other++;
    if (examples.length < 8) examples.push(`${r.name}  sheet=${r.ws} per=${r.per} stored=${have}`);
  }
}

console.log("Sheet rows with a price point that are already in the catalogue:");
console.log("  stored the sheet value AS-IS :", asIs);
console.log("  stored sheet / perPack       :", divided);
console.log("  something else               :", other);
examples.forEach((e) => console.log("     ", e));
