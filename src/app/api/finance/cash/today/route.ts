import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";
import { businessDateString, businessTz } from "@/lib/business-date";
import { resolveDateRange } from "@/lib/date-filter";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  if (!session.warehouseId && session.role !== "ADMIN") return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });
  const w = session.warehouseId || req.nextUrl.searchParams.get("warehouseId") || "none";
  const u = session.sub;

  const presetParam = req.nextUrl.searchParams.get("preset");
  const startParam = req.nextUrl.searchParams.get("startDate");
  const endParam = req.nextUrl.searchParams.get("endDate");
  const dateRange = resolveDateRange(presetParam, startParam, endParam);

  const out = await inTransaction(async (q) => {
    const isSingleDay = dateRange.preset === "today" || dateRange.preset === "yesterday";

    const [open] = await q<{ id: string; businessDate: string; openedAt: string; openingCash: string; bills: number }>`
      SELECT s.id, s."businessDate"::text AS "businessDate", s."createdAt"::text AS "openedAt", s."openingCash"::text AS "openingCash",
             (SELECT count(*) FROM "CashTransaction" t WHERE t."cashSessionId" = s.id AND t.type = 'SALE')::int AS bills
        FROM "CashSession" s
       WHERE s."warehouseId" = ${w} AND s."financeUserId" = ${u} AND s.status = 'OPEN'
       ORDER BY s."createdAt" DESC LIMIT 1`;

    let rawTxs: { id: string; type: string; amount: string; note: string | null; referenceId: string | null; at: string }[] = [];

    if (dateRange.preset === "today" && open) {
      rawTxs = await q<{ id: string; type: string; amount: string; note: string | null; referenceId: string | null; at: string }>`
        SELECT id, type::text AS type, amount::text AS amount, note, "referenceId", timestamp::text AS at
          FROM "CashTransaction"
         WHERE "cashSessionId" = ${open.id}
         ORDER BY timestamp ASC`;
    } else {
      rawTxs = await q<{ id: string; type: string; amount: string; note: string | null; referenceId: string | null; at: string }>`
        SELECT t.id, t.type::text AS type, t.amount::text AS amount, t.note, t."referenceId", t.timestamp::text AS at
          FROM "CashTransaction" t
          JOIN "CashSession" s ON s.id = t."cashSessionId"
         WHERE s."warehouseId" = ${w}
           AND t.timestamp >= ${dateRange.startDate.toISOString()}::timestamptz
           AND t.timestamp <= ${dateRange.endDate.toISOString()}::timestamptz
         ORDER BY t.timestamp ASC`;
    }

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
       WHERE "warehouseId" = ${w} AND "actualCash" IS NOT NULL
         AND "closedAt" >= ${dateRange.startDate.toISOString()}::timestamptz
         AND "closedAt" <= ${dateRange.endDate.toISOString()}::timestamptz
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
      dateRange: {
        preset: dateRange.preset,
        startDateStr: dateRange.startDateStr,
        endDateStr: dateRange.endDateStr,
        label: dateRange.label,
      },
    };
  });

  return NextResponse.json(out);
}
