/**
 * Wipes the trading data and loads a fresh product catalogue.
 *
 * Everything runs inside ONE transaction: if any row fails to import, the
 * delete rolls back too, so a bad run leaves the database exactly as it was
 * rather than empty.
 *
 *   node scripts/import-catalog.mjs <catalog.json> [--commit]
 *
 * Without --commit it does a full dry run inside the transaction and rolls
 * back, printing the same summary. Always dry-run first.
 *
 * Catalog shape (one object per product):
 *   { sku, name, brand, category, baseUnit: "pc"|"kg",
 *     wholesalePrice, retailPrice, taxPercent,   // price is per BASE unit
 *     openingStock,                              // in base units
 *     active, needsReview, reviewNotes,
 *     units: [{ symbol, factor, isBase, isDefault }, ...] }
 */
import pg from "pg";
import fs from "node:fs";
import crypto from "node:crypto";

const [, , jsonPath, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!jsonPath) {
  console.error("usage: node scripts/import-catalog.mjs <catalog.json> [--commit]");
  process.exit(1);
}
const items = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

// Deleted newest-dependency-first so no FK is ever left dangling. Warehouse,
// User, Unit and Counter are deliberately absent — those survive the reset.
//
// Product cannot be deleted on its own: OrderItem, BillItem, Inventory,
// InventoryMovement, StockReservation, QcAdjustment and PurchaseBillItem all
// reference it, so replacing the catalogue necessarily takes the trading
// history with it. That is what the pre-flight count below is for.
const WIPE_ORDER = [
  "Notification", "AuditLog",
  "QcAdjustment", "QcRestrictionRule", "QcSession",
  "PaymentAdjustment", "PaymentTransaction", "Payment",
  "BillItem", "BillVersion", "Bill",
  "StockReservation", "OrderItem", "Order",
  "InventoryMovement", "Inventory",
  "PurchaseBillItem", "PurchaseBill", "Supplier",
  "CashTransaction", "CashSession", "BankBalance",
  "IdempotencyKey",
  "ProductUnit", "Product",
  "Customer",
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");

  const [{ id: warehouseId } = {}] = (await client.query(`SELECT id FROM "Warehouse" ORDER BY "id" LIMIT 1`)).rows;
  const [{ id: userId } = {}] = (await client.query(`SELECT id FROM "User" WHERE role = 'ADMIN' ORDER BY "id" LIMIT 1`)).rows;
  if (!warehouseId) throw new Error("no Warehouse row — refusing to import");
  if (!userId) throw new Error("no ADMIN User row — refusing to import (opening stock needs an author)");

  const unitBySymbol = new Map(
    (await client.query(`SELECT id, symbol FROM "Unit"`)).rows.map((u) => [u.symbol, u.id])
  );
  const needed = [...new Set(items.flatMap((i) => [i.baseUnit, ...i.units.map((u) => u.symbol)]))];
  const missing = needed.filter((s) => !unitBySymbol.has(s));
  if (missing.length) throw new Error(`missing Unit rows: ${missing.join(", ")} — run the migration first`);

  console.log("── about to delete ──");
  for (const t of WIPE_ORDER) {
    const n = (await client.query(`SELECT COUNT(*)::int n FROM "${t}"`)).rows[0].n;
    if (n) console.log(String(n).padStart(7), t);
  }

  console.log("\n── wiping ──");
  for (const t of WIPE_ORDER) {
    const r = await client.query(`DELETE FROM "${t}"`);
    if (r.rowCount) console.log(String(r.rowCount).padStart(7), t);
  }

  console.log("\n── importing ──");
  // Multi-row inserts, not one statement per product: at ~100ms round trip to
  // the Neon region this is the difference between ~30 round trips and 5082
  // (which timed out at 20 minutes holding locks on every table).
  const CHUNK = 200;
  const rows = items.map((it) => ({ ...it, productId: crypto.randomUUID() }));

  // Internal barcodes share the sequence behind /api/admin/products/barcode
  // (Counter key "unit-barcode:YYYYMMDD"), so a code generated in the UI
  // tomorrow can never collide with one issued here. Format matches
  // nextNumber exactly — plain text, printed as Code128.
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let seq = 0;
  const nextBarcode = () => `WMS-${datePart}-${String(++seq).padStart(4, "0")}`;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    await client.query(
      `INSERT INTO "Product"
         (id, sku, name, brand, category, "baseUnitId", "wholesalePrice", "retailPrice",
          "taxPercent", active, "createdAt", "needsReview", "reviewNotes")
       VALUES ${chunk
         .map((_, k) => {
           const b = k * 12;
           return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},now(),$${b + 11},$${b + 12})`;
         })
         .join(",")}`,
      chunk.flatMap((r) => [
        r.productId, r.sku, r.name, r.brand || null, r.category || null,
        unitBySymbol.get(r.baseUnit), r.wholesalePrice, r.retailPrice,
        r.taxPercent, r.active !== false, r.needsReview === true, r.reviewNotes || null,
      ])
    );

    // Every product needs its base unit as a sellable unit or it can't be
    // added to an order at all (assertValidUnit rejects it). The extra units
    // are the peti / bag / gram the same goods also move in.
    const unitRows = chunk.flatMap((r) =>
      r.units.map((u) => ({
        productId: r.productId,
        unitId: unitBySymbol.get(u.symbol),
        factor: u.factor,
        isBase: !!u.isBase,
        isDefault: !!u.isDefault,
        // Null unless the rate was quoted for this unit whole (a peti at
        // Rs 680); pricing derives from the base price otherwise.
        ws: u.wholesalePrice ?? null,
        rt: u.retailPrice ?? null,
        // Nothing in the sheet carries a manufacturer code, so every unit gets
        // an internal one — scanning the peti label bills a peti, not a piece.
        barcode: nextBarcode(),
      }))
    );
    await client.query(
      `INSERT INTO "ProductUnit"
         (id, "productId", "unitId", "factorToBase", "isBaseUnit", "isDefaultSaleUnit",
          "wholesalePrice", "retailPrice", barcode, "barcodeGenerated")
       VALUES ${unitRows
         .map((_, k) => {
           const b = k * 9;
           return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},true)`;
         })
         .join(",")}`,
      unitRows.flatMap((u) => [crypto.randomUUID(), u.productId, u.unitId, u.factor, u.isBase, u.isDefault, u.ws, u.rt, u.barcode])
    );

    await client.query(
      `INSERT INTO "Inventory" (id, "productId", "warehouseId", "quantityOnHand", "quantityReserved")
       VALUES ${chunk
         .map((_, k) => {
           const b = k * 4;
           return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},0)`;
         })
         .join(",")}`,
      chunk.flatMap((r) => [crypto.randomUUID(), r.productId, warehouseId, r.openingStock ?? 0])
    );

    // Opening stock lands as a movement too, so the ledger explains where the
    // quantity came from instead of it appearing from nowhere.
    const withStock = chunk.filter((r) => Number(r.openingStock) > 0);
    if (withStock.length) {
      await client.query(
        `INSERT INTO "InventoryMovement"
           (id, "productId", "warehouseId", "beforeQty", "movementQty", "afterQty",
            "movementType", "referenceType", "userId", timestamp)
         VALUES ${withStock
           .map((_, k) => {
             const b = k * 6;
             return `($${b + 1},$${b + 2},$${b + 3},0,$${b + 4},$${b + 5},'STOCK_COUNT_ADJUSTMENT','CATALOG_IMPORT',$${b + 6},now())`;
           })
           .join(",")}`,
        withStock.flatMap((r) => [crypto.randomUUID(), r.productId, warehouseId, r.openingStock, r.openingStock, userId])
      );
    }

    console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  // Move the shared barcode sequence past everything issued above.
  await client.query(
    `INSERT INTO "Counter" (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = GREATEST("Counter".value, $2)`,
    [`unit-barcode:${datePart}`, seq]
  );

  const s = (
    await client.query(`
      SELECT (SELECT COUNT(*)::int FROM "Product")                          AS products,
             (SELECT COUNT(*)::int FROM "Product" WHERE NOT active)         AS inactive,
             (SELECT COUNT(*)::int FROM "Product" WHERE "needsReview")      AS review,
             (SELECT COUNT(*)::int FROM "ProductUnit")                      AS units,
             (SELECT COUNT(*)::int FROM "ProductUnit" WHERE "isDefaultSaleUnit") AS defaults,
             (SELECT COUNT(*)::int FROM "Inventory" WHERE "quantityOnHand" > 0)  AS stocked
    `)
  ).rows[0];
  console.log(
    `\nproducts ${s.products}  (inactive ${s.inactive}, needs review ${s.review})` +
    `\nsale units ${s.units}  (default flags ${s.defaults})` +
    `\ninventory rows with stock ${s.stocked}`
  );
  if (s.products !== items.length) throw new Error(`expected ${items.length} products, got ${s.products}`);
  if (s.defaults !== s.products) throw new Error(`every product needs exactly one default sale unit — got ${s.defaults} for ${s.products}`);

  if (COMMIT) {
    await client.query("COMMIT");
    console.log("COMMITTED");
  } else {
    await client.query("ROLLBACK");
    console.log("DRY RUN — rolled back, nothing changed. Re-run with --commit to apply.");
  }
} catch (e) {
  await client.query("ROLLBACK");
  console.error("\nFAILED — rolled back, database unchanged:\n", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
