import { Decimal } from "@prisma/client/runtime/library";
import type { Q } from "./cash";

/**
 * The daily Cash & Bank reconciliation the manager and admin read.
 *
 * Every bill is recorded as cash, whether the customer paid in notes or by
 * UPI. So per drawer, software - counted is money that should be in the bank
 * rather than the drawer. The bank is then checked as:
 *
 *   expected bank closing = opening + not-in-drawer + cash deposited to bank
 *                           + UPI recorded as UPI + manual adjustment
 *   difference            = bank closing (from the statement) - expected
 *
 * which is the one real "physical vs software" figure: a drawer short on its
 * own proves nothing, since that shortfall is normally UPI.
 *
 * A drawer belongs to the day it was COUNTED (a session opened after the
 * evening count holds tomorrow's sales). One never counted belongs to the day
 * it opened. Days with no bank balance entered roll forward into the next
 * entry, so no money is dropped between entries.
 */

export type SessionRow = {
  id: string;
  day: string; // YYYY-MM-DD
  userId: string;
  userName: string;
  status: "OPEN" | "CLOSED";
  openingCash: string;
  actualCash: string | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  sales: string;
  refunds: string;
  cashIn: string;
  bankDeposits: string;
  paidOut: string;
  saleCount: number;
};
export type BankRow = { day: string; openingBalance: string | null; closingBalance: string; adjustment: string; note: string | null };

export type DrawerLine = SessionRow & { software: string; notInDrawer: string | null; state: "OPEN" | "COUNTED" | "NOT_COUNTED" };

export type DayStatus = "OPEN" | "NOT_COUNTED" | "WAITING_BANK" | "NO_OPENING" | "MATCHED" | "SHORT" | "EXCESS";

export type Day = {
  day: string;
  drawers: DrawerLine[];
  cash: {
    opening: string;
    sales: string;
    refunds: string;
    cashIn: string;
    bankDeposits: string;
    paidOut: string;
    software: string; // what the drawers would hold if every payment had been cash
    counted: string | null; // null until every drawer that day is counted
    notInDrawer: string; // software - counted, over the drawers that were counted
  };
  upi: string;
  bank: null | {
    opening: string | null;
    inflow: string; // not-in-drawer + deposits + UPI since the previous entry
    adjustment: string;
    expected: string | null;
    closing: string;
    difference: string | null;
    note: string | null;
    daysCovered: number;
  };
  status: DayStatus;
};

const d = (x: Decimal.Value | null | undefined) => new Decimal(x ?? 0);

function drawerLine(s: SessionRow): DrawerLine {
  const software = d(s.openingCash).add(s.sales).add(s.cashIn).sub(s.refunds).sub(s.bankDeposits).sub(s.paidOut);
  const counted = s.actualCash !== null;
  return {
    ...s,
    software: software.toString(),
    notInDrawer: counted ? software.sub(s.actualCash!).toString() : null,
    state: s.status === "OPEN" ? "OPEN" : counted ? "COUNTED" : "NOT_COUNTED",
  };
}

/**
 * Pure: sessions/UPI/bank rows from `from` (the day after the last bank entry
 * before `since`, or `since`) through `until` -> day rows from `since`, newest
 * first. `prevBank` is that last entry, whose closing opens the first period.
 */
export function buildDayBook(input: {
  since: string;
  sessions: SessionRow[];
  upi: { day: string; amount: string }[];
  banks: BankRow[];
  prevBank: { closingBalance: string } | null;
}): Day[] {
  const days = new Set<string>([...input.sessions.map((s) => s.day), ...input.upi.map((u) => u.day), ...input.banks.map((b) => b.day)]);
  const upiBy = new Map(input.upi.map((u) => [u.day, u.amount]));
  const bankBy = new Map(input.banks.map((b) => [b.day, b]));

  let lastClosing: Decimal | null = input.prevBank ? d(input.prevBank.closingBalance) : null;
  let pending = new Decimal(0);
  let pendingDays = 0;
  const out: Day[] = [];

  for (const day of [...days].sort()) {
    const drawers = input.sessions.filter((s) => s.day === day).map(drawerLine).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    const sum = (k: keyof SessionRow) => drawers.reduce((t, s) => t.add(s[k] as string), new Decimal(0));

    // A person can count more than once a day; each session opens with the
    // previous count, so the day's opening is each person's FIRST session and
    // the day's count is each person's LAST.
    const byUser = new Map<string, DrawerLine[]>();
    for (const s of drawers) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
    const firsts = [...byUser.values()].map((l) => l[0]!);
    const lasts = [...byUser.values()].map((l) => l[l.length - 1]!);
    const opening = firsts.reduce((t, s) => t.add(s.openingCash), new Decimal(0));
    const allCounted = drawers.length > 0 && lasts.every((s) => s.state === "COUNTED");
    const notInDrawer = drawers.reduce((t, s) => t.add(s.notInDrawer ?? 0), new Decimal(0));
    const deposits = sum("bankDeposits");
    const upi = d(upiBy.get(day));

    pending = pending.add(notInDrawer).add(deposits).add(upi);
    pendingDays++;

    let bank: Day["bank"] = null;
    const b = bankBy.get(day);
    if (b) {
      const bankOpening = lastClosing ?? (b.openingBalance !== null ? d(b.openingBalance) : null);
      const expected = bankOpening?.add(pending).add(b.adjustment) ?? null;
      bank = {
        opening: bankOpening?.toString() ?? null,
        inflow: pending.toString(),
        adjustment: d(b.adjustment).toString(),
        expected: expected?.toString() ?? null,
        closing: d(b.closingBalance).toString(),
        difference: expected ? d(b.closingBalance).sub(expected).toString() : null,
        note: b.note,
        daysCovered: pendingDays,
      };
      lastClosing = d(b.closingBalance);
      pending = new Decimal(0);
      pendingDays = 0;
    }

    const status: DayStatus = drawers.some((s) => s.state === "OPEN")
      ? "OPEN"
      : drawers.some((s) => s.state === "NOT_COUNTED")
        ? "NOT_COUNTED"
        : !bank
          ? "WAITING_BANK"
          : bank.difference === null
            ? "NO_OPENING"
            : d(bank.difference).isZero()
              ? "MATCHED"
              : d(bank.difference).isNeg()
                ? "SHORT"
                : "EXCESS";

    if (day < input.since) continue; // only fed the roll-forward
    out.push({
      day,
      drawers,
      cash: {
        opening: opening.toString(),
        sales: sum("sales").toString(),
        refunds: sum("refunds").toString(),
        cashIn: sum("cashIn").toString(),
        bankDeposits: deposits.toString(),
        paidOut: sum("paidOut").toString(),
        software: drawers.reduce((t, s) => t.add(s.software).sub(s.openingCash), opening).toString(),
        counted: allCounted ? lasts.reduce((t, s) => t.add(s.actualCash!), new Decimal(0)).toString() : null,
        notInDrawer: notInDrawer.toString(),
      },
      upi: upi.toString(),
      bank,
      status,
    });
  }
  return out.reverse();
}

