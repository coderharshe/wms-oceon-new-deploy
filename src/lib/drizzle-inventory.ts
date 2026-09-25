import { Decimal } from "@prisma/client/runtime/library";
import { sql, eq, and } from "drizzle-orm";
import { inventory, inventoryMovement, stockReservation } from "@/generated/drizzle/schema";
import type { getDrizzleDb } from "./drizzle-db";
import type { Shortfall } from "./inventory";

type Tx = import("./drizzle-db").DrizzleDbOrTx;

/** Drizzle equivalent of src/lib/inventory.ts — same SELECT...FOR UPDATE row-lock pattern. */
async function lockInventoryRow(tx: Tx, productId: string, warehouseId: string) {
  await tx
    .insert(inventory)
    .values({ id: crypto.randomUUID(), productId, warehouseId, quantityOnHand: "0", quantityReserved: "0" })
    .onConflictDoNothing({ target: [inventory.productId, inventory.warehouseId] });

  const result = await tx.execute(sql`
    SELECT id, "quantityOnHand", "quantityReserved" FROM "Inventory"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} FOR UPDATE
  `);
  const rows = (result as unknown as { rows?: any[] }).rows ?? (result as unknown as any[]);
  const row = rows[0]!;
  return { id: row.id as string, quantityOnHand: new Decimal(row.quantityOnHand), quantityReserved: new Decimal(row.quantityReserved) };
}

async function recordMovement(
  tx: Tx,
  args: {
    productId: string;
    warehouseId: string;
    before: Decimal;
    after: Decimal;
    movementType: string;
    referenceType: string;
    referenceId: string;
    userId: string;
  }
) {
  await tx.insert(inventoryMovement).values({
    id: crypto.randomUUID(),
    productId: args.productId,
    warehouseId: args.warehouseId,
    beforeQty: args.before.toString(),
    movementQty: args.after.sub(args.before).toString(),
    afterQty: args.after.toString(),
    movementType: args.movementType as any,
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    userId: args.userId,
  });
}

/**
 * Reserves stock for every line of an order in 3 round trips instead of 4 per
 * line — the whole point, since each round trip is a full trans-Pacific hop to
 * Neon and a 12-line bill was spending 48 of them here.
 *
 * Two correctness details this has to get right that the old per-line loop got
 * right only by re-reading the row each time:
 *  - the same product can appear on two lines, so quantities are aggregated
 *    per product before anything is locked or written;
 *  - the lock is taken with ORDER BY "productId", giving every concurrent
 *    biller the same lock order. The old loop locked in cashier-entry order,
 *    so two tills billing the same two products in opposite order could
 *    deadlock each other.
 *
 * Never refuses — see reserveStockBatch in src/lib/inventory.ts. Shortfalls
 * come back for the caller to record on the order.
 */
export async function reserveStockBatchDrizzle(
  tx: Tx,
  args: { warehouseId: string; orderId: string; userId: string; lines: { productId: string; baseQty: Decimal }[] }
) {
  const needed = new Map<string, Decimal>();
  for (const l of args.lines) needed.set(l.productId, (needed.get(l.productId) ?? new Decimal(0)).add(l.baseQty));
  const productIds = [...needed.keys()].sort();
  const short: Shortfall[] = [];
  if (productIds.length === 0) return short;

  // 1 — guarantee a row exists for each product (one statement for all of them).
  await tx
    .insert(inventory)
    .values(
      productIds.map((productId) => ({
        id: crypto.randomUUID(),
        productId,
        warehouseId: args.warehouseId,
        quantityOnHand: "0",
        quantityReserved: "0",
      }))
    )
    .onConflictDoNothing({ target: [inventory.productId, inventory.warehouseId] });

  // 2 — lock them all at once, in a deterministic order.
  const locked = await tx.execute(sql`
    SELECT id, "productId", "quantityOnHand", "quantityReserved" FROM "Inventory"
    WHERE "warehouseId" = ${args.warehouseId}
      AND "productId" IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY "productId"
    FOR UPDATE
  `);
  const rows = ((locked as unknown as { rows?: any[] }).rows ?? (locked as unknown as any[])) as {
    id: string;
    productId: string;
    quantityOnHand: string;
    quantityReserved: string;
  }[];
  const updates: { id: string; reserved: Decimal }[] = [];
  for (const row of rows) {
    const want = needed.get(row.productId)!;
    const available = new Decimal(row.quantityOnHand).sub(row.quantityReserved);
    if (available.lt(want)) short.push({ productId: row.productId, available, requested: want });
    updates.push({ id: row.id, reserved: new Decimal(row.quantityReserved).add(want) });
  }

  // 3 — write both the new reserved totals and the reservation rows.
  await tx.execute(sql`
    UPDATE "Inventory" SET "quantityReserved" = v.reserved
    FROM (VALUES ${sql.join(
      updates.map((u) => sql`(${u.id}::text, ${u.reserved.toString()}::numeric)`),
      sql`, `
    )}) AS v(id, reserved)
    WHERE "Inventory".id = v.id
  `);
  await tx.insert(stockReservation).values(
    [...needed.entries()].map(([productId, qty]) => ({
      id: crypto.randomUUID(),
      orderId: args.orderId,
      productId,
      warehouseId: args.warehouseId,
      quantity: qty.toString(),
      status: "ACTIVE" as const,
    }))
  );
  return short;
}

