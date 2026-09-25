import { inArray } from "drizzle-orm";
import { order, bill, billVersion, billItem, payment, paymentTransaction, inventory, inventoryMovement, customer } from "@/generated/drizzle/schema";
import type { DrizzleDbOrTx } from "./drizzle-db";

/**
 * Builds the logical backup dump (see docs comment in the admin backup
 * route: JSON export, not pg_dump — Workers can't run that). Shared by the
 * manual "Export backup" button and the daily cron trigger (worker.ts)
 * so there's one dump shape, not two copies drifting apart.
 */
export async function buildBackupDump(db: DrizzleDbOrTx) {
  const [orders, bills, billVersions, payments, paymentTransactions, inventoryRows, inventoryMovements, customers] = await Promise.all([
    db.select().from(order),
    db.select().from(bill),
    db.select().from(billVersion),
    db.select().from(payment),
    db.select().from(paymentTransaction),
    db.select().from(inventory),
    db.select().from(inventoryMovement),
    db.select().from(customer),
  ]);
  const versionIds = billVersions.map((v) => v.id);
  const items = versionIds.length ? await db.select().from(billItem).where(inArray(billItem.billVersionId, versionIds)) : [];
  const itemsByVersion = new Map<string, typeof items>();
  for (const it of items) itemsByVersion.set(it.billVersionId, [...(itemsByVersion.get(it.billVersionId) ?? []), it]);
  return {
    orders,
    bills,
    billVersions: billVersions.map((v) => ({ ...v, items: itemsByVersion.get(v.id) ?? [] })),
    payments,
    paymentTransactions,
    inventory: inventoryRows,
    inventoryMovements,
    customers,
  };
}
