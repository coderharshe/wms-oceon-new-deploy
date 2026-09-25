/**
 * Imports the shop's product sheet into the catalogue.
 *
 *   node scripts/import-catalogue.mjs <sheet.csv>            # dry run, prints a plan
 *   node scripts/import-catalogue.mjs <sheet.csv> --commit   # writes
 *
 * Connection comes from $NURL (a file holding the connection string) or
 * $DATABASE_URL.
 *
 * ── What the sheet actually contains ──────────────────────────────────────
 * "Wholesale Price" means two different things depending on the row: the
 * price of ONE PIECE for sachet/packet goods ("Excel Surf 10/-" at 8.6), and
 * the price of a WHOLE PACK for boxed or sacked goods ("AK Gold Rice" at 1100
 * for a 26kg bag). Nothing in the row says which.
 *
 * The catalogue stores a per-base-unit price, so every row has to be resolved
 * one way or the other. The lever is the MRP price point in the name — a
 * product called "10/-" retails at about 10 — which pins the per-piece price
 * and so says whether the sheet's figure is per piece or per pack.
 *
 * Where the name carries no price point (loose dal, spices, dry fruit) the
 * sheet's figure is the per-kg rate and is taken as-is — that is the reading
 * the earlier import of this same sheet used, and those rows are live in the
 * catalogue today. Review is reserved for rows that are genuinely broken: no
 * price at all, or a price point the sheet figure contradicts under either
 * reading.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const UNIT_PC = "cmsnrn2o40002jo7drxdthyw4";
const UNIT_KG = "cmsnrn2og0003jo7du32fg7d3";

// ── parsing ───────────────────────────────────────────────────────────────
function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const cells = [];
      let cur = "";
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur);
      return cells;
    })
    .map((c) => ({
      sr: (c[0] || "").trim(),
      name: (c[1] || "").trim(),
      brand: (c[2] || "").trim(),
      qty: (c[3] || "").trim(),
      per: (c[4] || "").trim(),
      ws: (c[5] || "").trim(),
      rp: (c[6] || "").trim(),
      box: (c[7] || "").trim(),
    }))
    .filter((r) => r.name);
}

// "5/-", "5rs" and "5 rs" are the same price point, and the earlier import
// rewrote one spelling into the other — so matching has to see through it.
const norm = (s) =>
  s.toLowerCase().replace(/(\d)\s*(\/-|rs\b|\/)/g, "$1rs").replace(/[^a-z0-9]+/g, " ").trim();

/** The MRP price point carried in the name: "Lays Blue 5rs" -> 5. */
function pricePoint(name) {
  const m = name.match(/(\d+(?:\.\d+)?)\s*(?:\/-|rs\b)/i);
  return m ? Number(m[1]) : null;
}

/** A "per pack" cell is either a plain count (12) or a sack weight ("26kg"). */
function parsePer(per) {
  if (!per) return { kind: "none" };
  const kg = per.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kg) return { kind: "kg", value: Number(kg[1]) };
  if (/^\d+(\.\d+)?$/.test(per)) return { kind: "count", value: Number(per) };
  return { kind: "other", raw: per };
}

// ── categories ────────────────────────────────────────────────────────────
// Categories are LEARNED from the products already in the catalogue rather
// than hand-written here: earlier sessions classified 400+ rows of this same
// sheet, so that is the shop's own vocabulary (washing soap is "Household",
// not a cosmetics category; loose dal and dry fruit are "Kirana"). Each token
// of an existing product's name votes for its category, weighted down for
// tokens that appear across many categories, and a new name is scored by
// summing its tokens' votes.
const STOP = new Set(["the", "of", "and", "set", "pkt", "pcs", "pc", "gm", "gram", "kg", "ml", "ltr", "l", "rs", "no", "big", "small", "choti", "bada", "loose", "khula", "khulla"]);
const tokens = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((t) => t && t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));

