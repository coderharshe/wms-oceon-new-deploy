/**
 * DB-backed check for reserveStockBatchDrizzle — the batched stock reservation
 * behind "Generate Bill". Covers the three things the old per-line loop got
 * right that a batch can easily get wrong: aggregating a product that appears
 * on two lines, rolling back cleanly when a line can't be covered, and not
 * deadlocking when two tills bill the same products in opposite order.
 *
 * Run against the local Docker Postgres:
 *   DATABASE_URL="postgresql://wms:wms@localhost:5432/wms" npx tsx scripts/test-reserve-batch.ts
 */
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/library";
import { eq, and } from "drizzle-orm";
import { getDrizzleDb } from "../src/lib/drizzle-db";
import { reserveStockBatchDrizzle, InsufficientStockError } from "../src/lib/drizzle-inventory";
import { inventory, product, warehouse, customer, user, order, stockReservation } from "../src/generated/drizzle/schema";

const db = getDrizzleDb();
const rid = () => crypto.randomUUID();
let passed = 0;
const check = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log(`ok - ${name}`); };

const [wh] = await db.select().from(warehouse).limit(1);
const [cust] = await db.select().from(customer).limit(1);
const [fin] = await db.select().from(user).limit(1);
const products = await db.select().from(product).where(eq(product.active, true)).limit(2);
assert.ok(wh && cust && fin && products.length === 2, "needs seeded data — run db:seed first");
const [A, B] = products as [typeof products[0], typeof products[0]];

const orderIds: string[] = [];
async function makeOrder() {
  const id = rid();
  await db.insert(order).values({
    id, orderNumber: `TEST-${id.slice(0, 8)}`, warehouseId: wh!.id, customerId: cust!.id,
    financeUserId: fin!.id, sellingMode: "RETAIL", status: "DRAFT", updatedAt: new Date().toISOString(),
  });
  orderIds.push(id);
  return id;
}
async function setStock(productId: string, onHand: string, reserved: string) {
  await db.insert(inventory).values({ id: rid(), productId, warehouseId: wh!.id, quantityOnHand: onHand, quantityReserved: reserved })
    .onConflictDoUpdate({ target: [inventory.productId, inventory.warehouseId], set: { quantityOnHand: onHand, quantityReserved: reserved } });
}
async function reservedOf(productId: string) {
  const [row] = await db.select().from(inventory).where(and(eq(inventory.productId, productId), eq(inventory.warehouseId, wh!.id)));
  return new Decimal(row!.quantityReserved);
}

await setStock(A.id, "100", "0");
await setStock(B.id, "100", "0");

await check("same product on two lines is aggregated, not overwritten", async () => {
  const orderId = await makeOrder();
  await db.transaction(async (tx) => {
    await reserveStockBatchDrizzle(tx, { warehouseId: wh!.id, orderId, userId: fin!.id, lines: [
      { productId: A.id, baseQty: new Decimal(3) },
      { productId: A.id, baseQty: new Decimal(2) },   // same product again
      { productId: B.id, baseQty: new Decimal(5) },
    ]});
  });
  assert.equal((await reservedOf(A.id)).toString(), "5", "3 + 2 must both be reserved");
  assert.equal((await reservedOf(B.id)).toString(), "5");
  const res = await db.select().from(stockReservation).where(eq(stockReservation.orderId, orderId));
  assert.equal(res.length, 2, "one reservation row per distinct product");
});

await check("insufficient stock throws and rolls the whole reservation back", async () => {
  const orderId = await makeOrder();
  await assert.rejects(
    db.transaction(async (tx) => {
      await reserveStockBatchDrizzle(tx, { warehouseId: wh!.id, orderId, userId: fin!.id, lines: [
        { productId: A.id, baseQty: new Decimal(1) },
        { productId: B.id, baseQty: new Decimal(9999) },  // cannot be covered
      ]});
    }),
    (e: unknown) => e instanceof InsufficientStockError
  );
  assert.equal((await reservedOf(A.id)).toString(), "5", "A must be untouched after rollback");
  assert.equal((await reservedOf(B.id)).toString(), "5");
});

await check("two tills billing the same products in opposite order do not deadlock", async () => {
  await setStock(A.id, "100", "0");
  await setStock(B.id, "100", "0");
  const [o1, o2] = [await makeOrder(), await makeOrder()];
  await Promise.all([
    db.transaction(async (tx) => {
      await reserveStockBatchDrizzle(tx, { warehouseId: wh!.id, orderId: o1, userId: fin!.id, lines: [
        { productId: A.id, baseQty: new Decimal(10) }, { productId: B.id, baseQty: new Decimal(10) }]});
    }),
    db.transaction(async (tx) => {
      await reserveStockBatchDrizzle(tx, { warehouseId: wh!.id, orderId: o2, userId: fin!.id, lines: [
        { productId: B.id, baseQty: new Decimal(7) }, { productId: A.id, baseQty: new Decimal(7) }]});  // reverse order
    }),
  ]);
  assert.equal((await reservedOf(A.id)).toString(), "17", "both tills' reservations must land");
  assert.equal((await reservedOf(B.id)).toString(), "17");
});

// cleanup
for (const id of orderIds) {
  await db.delete(stockReservation).where(eq(stockReservation.orderId, id));
  await db.delete(order).where(eq(order.id, id));
}
await setStock(A.id, "100", "0");
await setStock(B.id, "100", "0");
console.log(`\n${passed} passed`);
process.exit(0);
