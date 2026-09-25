import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { auditQ, recordCashMovement } from "@/lib/cash";
import { inTransaction } from "@/lib/cash-db";

// Cash moved by hand, not tied to a bill: taken to the bank (BANK_DEPOSIT —
// the bank reconciliation expects it to arrive there), paid out for an
// expense or to the owner (WITHDRAWAL), or put in (OTHER_RECEIPT). Without
// these, every such movement would show up as an unexplained difference.
const schema = z.object({
  type: z.enum(["BANK_DEPOSIT", "WITHDRAWAL", "OTHER_RECEIPT"]),
  amount: z.number().positive().max(1e10),
  note: z.string().trim().min(1, "Say what the cash was for").max(500),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  if (!session.warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const row = await inTransaction(async (q) => {
    const r = await recordCashMovement(q, { warehouseId: session.warehouseId!, userId: session.sub, ...parsed.data });
    await auditQ(q, {
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId!,
      action: "CASH_TRANSACTION_RECORDED",
      entityType: "CashTransaction",
      entityId: r.id,
      newValue: { type: parsed.data.type, amount: parsed.data.amount },
      reason: parsed.data.note,
    });
    return r;
  });
  return NextResponse.json(row, { status: 201 });
}