export async function releaseOrderReservationsDrizzle(tx: Tx, orderId: string) {
  const reservations = await tx
    .select()
    .from(stockReservation)
    .where(and(eq(stockReservation.orderId, orderId), eq(stockReservation.status, "ACTIVE")));
  for (const r of reservations) {
    const row = await lockInventoryRow(tx, r.productId, r.warehouseId);
    await tx
      .update(inventory)
      .set({ quantityReserved: Decimal.max(row.quantityReserved.sub(new Decimal(r.quantity)), 0).toString() })
      .where(eq(inventory.id, row.id));
    await tx.update(stockReservation).set({ status: "RELEASED", releasedAt: new Date().toISOString() }).where(eq(stockReservation.id, r.id));
  }
}

export async function finalizeQcDeductionDrizzle(
  tx: Tx,
  args: { productId: string; warehouseId: string; reservedBaseQty: Decimal; finalBaseQty: Decimal; referenceId: string; userId: string }
) {
  const row = await lockInventoryRow(tx, args.productId, args.warehouseId);
  const newOnHand = row.quantityOnHand.sub(args.finalBaseQty);
  const newReserved = row.quantityReserved.sub(args.reservedBaseQty);
  await tx
    .update(inventory)
    .set({ quantityOnHand: newOnHand.toString(), quantityReserved: (newReserved.lt(0) ? new Decimal(0) : newReserved).toString() })
    .where(eq(inventory.id, row.id));

  await tx
    .update(stockReservation)
    .set({ status: "CONSUMED", releasedAt: new Date().toISOString() })
    .where(and(eq(stockReservation.orderId, args.referenceId), eq(stockReservation.productId, args.productId), eq(stockReservation.warehouseId, args.warehouseId), eq(stockReservation.status, "ACTIVE")));

  await recordMovement(tx, {
    productId: args.productId,
    warehouseId: args.warehouseId,
    before: row.quantityOnHand,
    after: newOnHand,
    // The stock that leaves here is what the customer is taking home, so it is
    // a SALE. Any QC shortfall never left the shelf — it was only reserved, and
    // the reservation is released above — so there is nothing to record for it.
    movementType: "SALE",
    referenceType: "ORDER",
    referenceId: args.referenceId,
    userId: args.userId,
  });
}

/** Drizzle equivalent of adjustStock — same before/after return. */
export async function adjustStockDrizzle(
  tx: Tx,
  args: { productId: string; warehouseId: string; deltaBaseQty: Decimal; movementType: string; referenceType: string; referenceId: string; userId: string }
) {
  const row = await lockInventoryRow(tx, args.productId, args.warehouseId);
  const newOnHand = row.quantityOnHand.add(args.deltaBaseQty);
  await tx.update(inventory).set({ quantityOnHand: newOnHand.toString() }).where(eq(inventory.id, row.id));
  await recordMovement(tx, {
    productId: args.productId,
    warehouseId: args.warehouseId,
    before: row.quantityOnHand,
    after: newOnHand,
    movementType: args.movementType,
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    userId: args.userId,
  });
  return { before: row.quantityOnHand, after: newOnHand };
}
