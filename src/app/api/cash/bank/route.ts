import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { auditQ } from "@/lib/cash";
import { inTransaction } from "@/lib/cash-db";
import { loadDayBook } from "@/lib/daybook";
import { businessDateString, businessTz } from "@/lib/business-date";
import { cashWarehouse, isDay } from "@/lib/cash-scope";

const money = z.number().min(-1e12).max(1e12);
const schema = z.object({
  warehouseId: z.string().optional(),
  day: z.string().refine(isDay, "Pick a date"),
  closingBalance: money,
  openingBalance: money.nullish(),
  adjustment: money.default(0),
  note: z.string().trim().max(500).optional(),
});

class NeedsNote extends Error {}

/** Enter (or correct) the bank balance off the statement for one business day. */
export async function PUT(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const warehouseId = cashWarehouse(session, b.warehouseId);
  if (warehouseId instanceof NextResponse) return warehouseId;
  if (b.day > businessDateString()) return NextResponse.json({ error: "That date hasn't happened yet" }, { status: 400 });

  try {
    const day = await inTransaction(async (q) => {
      await q`
        INSERT INTO "BankBalance" (id, "warehouseId", "businessDate", "openingBalance", "closingBalance", adjustment, note, "enteredByUserId", "updatedAt")
        VALUES (${crypto.randomUUID()}, ${warehouseId}, ${b.day}::date, ${b.openingBalance?.toString() ?? null}::numeric, ${b.closingBalance.toString()}::numeric,
                ${b.adjustment.toString()}::numeric, ${b.note || null}, ${session.sub}, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("warehouseId", "businessDate") DO UPDATE
           SET "openingBalance" = excluded."openingBalance", "closingBalance" = excluded."closingBalance", adjustment = excluded.adjustment,
               note = excluded.note, "enteredByUserId" = excluded."enteredByUserId", "updatedAt" = excluded."updatedAt"`;
      const [row] = await loadDayBook(q, { warehouseId, since: b.day, until: b.day, tz: businessTz() });
      const diff = row?.bank?.difference;
      // Rolls the whole write back: a mismatch is fine, an unexplained one isn't.
      if (diff && !new Decimal(diff).isZero() && !b.note) throw new NeedsNote(`Bank is off by ₹${diff} — add a note saying why`);
      await auditQ(q, {
        userId: session.sub,
        role: session.role,
        warehouseId,
        action: "BANK_BALANCE_ENTERED",
        entityType: "BankBalance",
        entityId: `${warehouseId}:${b.day}`,
        newValue: { ...b, expected: row?.bank?.expected ?? null, difference: diff ?? null },
        reason: b.note || null,
      });
      return row;
    });
    return NextResponse.json(day ?? null);
  } catch (err) {
    if (err instanceof NeedsNote) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