/** Loads and builds the day book for one warehouse, `since`..`until` inclusive (YYYY-MM-DD). */
export async function loadDayBook(q: Q, a: { warehouseId: string; since: string; until: string; tz: string }) {
  const [prevBank] = await q<{ day: string; closingBalance: string }>`
    SELECT "businessDate"::text AS day, "closingBalance"::text AS "closingBalance" FROM "BankBalance"
     WHERE "warehouseId" = ${a.warehouseId} AND "businessDate" < ${a.since}::date
     ORDER BY "businessDate" DESC LIMIT 1`;
  // Days between the last entry and `since` still feed the first entry in range.
  const from = prevBank ? prevBank.day : a.since;

  const sessions = await q<SessionRow>`
    SELECT s.id, u.id AS "userId", u.name AS "userName", s.status::text AS status,
           (CASE WHEN s."actualCash" IS NOT NULL THEN (s."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.tz})::date ELSE s."businessDate" END)::text AS day,
           s."openingCash"::text AS "openingCash", s."actualCash"::text AS "actualCash", s."discrepancyReason" AS note,
           s."createdAt"::text AS "openedAt", s."closedAt"::text AS "closedAt",
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'SALE'), 0)::text AS sales,
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'REFUND'), 0)::text AS refunds,
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'OTHER_RECEIPT'), 0)::text AS "cashIn",
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'BANK_DEPOSIT'), 0)::text AS "bankDeposits",
           coalesce(sum(t.amount) FILTER (WHERE t.type = 'WITHDRAWAL'), 0)::text AS "paidOut",
           (count(t.id) FILTER (WHERE t.type = 'SALE'))::int AS "saleCount"
      FROM "CashSession" s
      JOIN "User" u ON u.id = s."financeUserId"
      LEFT JOIN "CashTransaction" t ON t."cashSessionId" = s.id
     WHERE s."warehouseId" = ${a.warehouseId}
       AND (CASE WHEN s."actualCash" IS NOT NULL THEN (s."closedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.tz})::date ELSE s."businessDate" END)
           BETWEEN ${from}::date AND ${a.until}::date
     GROUP BY s.id, u.id`;

  // Payments taken through the UPI screen go straight to the bank.
  const upi = await q<{ day: string; amount: string }>`
    SELECT (t.timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${a.tz})::date::text AS day,
           sum(CASE WHEN t.type = 'PAYMENT' THEN t.amount ELSE -t.amount END)::text AS amount
      FROM "PaymentTransaction" t
      JOIN "Payment" p ON p.id = t."paymentId"
      JOIN "Bill" b ON b.id = p."billId"
     WHERE b."warehouseId" = ${a.warehouseId} AND t.method = 'UPI' AND t.status = 'CONFIRMED' AND t.type IN ('PAYMENT', 'REFUND')
       AND (t.timestamp AT TIME ZONE 'UTC' AT TIME ZONE ${a.tz})::date BETWEEN ${from}::date AND ${a.until}::date
     GROUP BY 1`;

  const banks = await q<BankRow>`
    SELECT "businessDate"::text AS day, "openingBalance"::text AS "openingBalance", "closingBalance"::text AS "closingBalance",
           adjustment::text AS adjustment, note
      FROM "BankBalance"
     WHERE "warehouseId" = ${a.warehouseId} AND "businessDate" BETWEEN ${from}::date AND ${a.until}::date`;

  // `from` is the previous entry's own day when there is one — drop it, its
  // money was already settled by that entry.
  const after = (x: { day: string }) => !prevBank || x.day > prevBank.day;
  return buildDayBook({
    since: a.since,
    sessions: sessions.filter(after),
    upi: upi.filter(after),
    banks: banks.filter(after),
    prevBank: prevBank ?? null,
  });
}
