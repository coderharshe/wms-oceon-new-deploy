/**
 * Post-import checks for the product catalogue. Read-only.
 *
 *   node scripts/verify-catalog.mjs
 *
 * Run after import-catalog.mjs: the importer asserts its own row counts, this
 * asserts the shape those rows have to hold (one default unit each, a base
 * unit that matches Product.baseUnitId, no active product priced at zero) and
 * prints what a bill would actually charge for a few known products.
 */
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;

console.log("── by category ──");
for (const r of await q(`SELECT category, COUNT(*)::int n, COUNT(*) FILTER (WHERE "needsReview")::int rev,
                                COUNT(*) FILTER (WHERE NOT active)::int off
                         FROM "Product" GROUP BY category ORDER BY n DESC`))
  console.log(String(r.n).padStart(5), String(r.rev).padStart(5), String(r.off).padStart(5), " ", r.category);

console.log("\n── default sale unit ──");
for (const r of await q(`SELECT u.symbol, COUNT(*)::int n FROM "ProductUnit" pu
                         JOIN "Unit" u ON u.id = pu."unitId"
                         WHERE pu."isDefaultSaleUnit" GROUP BY u.symbol ORDER BY n DESC`))
  console.log(String(r.n).padStart(5), r.symbol);

console.log("\n── integrity ──");
const checks = [
  ["products without exactly one default unit",
   `SELECT COUNT(*)::int n FROM (SELECT "productId" FROM "ProductUnit" GROUP BY "productId" HAVING COUNT(*) FILTER (WHERE "isDefaultSaleUnit") <> 1) x`],
  ["products without a base unit",
   `SELECT COUNT(*)::int n FROM (SELECT "productId" FROM "ProductUnit" GROUP BY "productId" HAVING COUNT(*) FILTER (WHERE "isBaseUnit") <> 1) x`],
  ["base unit not matching Product.baseUnitId",
   `SELECT COUNT(*)::int n FROM "ProductUnit" pu JOIN "Product" p ON p.id=pu."productId" WHERE pu."isBaseUnit" AND pu."unitId" <> p."baseUnitId"`],
  ["products with no Inventory row", `SELECT COUNT(*)::int n FROM "Product" p LEFT JOIN "Inventory" i ON i."productId"=p.id WHERE i.id IS NULL`],
  ["active products priced at zero", `SELECT COUNT(*)::int n FROM "Product" WHERE active AND "wholesalePrice" <= 0`],
  ["duplicate barcodes", `SELECT COUNT(*)::int n FROM (SELECT barcode FROM "ProductUnit" WHERE barcode IS NOT NULL GROUP BY barcode HAVING COUNT(*)>1) x`],
  ["negative stock", `SELECT COUNT(*)::int n FROM "Inventory" WHERE "quantityOnHand" < 0`],
];
for (const [label, sql] of checks) {
  const n = (await q(sql))[0].n;
  console.log(`${n === 0 ? "ok  " : "FAIL"}  ${String(n).padStart(5)}  ${label}`);
}

console.log("\n── spot checks (what a bill would charge) ──");
for (const name of ["Frooti 600ml", "Dew 2L", "Bisleri 200ml", "Chakarpani", "AK Gold Rice", "Arhar Dal 1no", "Melody Pouch 50rs", "Gold Flake"]) {
  const [p] = await q(`SELECT id, name, category, "wholesalePrice" ws, active FROM "Product" WHERE name = $1`, [name]);
  if (!p) { console.log(`  ${name}: NOT FOUND`); continue; }
  const [inv] = await q(`SELECT "quantityOnHand" q FROM "Inventory" WHERE "productId"=$1`, [p.id]);
  const units = await q(`SELECT u.symbol, pu."factorToBase" f, pu."isDefaultSaleUnit" d, pu."wholesalePrice" ws
                         FROM "ProductUnit" pu JOIN "Unit" u ON u.id=pu."unitId" WHERE pu."productId"=$1
                         ORDER BY pu."isBaseUnit" DESC`, [p.id]);
  const priced = units.map((u) => {
    const rate = u.ws !== null ? Number(u.ws) : Number(p.ws) * Number(u.f);
    return `${u.symbol}(${Number(u.f)})=Rs ${rate.toFixed(2)}${u.d ? " <-default" : ""}`;
  });
  console.log(`  ${p.name.padEnd(20)} stock ${String(Number(inv.q)).padStart(8)}  ${priced.join("  ")}`);
}
await c.end();
