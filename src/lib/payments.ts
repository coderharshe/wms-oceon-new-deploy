import { Decimal } from "@prisma/client/runtime/library";
import type { PaymentStatus } from "@/generated/prisma/client";

/** Thrown when a payment mutation is rejected for a business reason (not a bug) — routes catch this and return 409. */
export class PaymentError extends Error {}

/** Plain amount-due vs amount-paid status, used right after recording a payment. */
export function computePaymentStatus(
  amountDue: Decimal | number | string,
  amountPaid: Decimal | number | string
): PaymentStatus {
  const due = new Decimal(amountDue);
  const paid = new Decimal(amountPaid);
  if (paid.lte(0)) return "UNPAID";
  // Overpayment is not "settled" — the store owes the difference back, and the
  // order must not be pushed toward handover as if the money were reconciled.
  if (paid.gt(due)) return "REFUND_DUE";
  if (paid.eq(due)) return "PAID";
  return "PARTIALLY_PAID";
}

export type AdjustmentResolutionType =
  | "CASH_REFUND"
  | "UPI_REFUND"
  | "CUSTOMER_CREDIT"
  | "MANAGER_ADJUSTMENT"
  | "ADDITIONAL_PAYMENT";

// A revision that made the bill bigger can only be settled by collecting more;
// one that made it smaller can only be settled by giving money back. Letting
// the two mix silently books a refund against a customer who in fact owes.
const RESOLUTIONS_WHEN_CUSTOMER_OWES: AdjustmentResolutionType[] = ["ADDITIONAL_PAYMENT", "MANAGER_ADJUSTMENT"];
const RESOLUTIONS_WHEN_STORE_OWES: AdjustmentResolutionType[] = ["CASH_REFUND", "UPI_REFUND", "CUSTOMER_CREDIT", "MANAGER_ADJUSTMENT"];

export function assertResolutionDirection(difference: Decimal, resolutionType: AdjustmentResolutionType) {
  const owedByCustomer = difference.gt(0);
  const allowed = owedByCustomer ? RESOLUTIONS_WHEN_CUSTOMER_OWES : RESOLUTIONS_WHEN_STORE_OWES;
  if (!allowed.includes(resolutionType)) {
    throw new PaymentError(
      owedByCustomer
        ? `The customer owes ₹${difference.toString()} more — ${resolutionType} cannot resolve this adjustment (use ${RESOLUTIONS_WHEN_CUSTOMER_OWES.join(" or ")})`
        : `The store owes the customer ₹${difference.abs().toString()} — ${resolutionType} cannot resolve this adjustment (use ${RESOLUTIONS_WHEN_STORE_OWES.join(", ")})`
    );
  }
}

/** Cash tendered vs bill total (PRD §17). */
export function computeChange(amountReceived: Decimal | number | string, billTotal: Decimal | number | string) {
  const change = new Decimal(amountReceived).sub(billTotal);
  return change.lt(0) ? new Decimal(0) : change;
}

export type BillAdjustmentOutcome = {
  status: PaymentStatus;
  additionalAmountDue: Decimal;
  refundOrCreditDue: Decimal;
};

/**
 * PRD §15 — the three cases after a QC revision changes the bill total:
 *  A) new total == paid            -> settled, no adjustment
 *  B) new total > paid             -> customer owes the difference
 *  C) new total < paid             -> store owes a refund/credit
 */
export function evaluateBillChange(
  newTotal: Decimal | number | string,
  amountPaid: Decimal | number | string
): BillAdjustmentOutcome {
  const balance = new Decimal(newTotal).sub(amountPaid); // >0 owed by customer, <0 owed to customer
  if (balance.isZero()) {
    return { status: "PAID", additionalAmountDue: new Decimal(0), refundOrCreditDue: new Decimal(0) };
  }
  if (balance.gt(0)) {
    return { status: "PAYMENT_ADJUSTMENT_REQUIRED", additionalAmountDue: balance, refundOrCreditDue: new Decimal(0) };
  }
  return { status: "REFUND_DUE", additionalAmountDue: new Decimal(0), refundOrCreditDue: balance.abs() };
}


/**
 * How much a customer's receivable moves when ONE bill's due/paid figures
 * change. Outstanding is floored at 0 per bill, so an overpaid bill reduces
 * the receivable to zero and no further — it never becomes a credit against
 * the customer's other bills (that is what a PaymentAdjustment is for).
 */
export function receivableDelta(
  prev: { due: Decimal | number | string; paid: Decimal | number | string },
  next: { due: Decimal | number | string; paid: Decimal | number | string }
): Decimal {
  const outstanding = (x: { due: Decimal | number | string; paid: Decimal | number | string }) =>
    Decimal.max(new Decimal(x.due).sub(x.paid), 0);
  return outstanding(next).sub(outstanding(prev));
}
