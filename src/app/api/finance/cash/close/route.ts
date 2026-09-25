import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { auditQ, countDrawer } from "@/lib/cash";
import { inTransaction } from "@/lib/cash-db";

// The end-of-day count: the one job the counter has. The drawer is theirs, so
// there is no session id to pass — it is whatever is open for them now (or an
// empty one, which is how a first opening float gets counted in).
const schema = z.object({
  actualCash: z.number().min(0).max(1e10),
  note: z.string().trim().max(500).optional(),
  // Notes/coins as counted, kept on the audit entry only.
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  if (!session.warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the cash counted" }, { status: 400 });
  const { actualCash, note, denominations } = parsed.data;

  const result = await inTransaction(async (q) => {
    const r = await countDrawer(q, { warehouseId: session.warehouseId!, userId: session.sub, counted: actualCash, note: note || null });
    await auditQ(q, {
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId!,
      action: "CASH_SESSION_CLOSED",
      entityType: "CashSession",
      entityId: r.id,
      newValue: { ...r, denominations },
      reason: note || null,
    });
    return r;
  });
  return NextResponse.json(result);
}