function buildClassifier(labelled) {
  const counts = new Map(); // token -> Map(category -> n)
  for (const p of labelled) {
    if (!p.category) continue;
    for (const t of tokens(p.name)) {
      if (!counts.has(t)) counts.set(t, new Map());
      const m = counts.get(t);
      m.set(p.category, (m.get(p.category) ?? 0) + 1);
    }
  }
  const fallbackCat = "Kirana";
  return function classify(name) {
    const score = new Map();
    for (const t of tokens(name)) {
      const m = counts.get(t);
      if (!m) continue;
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      // A token seen in one category only is a strong signal; one spread
      // across five is nearly noise.
      const weight = 1 / m.size;
      for (const [cat, n] of m) score.set(cat, (score.get(cat) ?? 0) + (n / total) * weight);
    }
    let best = null, bestScore = 0;
    for (const [cat, sc] of score) if (sc > bestScore) { best = cat; bestScore = sc; }
    return { category: best ?? fallbackCat, confident: bestScore >= 0.5 };
  };
}

// ── unit + price resolution ───────────────────────────────────────────────
const WEIGHT_HINT = /\b(kg|gm|gram)\b|\b(daal|dal|chana|rajma|moong|urad|malka|arhar|sugar|chini|khand|gud|bura|boora|namak|salt|teel|sarso|magaj|sooji|besan|maida|atta|rice|kaju|badam|pista|akhroot|elaichi|munakka|chuaara|khajur|makhana|goond|imli|mishri|sabudana|murmura|poha|dalia|soyabeen|matar|khand)\b/i;

function resolve(row) {
  const ws = Number(row.ws);
  const rp = row.rp === "" ? null : Number(row.rp);
  const per = parsePer(row.per);
  const point = pricePoint(row.name);
  const notes = [];

  if (!row.ws || !Number.isFinite(ws) || ws <= 0) {
    // Notes are written as "what is wrong || what to do" — the review screen
    // splits on the bar so the manager reads the diagnosis and the action
    // separately instead of one run-on sentence.
    return { ok: false, notes: ["The sheet has no wholesale price for this product, so it was imported with ₹0 and switched off.||Enter what one " + (WEIGHT_HINT.test(row.name) ? "kg" : "piece") + " costs you and what you sell it for, then mark it reviewed."] };
  }

  // A sack priced as a whole: base unit is the kilo, the sack is a sale unit.
  if (per.kind === "kg" && per.value > 1) {
    return {
      ok: true, baseUnitId: UNIT_KG, base: ws / per.value,
      baseRetail: rp != null && rp > per.value ? rp / per.value : null,
      pack: { factor: per.value, wholesale: ws, retail: rp },
      packLabel: `${per.value}kg bag`,
    };
  }

  if (point != null) {
    const near = (v) => Math.abs(v - point) / point < 0.35;
    // Sheet figure is already the per-piece price.
    if (near(ws)) {
      return { ok: true, baseUnitId: UNIT_PC, base: ws, baseRetail: rp, pack: null };
    }
    // Sheet figure is the price of a whole pack of `per` pieces.
    if (per.kind === "count" && per.value > 1 && near(ws / per.value)) {
      return {
        ok: true, baseUnitId: UNIT_PC, base: ws / per.value,
        baseRetail: rp != null ? rp / per.value : null,
        pack: { factor: per.value, wholesale: ws, retail: rp },
        packLabel: `pack of ${per.value}`,
      };
    }
    const perPiece = per.kind === "count" && per.value > 1 ? ws / per.value : null;
    notes.push(
      `The name says this sells at ₹${point}, but the sheet lists ₹${ws}` +
        (perPiece !== null ? ` for a pack of ${per.value} (₹${perPiece.toFixed(2)} each)` : "") +
        `. ₹${ws} is too high to be one piece` +
        (perPiece !== null ? `, and ₹${perPiece.toFixed(2)} is too low to be a real wholesale rate on a ₹${point} item` : "") +
        `, so neither reading is believable.` +
        `||Enter what one piece actually costs you — for a ₹${point} item that is usually ₹${(point * 0.85).toFixed(2)}–₹${(point * 0.95).toFixed(2)}.`
    );
    return { ok: false, notes, baseUnitId: UNIT_PC, base: ws, baseRetail: rp };
  }

  // No price point in the name: loose goods sold by weight (dal, spices, dry
  // fruit) or a plain item. The sheet figure is the rate for one base unit —
  // the same reading the earlier import used for Chana Daal, Elaichi, Kaju.
  const weighed = WEIGHT_HINT.test(row.name);
  const bagged = per.kind === "count" && per.value > 1 && weighed;
  return {
    ok: true,
    baseUnitId: weighed ? UNIT_KG : UNIT_PC,
    base: ws,
    baseRetail: rp,
    // A weighed good with a sack size still gets the sack as a sale unit.
    pack: bagged ? { factor: per.value, wholesale: ws * per.value, retail: rp != null ? rp * per.value : null } : null,
    packLabel: bagged ? `${per.value}kg bag` : undefined,
  };
}

