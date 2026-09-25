import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Bill arithmetic and moving-average costing for supplier purchase bills.
 * Kept out of the route so both the Prisma and Drizzle branches (and the
 * unit tests) run the exact same money math.
 */

export type PurchaseLine = { quantity: Decimal | number | string; rate: Decimal | number | string };

/** quantity * rate, rounded to paise — the amount printed on the bill line. */
export function lineAmount(line: PurchaseLine): Decimal {
  return new Decimal(line.quantity).mul(line.rate).toDecimalPlaces(2);
}

/**
 * Server-side bill totals. The client sends quantities/rates only — never a
 * total — so a tampered or stale form can't book a bill that doesn't add up.
 */
export function billTotals(lines: PurchaseLine[], gstAmount: Decimal | number | string = 0, otherCharges: Decimal | number | string = 0) {
  const subtotal = lines.reduce((sum, l) => sum.add(lineAmount(l)), new Decimal(0)).toDecimalPlaces(2);
  const gst = new Decimal(gstAmount).toDecimalPlaces(2);
  const other = new Decimal(otherCharges).toDecimalPlaces(2);
  return { subtotal, gstAmount: gst, otherCharges: other, total: subtotal.add(gst).add(other) };
}

/**
 * Splits `otherCharges` (freight, loading, unloading) across the bill's lines
 * pro-rata by line amount, so `Product.avgCost` ends up being landed cost
 * rather than bare invoice cost.
 *
 * GST is deliberately NOT allocated here: input GST is recoverable against
 * output GST, so it is a receivable, not part of the cost of the goods.
 *
 * The shares always sum to exactly `otherCharges` — the rounding remainder is
 * dropped on the largest line, so freight is never lost or invented.
 */
export function allocateOtherCharges(lines: PurchaseLine[], otherCharges: Decimal | number | string = 0): Decimal[] {
  const total = new Decimal(otherCharges).toDecimalPlaces(2);
  const amounts = lines.map(lineAmount);
  if (amounts.length === 0) return [];
  const subtotal = amounts.reduce((s, a) => s.add(a), new Decimal(0));
  // A zero subtotal (every line free) has no basis to apportion by; the whole
  // remainder lands on line 0 below.
  const shares = amounts.map((a) =>
    subtotal.isZero() ? new Decimal(0) : a.mul(total).div(subtotal).toDecimalPlaces(2)
  );
  let largest = 0;
  for (let i = 1; i < amounts.length; i++) if (amounts[i]!.gt(amounts[largest]!)) largest = i;
  shares[largest] = shares[largest]!.add(total.sub(shares.reduce((s, a) => s.add(a), new Decimal(0))));
  return shares;
}

/**
 * Moving weighted average cost per base unit:
 *   (onHandBefore * oldAvg + receivedBase * ratePerBase) / (onHandBefore + receivedBase)
 *
 * ponytail: deliberately naive — it ignores the cost of stock that later
 * leaves via QC/damage and can be skewed by a mistyped rate. Every line
 * keeps its raw rate on PurchaseBillItem, so a corrected average can always
 * be recomputed from history if this ever needs to be filing-grade.
 */
export function movingAverageCost(args: {
  onHandBefore: Decimal | number | string;
  previousAvgCost: Decimal | number | string | null | undefined;
  receivedBaseQty: Decimal | number | string;
  lineAmount: Decimal | number | string; // total paid for this line
}): Decimal {
  const received = new Decimal(args.receivedBaseQty);
  const amount = new Decimal(args.lineAmount);
  if (received.lte(0)) return new Decimal(args.previousAvgCost ?? 0);

  const ratePerBase = amount.div(received);
  const onHand = Decimal.max(new Decimal(args.onHandBefore), 0);
  // No prior stock or no prior cost recorded — this receipt *is* the average.
  if (args.previousAvgCost == null || onHand.lte(0)) return ratePerBase.toDecimalPlaces(4);

  const oldAvg = new Decimal(args.previousAvgCost);
  return onHand.mul(oldAvg).add(amount).div(onHand.add(received)).toDecimalPlaces(4);
}

export const supplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  // Optional by design — plenty of small suppliers are unregistered. Format
  // is still checked when one is given, so a typo doesn't reach the books.
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/, "Not a valid 15-character GSTIN")
    .optional()
    .or(z.literal("")),
  notes: z.string().optional(),
});
