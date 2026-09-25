import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";
import { loadDayBook } from "@/lib/daybook";
import { businessDateString, businessTz } from "@/lib/business-date";
import { cashWarehouse, isDay } from "@/lib/cash-scope";

const DAY = 24 * 60 * 60 * 1000;

/** Daily Cash & Bank reconciliation for one warehouse. ?since=&until= (YYYY-MM-DD), default the last 30 days. */
export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const p = req.nextUrl.searchParams;
  const warehouseId = cashWarehouse(session, p.get("warehouseId"));
  if (warehouseId instanceof NextResponse) return warehouseId;

  const until = isDay(p.get("until")) ? p.get("until")! : businessDateString();
  let since = isDay(p.get("since")) ? p.get("since")! : businessDateString(new Date(Date.parse(until) - 30 * DAY));
  if (since > until) return NextResponse.json({ error: "From must not be after To" }, { status: 400 });
  if (Date.parse(until) - Date.parse(since) > 366 * DAY) since = businessDateString(new Date(Date.parse(until) - 366 * DAY));

  const { days, firstBankDay } = await inTransaction(async (q) => {
    const [first] = await q<{ day: string | null }>`SELECT min("businessDate")::text AS day FROM "BankBalance" WHERE "warehouseId" = ${warehouseId}`;
    return { days: await loadDayBook(q, { warehouseId, since, until, tz: businessTz() }), firstBankDay: first?.day ?? null };
  });
  // firstBankDay: the bank's opening balance is only asked for on (or before) the first entry.
  return NextResponse.json({ warehouseId, since, until, today: businessDateString(), firstBankDay, days });
}