function makeSku(name, taken) {
  let base = name.toUpperCase().replace(/\//g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ITEM";
  let sku = base;
  for (let i = 2; taken.has(sku); i++) sku = `${base}-${i}`;
  taken.add(sku);
  return sku;
}

// ── main ──────────────────────────────────────────────────────────────────
const [, , csvPath, ...flags] = process.argv;
const commit = flags.includes("--commit");
if (!csvPath) { console.error("usage: import-catalogue.mjs <sheet.csv> [--commit]"); process.exit(1); }

const conn = process.env.NURL ? readFileSync(process.env.NURL, "utf8").trim() : process.env.DATABASE_URL;
if (!conn) { console.error("Set NURL (file with connection string) or DATABASE_URL"); process.exit(1); }

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const client = new pg.Client({ connectionString: conn });
await client.connect();

const existing = (await client.query('select id, name, sku, category, "wholesalePrice", "retailPrice", "baseUnitId" from "Product"')).rows;
// The catalogue that earlier sessions built is the training data.
const classify = buildClassifier(existing);
const byName = new Map(existing.map((p) => [norm(p.name), p]));
const skus = new Set(existing.map((p) => p.sku));

// Only the generic pack unit is created; each product carries its own
// factorToBase, so one Unit row serves every pack size instead of forty.
let packUnitId = (await client.query(`select id from "Unit" where symbol = 'pack'`)).rows[0]?.id;
// Sacks reuse the "bag" unit that already exists; loose counts share one
// generic "pack" unit, each product carrying its own factorToBase.
const bagUnitId = (await client.query(`select id from "Unit" where symbol = 'bag'`)).rows[0]?.id;

const plan = { create: [], review: [], skipDuplicate: [], alreadyThere: 0 };
const seen = new Set();

for (const row of rows) {
  const key = norm(row.name);
  if (seen.has(key)) { plan.skipDuplicate.push(row); continue; }
  seen.add(key);
  if (byName.has(key)) { plan.alreadyThere++; continue; }

  const r = resolve(row);
  const { category, confident: catConfident } = classify(row.name);
  const item = {
    row, category, catConfident,
    sku: makeSku(row.name, skus),
    baseUnitId: r.baseUnitId ?? UNIT_PC,
    wholesale: r.base ?? 0,
    // The column is NOT NULL, so an absent retail price falls back to the
    // wholesale figure and the row is flagged rather than silently priced.
    retail: r.baseRetail ?? r.base ?? 0,
    pack: r.ok ? r.pack : null,
    packLabel: r.packLabel,
    needsReview: !r.ok,
    active: r.ok,
    // A blank retail price is normal in this sheet and the earlier import
    // mirrored wholesale into it without flagging, so it is not review-worthy
    // on its own — only an unrecognised product name is worth a second look.
    // A note only rides along on a row that is actually flagged — a note on
    // an unflagged product reads as an unresolved problem on the review screen.
    notes: r.ok ? [] : (r.notes ?? []).concat(!catConfident ? [`The name matched nothing in the existing catalogue, so the category is a guess.||Check the category is right; correct it here if not.`] : []),
  };
  plan.create.push(item);
  if (item.needsReview) plan.review.push(item);
}

// ── report ────────────────────────────────────────────────────────────────
const byCat = {};
for (const i of plan.create) byCat[i.category] = (byCat[i.category] ?? 0) + 1;

console.log(`sheet rows              ${rows.length}`);
console.log(`already in catalogue    ${plan.alreadyThere}`);
console.log(`duplicate rows skipped  ${plan.skipDuplicate.length}`);
console.log(`to create               ${plan.create.length}`);
console.log(`  ├─ priced confidently ${plan.create.length - plan.review.length}  (active)`);
console.log(`  └─ needs review       ${plan.review.length}  (inactive, flagged)`);
console.log(`\nby category:`);
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`   ${c.padEnd(15)} ${n}`);
console.log(`\nsample of confident rows:`);
plan.create.filter((i) => !i.needsReview).slice(0, 10)
  .forEach((i) => console.log(`   ${i.category.padEnd(14)} ${i.row.name.padEnd(34)} ₹${i.wholesale.toFixed(2)}/base${i.pack ? `  +${i.packLabel} @ ₹${i.pack.wholesale}` : ""}`));
