/**
 * Which lines a bill still contains, and which ones left it.
 *
 * A revision does not delete a dropped line — it writes it into the new
 * version as REMOVED at quantity 0, so the history shows what went. That is
 * right for the record and wrong for every screen: the removed rows sat in the
 * middle of the item table at Rs 0.00, and printed on the customer's bill.
 *
 * Deliberately free of Decimal and every other server import: this runs in the
 * order pages, and pulling bill-revision.ts into a client component would drag
 * Prisma's runtime into the browser bundle.
 */

export type BillLineLike = {
  productId: string;
  unitId: string;
  changeType?: string | null;
  quantity: unknown;
  previousQuantity?: unknown;
};

const keyOf = (l: BillLineLike) => `${l.productId}:${l.unitId}`;

/** A line the customer is actually being billed for. */
export const isActiveLine = (l: BillLineLike) => l.changeType !== "REMOVED" && Number(l.quantity) > 0;

/**
 * Every line ever dropped from this bill, newest removal first, tagged with
 * the version it left in.
 *
 * Two things a plain concat of the REMOVED rows gets wrong:
 *
 * - A product removed in v2 and added back in v3 is not removed. Anything
 *   live on the current version is excluded, or the bill would list a product
 *   as both billed and cancelled.
 * - Removed, re-added, removed again is one line, not two. Keyed by product +
 *   unit with the later version winning, so it is reported at the version it
 *   most recently left in.
 */
export function collectRemovedLines<I extends BillLineLike>(
  versions: { versionNumber: number; items: I[] }[],
  currentVersionNumber: number
): { item: I; versionNumber: number }[] {
  const current = versions.find((v) => v.versionNumber === currentVersionNumber) ?? versions[versions.length - 1];
  const live = new Set((current?.items ?? []).filter(isActiveLine).map(keyOf));

  const latest = new Map<string, { item: I; versionNumber: number }>();
  for (const version of [...versions].sort((a, b) => a.versionNumber - b.versionNumber)) {
    for (const item of version.items) {
      if (item.changeType !== "REMOVED") continue;
      latest.set(keyOf(item), { item, versionNumber: version.versionNumber });
    }
  }

  return [...latest.entries()]
    .filter(([key]) => !live.has(key))
    .map(([, entry]) => entry)
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

/** Money as the API sends it: Prisma serialises Decimal to a string and
 *  Drizzle returns numeric columns as strings. Number() before arithmetic. */
export type Money = string | number | null | undefined;

/** A sale unit as either endpoint returns it — /api/products nests the unit
 *  under `unit`, the order route carries `unitId` alongside it. */
export type SaleUnitLike = {
  unitId?: string;
  isBaseUnit?: boolean;
  isDefaultSaleUnit?: boolean;
  factorToBase?: Money;
  wholesalePrice?: Money;
  retailPrice?: Money;
  unit: { id: string; symbol: string } | null;
};

export type PricedProduct = { id: string; name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits: SaleUnitLike[] };

export const unitIdOf = (u: SaleUnitLike) => u.unitId ?? u.unit?.id ?? "";

/**
 * The catalogue rate for a product in a given unit, so a line shows its price
 * the moment it is picked rather than an empty box until the server prices it.
 *
 * Prices are per *base* unit, so a line billed in a bigger unit scales by that
 * unit's factorToBase — a peti of 9 bottles costs 9x a bottle — unless the
 * unit carries its own price, for rates quoted whole (Rs 680 a peti cannot be
 * recovered from a 2-decimal per-bottle price). Mirrors resolveUnitPrice in
 * lib/pricing.ts; the server's figure is still the one that bills, this is
 * only what the screen shows.
 */
export function catalogueRate(product: PricedProduct, unitId: string, sellingMode: string): number | null {
  const su = product.saleUnits.find((u) => unitIdOf(u) === unitId);
  const own = sellingMode === "WHOLESALE" ? su?.wholesalePrice : su?.retailPrice;
  if (own != null && Number(own) > 0) return Number(own);
  const base = Number(sellingMode === "WHOLESALE" ? product.wholesalePrice : product.retailPrice);
  // An unpriced product is left blank rather than shown as Rs 0 — the server
  // refuses to bill it, and a zero here would read as "free".
  if (!(base > 0)) return null;
  return base * Number(su?.factorToBase ?? 1);
}

