/**
 * What to PATCH on one of a product's sale units after the edit form is saved.
 *
 * Only the fields actually changed go in: PATCH
 * /api/admin/products/[id]/units/[unitId] writes exactly the keys it is sent,
 * so resending an untouched rate is harmless but omitting a changed one makes
 * the edit look ignored — which is how per-unit rates went uneditable in the
 * first place. An empty object means "nothing to send, skip the call".
 *
 * A blank rate is null, never 0: null means "derive this unit's price from the
 * base price x factorToBase" (see resolveUnitPrice), 0 would mean free.
 */
export type SaleUnitEdit = { barcode: string; barcodeGenerated: boolean; wholesale: string; retail: string };
export type SaleUnitStored = { barcode: string | null; wholesalePrice: string | null; retailPrice: string | null };

export function saleUnitPatch(stored: SaleUnitStored, edit: SaleUnitEdit): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (edit.barcode !== (stored.barcode ?? "")) {
    patch.barcode = edit.barcode || null;
    patch.barcodeGenerated = edit.barcode ? edit.barcodeGenerated : false;
  }
  if (edit.wholesale !== (stored.wholesalePrice ?? "")) patch.wholesalePrice = rateOrNull(edit.wholesale);
  if (edit.retail !== (stored.retailPrice ?? "")) patch.retailPrice = rateOrNull(edit.retail);
  return patch;
}

const rateOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
