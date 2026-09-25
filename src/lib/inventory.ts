import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, MovementType } from "@/generated/prisma/client";
/** A line billed for more than the shelf has. Never refused — see reserveStockBatch. */
export type Shortfall = { productId: string; available: Decimal; requested: Decimal };

type Tx = Prisma.TransactionClient;

/**
 * Locks (creating if absent) the Inventory row for a product+warehouse and
 * returns it. Uses SELECT ... FOR UPDATE so two concurrent QC/sale
 * transactions on the same SKU serialize instead of racing (PRD §37).
 */
async function lockInventoryRow(tx: Tx, productId: string, warehouseId: string) {
  await tx.inventory.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: {},
    create: { productId, warehouseId, quantityOnHand: 0, quantityReserved: 0 },
  });
  const rows = await tx.$queryRaw<
    { id: string; quantityOnHand: Decimal; quantityReserved: Decimal }[]
  >`SELECT id, "quantityOnHand", "quantityReserved" FROM "Inventory"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} FOR UPDATE`;
  return rows[0]!;
}

async function recordMovement(
  tx: Tx,
  args: {
    productId: string;
    warehouseId: string;
    before: Decimal;
    after: Decimal;
    movementType: MovementType;
    referenceType: string;
    referenceId: string;
    userId: string;
  }
) {
  await tx.inventoryMovement.create({
    data: {
      productId: args.productId,
      warehouseId: args.warehouseId,
      beforeQty: args.before,
      movementQty: args.after.sub(args.before),
      afterQty: args.after,
      movementType: args.movementType,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      userId: args.userId,
    },
  });
}

/**
 * Reserves stock for every line of an order at order-creation time (PRD §21:
 * "before QC, order quantity may be reserved but not permanently deducted").
 * Does not touch onHand.
 *
 * Never refuses: stock the shelf doesn't have is reserved anyway and the
 * shortfall is returned, so the caller can record it on the order for the
 * manager. The negative that results is the signal — the Inventory screen
 * filters for it so the product gets counted (see isNegativeStock).
 *
 * Quantities are aggregated per product first (the same SKU can appear on two
 * lines), and the rows are then locked in "productId" order so every concurrent
 * biller takes the same lock order. Locking in cashier-entry order let two
 * tills billing the same two products in opposite order deadlock each other.
 */
export async function reserveStockBatch(
  tx: Tx,
  args: { warehouseId: string; orderId: string; userId: string; lines: { productId: string; baseQty: Decimal }[] }
) {
  const needed = new Map<string, Decimal>();
  for (const l of args.lines) needed.set(l.productId, (needed.get(l.productId) ?? new Decimal(0)).add(l.baseQty));

  const short: Shortfall[] = [];
  for (const productId of [...needed.keys()].sort()) {
    const want = needed.get(productId)!;
    const row = await lockInventoryRow(tx, productId, args.warehouseId);
    const available = row.quantityOnHand.sub(row.quantityReserved);
    if (available.lt(want)) short.push({ productId, available, requested: want });
    await tx.inventory.update({
      where: { id: row.id },
      data: { quantityReserved: row.quantityReserved.add(want) },
    });
    await tx.stockReservation.create({
      data: { orderId: args.orderId, productId, warehouseId: args.warehouseId, quantity: want, status: "ACTIVE" },
    });
  }
  return short;
}

/**
 * Single-line reservation. Callers that reserve a whole order should call
 * reserveStockBatch once instead — calling this in a loop reintroduces the
 * cashier-entry lock order the batch version exists to avoid.
 */
export async function reserveStock(
  tx: Tx,
  args: { productId: string; warehouseId: string; baseQty: Decimal; orderId: string; userId: string }
) {
  await reserveStockBatch(tx, {
    warehouseId: args.warehouseId,
    orderId: args.orderId,
    userId: args.userId,
    lines: [{ productId: args.productId, baseQty: args.baseQty }],
  });
}

/** Releases all active reservations for an order without deducting stock (e.g. cancellation). */
export async function releaseOrderReservations(tx: Tx, orderId: string) {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, status: "ACTIVE" },
  });
  for (const r of reservations) {
    const row = await lockInventoryRow(tx, r.productId, r.warehouseId);
    await tx.inventory.update({
      where: { id: row.id },
      data: { quantityReserved: Decimal.max(row.quantityReserved.sub(r.quantity), 0) },
    });
    await tx.stockReservation.update({
      where: { id: r.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
  }
}

/**
 * Final QC confirmation (PRD §21 example): releases the full original
 * reservation and deducts only the actually-fulfilled quantity from onHand.
 * This is the one place stock is permanently reduced for a sale, and it is
 * recorded as a SALE movement.
 */
export async function finalizeQcDeduction(
  tx: Tx,
  args: {
    productId: string;
    warehouseId: string;
    reservedBaseQty: Decimal;
    finalBaseQty: Decimal;
    referenceId: string;
    userId: string;
  }
) {
  const row = await lockInventoryRow(tx, args.productId, args.warehouseId);
  const newOnHand = row.quantityOnHand.sub(args.finalBaseQty);
  const newReserved = row.quantityReserved.sub(args.reservedBaseQty);
  await tx.inventory.update({
    where: { id: row.id },
    data: {
      quantityOnHand: newOnHand,
      quantityReserved: newReserved.lt(0) ? new Decimal(0) : newReserved,
    },
  });
  // args.referenceId is the order id here — close out that order's own
  // reservation rows so they don't linger ACTIVE and get double-released.
  await tx.stockReservation.updateMany({
    where: { orderId: args.referenceId, productId: args.productId, warehouseId: args.warehouseId, status: "ACTIVE" },
    data: { status: "CONSUMED", releasedAt: new Date() },
  });
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

/**
 * Direct stock-in/adjustment movements (GRN, damage, manual correction, etc).
 * Returns the on-hand quantities either side of the movement — the purchase
 * route needs `before` to weight the moving-average cost.
 */
export async function adjustStock(
  tx: Tx,
  args: {
    productId: string;
    warehouseId: string;
    deltaBaseQty: Decimal; // signed
    movementType: MovementType;
    referenceType: string;
    referenceId: string;
    userId: string;
  }
) {
  const row = await lockInventoryRow(tx, args.productId, args.warehouseId);
  const newOnHand = row.quantityOnHand.add(args.deltaBaseQty);
  await tx.inventory.update({ where: { id: row.id }, data: { quantityOnHand: newOnHand } });
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
