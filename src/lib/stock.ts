/**
 * Low-stock classification. `minStock` null means the product opted out of
 * stock warnings entirely (most of the catalogue), so it is never flagged.
 *
 * "near" exists because `onHand <= minStock` only fires once the buffer is
 * already gone — by then reordering is late. 20% above the minimum is the
 * warning band.
 */
export const NEAR_MIN_FACTOR = 1.2;

export type StockLevel = "ok" | "near" | "low";

export function stockLevel(onHand: number, minStock: number | null | undefined): StockLevel {
  if (minStock == null) return "ok";
  if (onHand <= minStock) return "low";
  if (onHand <= minStock * NEAR_MIN_FACTOR) return "near";
  return "ok";
}

/**
 * Stock that has gone below zero. Never a "low stock" reorder signal — it is
 * a books-vs-shelf mismatch (a sale billed against stock that was never
 * received, a correction that landed after the sale) and needs a count, not
 * a purchase order, which is why the Inventory screen filters it separately.
 *
 * Available is checked as well as on-hand: reservations can exceed what is on
 * the shelf even while on-hand still reads positive.
 */
export function isNegativeStock(onHand: number, available: number): boolean {
  return onHand < 0 || available < 0;
}
