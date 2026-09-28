import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";
import { businessDateString, businessTz } from "@/lib/business-date";

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

    const rawTxs = open
      ? await q<{ id: string; type: string; amount: string; note: string | null; referenceId: string | null; at: string }>`
          SELECT id, type::text AS type, amount::text AS amount, note, "referenceId", timestamp::text AS at
            FROM "CashTransaction"
           WHERE "cashSessionId" = ${open.id}
           ORDER BY timestamp ASC`
      : [];

    let openingCash = open ? Number(open.openingCash) : 0;
    let cashSales = 0;
    let salesCount = 0;
    let cashReceived = 0;
    let receivedCount = 0;
    let cashExpenses = 0;
    let expensesCount = 0;
    let cashRefunds = 0;
    let refundsCount = 0;
    let bankDeposits = 0;
    let depositsCount = 0;

    let currentBal = openingCash;
    const ledger = rawTxs.map((t) => {
      const amt = Number(t.amount);
      const isPositive = t.type === "SALE" || t.type === "OTHER_RECEIPT";
      if (t.type === "SALE") {
        cashSales += amt;
        salesCount++;
        currentBal += amt;
      } else if (t.type === "OTHER_RECEIPT") {
        cashReceived += amt;
        receivedCount++;
        currentBal += amt;
      } else if (t.type === "WITHDRAWAL") {
        cashExpenses += amt;
        expensesCount++;
        currentBal -= amt;
      } else if (t.type === "REFUND") {
        cashRefunds += amt;
        refundsCount++;
        currentBal -= amt;
      } else if (t.type === "BANK_DEPOSIT") {
        bankDeposits += amt;
        depositsCount++;
        currentBal -= amt;
      }

      return {
        id: t.id,
        type: t.type,
        amount: amt,
        sign: isPositive ? 1 : -1,
        note: t.note,
        referenceId: t.referenceId,
        at: t.at,
        runningBalance: currentBal,
      };
    });

    const expectedClosingCash = openingCash + cashSales + cashReceived - cashExpenses - cashRefunds - bankDeposits;

    const counts = await q`
      SELECT id, "closedAt"::text AS "closedAt", "openingCash"::text AS "openingCash", "expectedCash"::text AS "expectedCash",
             "actualCash"::text AS "actualCash", difference::text AS difference, "discrepancyReason" AS note
        FROM "CashSession"
       WHERE "warehouseId" = ${w} AND "financeUserId" = ${u} AND "actualCash" IS NOT NULL
         AND ("closedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${businessTz()})::date = ${businessDateString()}::date
       ORDER BY "closedAt" DESC`;

    return {
      open: open ?? null,
      formula: {
        openingCash,
        cashSales,
        salesCount,
        cashReceived,
        receivedCount,
        cashExpenses,
        expensesCount,
        cashRefunds,
        refundsCount,
        bankDeposits,
        depositsCount,
        expectedClosingCash,
      },
      ledger,
      counts,
      today: businessDateString(),
    };
  });

  return NextResponse.json(out);
}
