import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { inTransaction } from "@/lib/cash-db";

/** Every movement in one drawer session, with the bill each sale/refund came from. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const out = await inTransaction(async (q) => {
    const [s] = await q<{ warehouseId: string }>`SELECT "warehouseId" FROM "CashSession" WHERE id = ${id}`;
    if (!s) return null;
    const forbidden = assertWarehouseAccess(session, s.warehouseId);
    if (forbidden) return forbidden;
    return q`
      SELECT t.type::text AS type, t.amount::text AS amount, t.note, t.timestamp::text AS at, b."billNumber", o.id AS "orderId"
        FROM "CashTransaction" t
        LEFT JOIN "PaymentTransaction" pt ON pt.id = t."referenceId"
        LEFT JOIN "Payment" p ON p.id = pt."paymentId"
        LEFT JOIN "Bill" b ON b.id = p."billId"
        LEFT JOIN "Order" o ON o.id = b."orderId"
       WHERE t."cashSessionId" = ${id}
       ORDER BY t.timestamp`;
  });
  if (out === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (out instanceof NextResponse) return out;
  return NextResponse.json(out);
}
