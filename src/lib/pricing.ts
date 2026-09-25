import { Decimal } from "@prisma/client/runtime/library";
import type { SellingMode } from "@/generated/prisma/client";

export type PricedProduct = {
  name?: string;
  wholesalePrice: Decimal | number | string;
  retailPrice: Decimal | number | string;
  taxPercent: Decimal | number | string;
};

/**
 * A product carrying no usable price for the selling mode in play. Products
 * imported from the old system land with 0.00 prices deliberately (blank, not
 * free), so billing has to refuse them until someone sets a real price rather
 * than quietly printing a zero-rupee bill.
 */
export class UnpricedProductError extends Error {}

/** The sale unit a line is billed in, as far as pricing cares. */
export type PricedUnit = {
  factorToBase: Decimal | number | string;
  wholesalePrice?: Decimal | number | string | null;
  retailPrice?: Decimal | number | string | null;
};

/**
 * Resolves the unit price to use for a line, at the moment of sale.
 * PRD §23: the price actually used must be stored on the order/bill line and
 * never recalculated later even if the product's price changes.
 *
 * Product prices are per *base* unit, so a line billed in a larger unit
 * scales by that unit's factorToBase — a peti of 9 bottles costs 9x a bottle.
 * A unit may instead carry its own price, for rates quoted whole: Rs 680 a
 * peti can't be recovered from a 2-decimal per-bottle price. Callers with no
 * unit in hand (a QC line added after billing) get the base price unchanged.
 */
export function resolveUnitPrice(product: PricedProduct, mode: SellingMode, unit?: PricedUnit): Decimal {
  const own = mode === "WHOLESALE" ? unit?.wholesalePrice : unit?.retailPrice;
  if (own !== null && own !== undefined) {
    const price = new Decimal(own);
    if (price.gt(0)) return price;
  }
  const price = new Decimal(mode === "WHOLESALE" ? product.wholesalePrice : product.retailPrice);
  if (price.lte(0)) {
    throw new UnpricedProductError(
      `${product.name ?? "This product"} has no ${mode === "WHOLESALE" ? "wholesale" : "retail"} price set — set a price before billing it.`
    );
  }
  return price.mul(unit?.factorToBase ?? 1);
}

export type LineTotals = { taxAmount: Decimal; lineTotal: Decimal };

export function computeLine(
  product: PricedProduct,
  qty: Decimal | number | string,
  unitPrice: Decimal | number | string,
  discount: Decimal | number | string = 0
): LineTotals {
  const gross = new Decimal(qty).mul(unitPrice);
  const afterDiscount = gross.sub(discount);
  const taxAmount = afterDiscount.mul(new Decimal(product.taxPercent).div(100));
  return { taxAmount, lineTotal: afterDiscount.add(taxAmount) };
}

export function sumBillTotals(
  lines: { discount: Decimal | number | string; taxAmount: Decimal | number | string; lineTotal: Decimal | number | string; quantity: Decimal | number | string; unitPrice: Decimal | number | string }[]
) {
  let subtotal = new Decimal(0);
  let discountTotal = new Decimal(0);
  let taxTotal = new Decimal(0);
  let total = new Decimal(0);
  for (const l of lines) {
    subtotal = subtotal.add(new Decimal(l.quantity).mul(l.unitPrice));
    discountTotal = discountTotal.add(l.discount);
    taxTotal = taxTotal.add(l.taxAmount);
    total = total.add(l.lineTotal);
  }
  return { subtotal, discountTotal, taxTotal, total };
}

/**
 * A sale unit row as either ORM hands it back.
 */
export type BillableUnit = PricedUnit & { unitId: string; isBaseUnit: boolean };

/** Everything buildBillLine needs off a product row — Prisma and Drizzle alike. */
export type BillableProduct = PricedProduct & { id: string; name: string; baseUnitId: string };

export type BillItemInput = {
  unitId: string;
  quantity: Decimal | number | string;
  discount: Decimal | number | string;
  unitPrice?: number | null;
};

/**
 * One priced order line, with anything wrong about it recorded in `issues`
 * instead of thrown.
 *
 * Billing at the counter never stops: a customer is standing there, and a bill
 * that refuses to print is worse than a bill that needs correcting afterwards.
 * So a unit that is no longer set up falls back to the product's base unit, a
 * product with no price bills at the rate entered (Rs 0 if none), and each of those lands on the order as
 * a note the manager's Orders screen lists (Order.needsReview).
 */
export function buildBillLine(
  product: BillableProduct,
  saleUnits: BillableUnit[],
  item: BillItemInput,
  mode: SellingMode,
  issues: string[]
) {
  let unit = saleUnits.find((u) => u.unitId === item.unitId);
  let unitId = item.unitId;
  if (!unit) {
    // Base unit first: it is the one stock is counted in, so a line billed in
    // it is at least arithmetically honest.
    unit = saleUnits.find((u) => u.isBaseUnit) ?? saleUnits[0];
    unitId = unit?.unitId ?? product.baseUnitId;
    issues.push(
      `${product.name}: billed in a unit that is not set up for it — the line was billed in the product's base unit instead. Check the quantity and the rate, and add the unit back if it should exist.`
    );
  }

  const quantity = new Decimal(item.quantity);
  if (!quantity.gt(0)) {
    issues.push(`${product.name}: billed with a quantity of ${quantity.toString()}. Check what the customer actually took.`);
  }

  let catalogPrice: Decimal;
  let unpriced = false;
  try {
    catalogPrice = resolveUnitPrice(product, mode, unit);
  } catch (err) {
    if (!(err instanceof UnpricedProductError)) throw err;
    catalogPrice = new Decimal(0);
    unpriced = true;
  }

  const unitPrice = item.unitPrice != null ? new Decimal(item.unitPrice) : catalogPrice;
  if (unpriced) {
    const modeName = mode === "WHOLESALE" ? "wholesale" : "retail";
    // The note must say what was actually charged: a rate typed at the counter
    // (offline bills always send one) is a real sale, not a Rs 0 bill.
    issues.push(
      unitPrice.gt(0)
        ? `${product.name}: has no ${modeName} price set, so it was billed at the rate entered, Rs ${unitPrice.toFixed(2)}. Set a catalogue price.`
        : `${product.name}: has no ${modeName} price set, so it was billed at Rs ${unitPrice.toString()}. Set a price and recover the amount from the customer if it was charged wrong.`
    );
  }
  if (!unitPrice.gt(0) && catalogPrice.gt(0)) {
    issues.push(`${product.name}: billed at Rs ${unitPrice.toString()} against a catalogue rate of Rs ${catalogPrice.toString()}.`);
  }

  const { taxAmount, lineTotal } = computeLine(product, quantity, unitPrice, item.discount);
  return {
    product,
    quantity,
    unitId,
    unitPrice,
    catalogPrice,
    discount: new Decimal(item.discount),
    taxAmount,
    lineTotal,
    // Stock moves in base units. Computed here so no caller has to look the
    // unit up a second time (and get the fallback wrong).
    baseQty: quantity.mul(unit?.factorToBase ?? 1),
  };
}

/** Stock billed past zero, worded for the manager's Orders screen. */
export function shortfallIssues(
  short: { productId: string; available: Decimal; requested: Decimal }[],
  nameOf: (productId: string) => string
): string[] {
  return short.map(
    (s) =>
      `${nameOf(s.productId)}: billed ${s.requested.toString()} with ${s.available.toString()} available — stock is now negative. Count it against the shelf.`
  );
}
