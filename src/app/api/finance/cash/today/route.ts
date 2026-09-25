import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";
import { businessDateString, businessTz } from "@/lib/business-date";

/**
 * The counter's view of their own drawer. Deliberately blind: it shows what
 * went in and out by hand, but not what the software expects the drawer to
 * hold — the count is only worth something if it isn't matched to a number.
 * The comparison appears once the count is saved.
 */
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  if (!session.warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });
  const w = session.warehouseId;
  const u = session.sub;

  const out = await inTransaction(async (q) => {
    const [open] = await q<{ id: string; businessDate: string; openedAt: string; openingCash: string; bills: number }>`
      SELECT s.id, s."businessDate"::text AS "businessDate", s."createdAt"::text AS "openedAt", s."openingCash"::text AS "openingCash",
             (SELECT count(*) FROM "CashTransaction" t WHERE t."cashSessionId" = s.id AND t.type = 'SALE')::int AS bills
        FROM "CashSession" s
       WHERE s."warehouseId" = ${w} AND s."financeUserId" = ${u} AND s.status = 'OPEN'
       ORDER BY s."createdAt" DESC LIMIT 1`;
    const movements = open
      ? await q`SELECT type::text AS type, amount::text AS amount, note, timestamp::text AS at FROM "CashTransaction"
                 WHERE "cashSessionId" = ${open.id} AND type IN ('OTHER_RECEIPT', 'WITHDRAWAL', 'BANK_DEPOSIT') ORDER BY timestamp`
      : [];
    const counts = await q`
      SELECT id, "closedAt"::text AS "closedAt", "openingCash"::text AS "openingCash", "expectedCash"::text AS "expectedCash",
             "actualCash"::text AS "actualCash", difference::text AS difference, "discrepancyReason" AS note
        FROM "CashSession"
       WHERE "warehouseId" = ${w} AND "financeUserId" = ${u} AND "actualCash" IS NOT NULL
         AND ("closedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${businessTz()})::date = ${businessDateString()}::date
       ORDER BY "closedAt" DESC`;
    return { open: open ?? null, movements, counts, today: businessDateString() };
  });
  return NextResponse.json(out);
}