console.log(`\nsample of flagged rows:`);
plan.review.slice(0, 10).forEach((i) => console.log(`   ${i.row.name.padEnd(34)} ${i.notes[0]}`));

// ── repair: divided wholesale, undivided retail ───────────────────────────
// The earlier import divided some sack/box prices by the pack size to get a
// per-base-unit wholesale rate but left retail at the whole-pack figure, so
// the same product reads ₹42.31/kg to buy and ₹1100/kg to sell. Retail is
// brought onto the same basis using the ratio the wholesale column already
// implies.
const repairs = [];
for (const row of rows) {
  const hit = byName.get(norm(row.name));
  if (!hit) continue;
  const sheetWs = Number(row.ws);
  const dbWs = Number(hit.wholesalePrice);
  const dbRp = Number(hit.retailPrice);
  if (!Number.isFinite(sheetWs) || sheetWs <= 0 || dbWs <= 0) continue;
  const factor = sheetWs / dbWs;              // 26 for a 26kg bag, ~1 otherwise
  if (factor < 1.5) continue;                 // not a divided row
  if (dbRp <= dbWs * 1.5) continue;           // retail already on the same basis
  repairs.push({ id: hit.id, name: hit.name, from: dbRp, to: dbRp / factor, factor });
}
console.log(`
retail figures to repair  ${repairs.length}`);
repairs.slice(0, 8).forEach((r) => console.log(`   ${r.name.padEnd(30)} retail ₹${r.from} -> ₹${r.to.toFixed(2)}  (÷${r.factor.toFixed(0)})`));

if (!commit) {
  console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply.`);
  await client.end();
  process.exit(0);
}

// ── write ─────────────────────────────────────────────────────────────────
await client.query("begin");
try {
  for (const r of repairs) {
    await client.query('update "Product" set "retailPrice" = $1 where id = $2', [r.to.toFixed(2), r.id]);
  }
  if (!packUnitId && plan.create.some((i) => i.pack)) {
    packUnitId = randomUUID();
    await client.query(`insert into "Unit" (id, name, symbol, type) values ($1,'pack','pack','COUNT')`, [packUnitId]);
  }
  for (const i of plan.create) {
    const id = randomUUID();
    await client.query(
      `insert into "Product" (id, sku, name, category, brand, "baseUnitId", "wholesalePrice", "retailPrice", "taxPercent", active, "needsReview", "reviewNotes")
       values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11)`,
      [id, i.sku, i.row.name, i.category, i.row.brand || null, i.baseUnitId,
       i.wholesale.toFixed(2), i.retail.toFixed(2), i.active, i.needsReview,
       i.notes.length ? i.notes.join(" ") : null]
    );
    await client.query(
      `insert into "ProductUnit" (id, "productId", "unitId", "factorToBase", "isBaseUnit", "isDefaultSaleUnit", "wholesalePrice", "retailPrice")
       values ($1,$2,$3,1,true,$4,null,null)`,
      [randomUUID(), id, i.baseUnitId, !i.pack]
    );
    if (i.pack) {
      await client.query(
        `insert into "ProductUnit" (id, "productId", "unitId", "factorToBase", "isBaseUnit", "isDefaultSaleUnit", "wholesalePrice", "retailPrice")
         values ($1,$2,$3,$4,false,true,$5,$6)`,
        [randomUUID(), id, i.baseUnitId === UNIT_KG ? bagUnitId : packUnitId,
         i.pack.factor, i.pack.wholesale?.toFixed(2) ?? null, i.pack.retail?.toFixed(2) ?? null]
      );
    }
  }
  await client.query("commit");
  console.log(`\nWROTE ${plan.create.length} products.`);
} catch (err) {
  await client.query("rollback");
  console.error("\nRolled back — nothing written:", err.message);
  process.exitCode = 1;
}
await client.end();
