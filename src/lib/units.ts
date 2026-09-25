import { Decimal } from "@prisma/client/runtime/library";

export type ProductUnitLike = {
  unitId: string;
  factorToBase: Decimal | number | string;
  isBaseUnit: boolean;
};

/**
 * How many base units one of `unitId` holds.
 *
 * ponytail: a unit the product no longer lists converts 1:1 instead of
 * throwing. It only happens when the catalogue changed under a line that was
 * already saved (detaching a unit is blocked while a live order bills in it),
 * and the alternative is an order nobody can bill, QC or revise — a wrong
 * factor is visible and fixable, a stuck order is neither. Callers that are
 * validating *input* (purchase bills, revisions) still call assertValidUnit
 * first; billing records it as a bill issue instead — see buildBillLine.
 */
function factorToBase(productUnits: ProductUnitLike[], unitId: string): Decimal {
  const pu = productUnits.find((u) => u.unitId === unitId);
  return new Decimal(pu?.factorToBase ?? 1);
}

/**
 * Converts a quantity expressed in `unitId` to the product's base unit.
 * Base-unit storage (PRD §22) is what lets inventory stay comparable across
 * "25 kg" vs "500 g" sales of the same product.
 */
export function toBaseQty(
  productUnits: ProductUnitLike[],
  unitId: string,
  qty: Decimal | number | string
): Decimal {
  return new Decimal(qty).mul(factorToBase(productUnits, unitId));
}

/** Converts a base-unit quantity back into the given display unit. */
export function fromBaseQty(
  productUnits: ProductUnitLike[],
  unitId: string,
  baseQty: Decimal | number | string
): Decimal {
  return new Decimal(baseQty).div(factorToBase(productUnits, unitId));
}

export function assertValidUnit(productUnits: ProductUnitLike[], unitId: string) {
  if (!productUnits.some((u) => u.unitId === unitId)) {
    throw new UnitError(`Unit ${unitId} is not a configured sale unit for this product`);
  }
}

export class UnitError extends Error {}
