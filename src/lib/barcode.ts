/**
 * Barcode matching, shared by the product search API and the QC scan screen.
 *
 * Two levels carry codes: Product.barcode (the manufacturer's code for the
 * product as a whole) and ProductUnit.barcode (per-packaging — a "box of 24"
 * scans differently than a loose piece). A scan can legitimately hit either,
 * so every lookup here checks both.
 *
 * Comparison is exact, never a prefix or fuzzy match: a barcode is an
 * identifier, and "close" is always the wrong product.
 */

export type UnitBarcode = { unitId: string; barcode: string | null };

/**
 * Which sale unit the search term matched by barcode, or null. Only an exact
 * unit-barcode hit returns a unit — a name/SKU search leaves it null so the
 * caller falls back to its normal base-unit default.
 */
export function matchedUnitIdFor(saleUnits: UnitBarcode[], q: string): string | null {
  if (!q) return null;
  return saleUnits.find((su) => su.barcode === q)?.unitId ?? null;
}

/**
 * Every code that identifies a product: its own, plus each unit's. Nulls and
 * duplicates are dropped, so a product with no codes yields an empty list
 * (and therefore can never be matched by a scan — correct, not a bug).
 */
export function barcodesForProduct(product: { barcode?: string | null; saleUnits?: UnitBarcode[] | null }): string[] {
  const all = [product.barcode, ...(product.saleUnits ?? []).map((su) => su.barcode)];
  return [...new Set(all.filter((b): b is string => !!b && b.trim().length > 0))];
}

/**
 * Finds the entry whose product owns `code`. Used by QC against the lines of
 * the order in hand — deliberately scoped to that list rather than the whole
 * catalogue, so scanning an item that isn't on the order reports a mismatch
 * (the error worth catching at handover) instead of silently resolving.
 */
export function findByBarcode<T extends { barcodes: string[] }>(entries: T[], code: string): T | null {
  const needle = code.trim();
  if (!needle) return null;
  return entries.find((e) => e.barcodes.includes(needle)) ?? null;
}
