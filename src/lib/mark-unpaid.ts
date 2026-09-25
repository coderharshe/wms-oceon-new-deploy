import { Decimal } from "@prisma/client/runtime/library";
import type { Role } from "@/generated/prisma/client";
import { auditQ, type Q } from "./cash";
import { receivableDelta } from "./payments";

// "Mark unpaid": the counter prints a bill as paid in cash unless "on credit"
// was ticked, so a customer who actually took the goods on credit left a bill
// that says paid and a drawer that expects money that never came in. This
// undoes that — the cash payment is VOIDED (kept, not deleted; every report
// already counts only CONFIRMED rows), its SALE row leaves the still-open
// drawer, and the bill's full amount lands back on the customer's balance.
//
// Written once as raw SQL (same approach as cash.ts) so it runs on Prisma and
// Drizzle alike.

export const MARKED_UNPAID = "BILL_MARKED_UNPAID";

export class MarkUnpaidError extends Error {}

export type LedgerRow = {
  id: string;
  type: string;
  method: string;
  status: string;
  cashTxId: string | null;
  sessionStatus: string | null;
};

/**
 * Which payments to void and which drawer rows to take back — or why not.
 * Only cash, and only while the drawer it went into is still open: UPI is
 * real money in the bank, and a closed drawer's count already assumed the
 * cash was there. Those go to a manager's balance adjustment instead.
 */
export function planMarkUnpaid(rows: LedgerRow[]) {
  if (rows.some((r) => r.status === "PENDING")) {
    throw new MarkUnpaidError("A UPI payment on this bill is still waiting. Confirm or cancel it first.");
  }
  const confirmed = rows.filter((r) => r.status === "CONFIRMED");
  if (confirmed.length === 0) throw new MarkUnpaidError("This bill has no payment to undo.");
  if (confirmed.some((r) => r.method !== "CASH" || r.type !== "PAYMENT")) {
    throw new MarkUnpaidError("This bill has a UPI payment or a refund, so it can't be marked unpaid here. Ask a manager to adjust the customer's balance.");
  }
  if (confirmed.some((r) => r.sessionStatus === "CLOSED")) {
    throw new MarkUnpaidError("The cash for this bill was already counted at day close. Ask a manager to adjust the customer's balance instead.");
  }
  return {
    voidIds: confirmed.map((r) => r.id),
    // A payment from before the drawer existed has no SALE row — nothing to take back.
    cashTxIds: confirmed.flatMap((r) => (r.cashTxId ? [r.cashTxId] : [])),
  };
}

type Session = { sub: string; role: Role; warehouseId: string | null };

/** Returns the bill's warehouse so the caller can check access before anything is written. */
export async function markUnpaid(
  q: Q,
  a: { orderId: string; reason: string; session: Session; canAccess: (warehouseId: string) => boolean },
) {
  // Payment row locked first, drawer locks second — the same order
  // recordCashPayment takes them in, so the two can't deadlock.
  const [p] = await q<{ paymentId: string; amountDue: string; amountPaid: string; billId: string; billNumber: string; orderStatus: string; customerId: string; warehouseId: string }>`
    SELECT p.id AS "paymentId", p."amountDue"::text AS "amountDue", p."amountPaid"::text AS "amountPaid", b.id AS "billId", b."billNumber",
           o.status::text AS "orderStatus", o."customerId", b."warehouseId"
      FROM "Order" o
      JOIN "Bill" b ON b."orderId" = o.id
      JOIN "Payment" p ON p."billId" = b.id
     WHERE o.id = ${a.orderId}
       FOR UPDATE OF p`;
  if (!p) throw new MarkUnpaidError("This order has no bill.");
  if (!a.canAccess(p.warehouseId)) return { forbidden: true as const };

  const ledger = () => q<LedgerRow & { ownerId: string | null }>`
    SELECT t.id, t.type::text AS type, t.method::text AS method, t.status, c.id AS "cashTxId", s.status::text AS "sessionStatus", s."financeUserId" AS "ownerId"
      FROM "PaymentTransaction" t
      LEFT JOIN "CashTransaction" c ON c."referenceId" = t.id AND c.type = 'SALE'
      LEFT JOIN "CashSession" s ON s.id = c."cashSessionId"
     WHERE t."paymentId" = ${p.paymentId} AND t.status IN ('CONFIRMED', 'PENDING')`;

  // Hold each drawer the cash went into, so it can't be counted between the
  // check below and the delete. Re-read after locking: a count may have
  // closed it while we waited.
  const owners = [...new Set((await ledger()).flatMap((r) => (r.ownerId ? [r.ownerId] : [])))].sort();
  for (const owner of owners) {
    await q`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`drawer:${p.warehouseId}:${owner}`}::text))`;
  }
  const plan = planMarkUnpaid(await ledger());

  for (const id of plan.voidIds) await q`UPDATE "PaymentTransaction" SET status = 'VOIDED' WHERE id = ${id}`;
  for (const id of plan.cashTxIds) await q`DELETE FROM "CashTransaction" WHERE id = ${id}`;

  // Everything confirmed was voided above, so nothing is paid any more.
  const delta = receivableDelta({ due: p.amountDue, paid: p.amountPaid }, { due: p.amountDue, paid: 0 });
  if (!delta.isZero()) {
    await q`UPDATE "Customer" SET "outstandingBalance" = "outstandingBalance" + ${delta.toString()}::numeric WHERE id = ${p.customerId}`;
  }
  await q`UPDATE "Payment" SET "amountPaid" = 0 WHERE id = ${p.paymentId}`;
  await q`UPDATE "Bill" SET "paymentStatus" = 'UNPAID'::"PaymentStatus" WHERE id = ${p.billId}`;
  // A bill still before QC goes back to where a credit bill starts. Anything
  // further along keeps its place — only the money changed.
  if (p.orderStatus === "PAID") {
    await q`UPDATE "Order" SET status = 'BILLED'::"OrderStatus", "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE id = ${a.orderId}`;
  }

  await auditQ(q, {
    userId: a.session.sub,
    role: a.session.role,
    warehouseId: p.warehouseId,
    action: MARKED_UNPAID,
    entityType: "Bill",
    entityId: p.billId,
    newValue: { billNumber: p.billNumber, amount: new Decimal(p.amountPaid).toFixed(2), voided: plan.voidIds },
    reason: a.reason,
  });
  return { forbidden: false as const, billId: p.billId, warehouseId: p.warehouseId, orderId: a.orderId };
}

export type UnpaidMark = { at: string; by: string | null; reason: string | null; amount: string | null };

/** Who marked this bill unpaid, when and why — shown on the bill page. */
export function unpaidMarks(q: Q, billId: string) {
  return q<UnpaidMark>`
    SELECT to_char(a.timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, u.name AS by, a.reason, a."newValue"->>'amount' AS amount
      FROM "AuditLog" a
      LEFT JOIN "User" u ON u.id = a."userId"
     WHERE a."entityType" = 'Bill' AND a."entityId" = ${billId} AND a.action = ${MARKED_UNPAID}
     ORDER BY a.timestamp`;
}
