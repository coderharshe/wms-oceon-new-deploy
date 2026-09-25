import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";
import { markUnpaid, MarkUnpaidError } from "@/lib/mark-unpaid";
import { publish } from "@/lib/realtime";

const schema = z.object({ reason: z.string().trim().min(1) });

/** Undo a cash payment the counter recorded for a bill that actually went on credit. See src/lib/mark-unpaid.ts. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say why the bill is being marked unpaid" }, { status: 400 });

  try {
    const out = await inTransaction((q) =>
      markUnpaid(q, { orderId: id, reason: parsed.data.reason, session, canAccess: (w) => !assertWarehouseAccess(session, w) }),
    );
    if (out.forbidden) return NextResponse.json({ error: "Forbidden: cross-warehouse access" }, { status: 403 });
    publish(`order:${out.orderId}`, "payment:updated", { billId: out.billId, status: "UNPAID", amountPaid: "0" });
    publish(`warehouse:${out.warehouseId}`, "payment:updated", { orderId: out.orderId, billId: out.billId, status: "UNPAID" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MarkUnpaidError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
