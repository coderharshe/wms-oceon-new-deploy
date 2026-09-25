import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

/**
 * Zeroes every non-zero on-hand in the warehouse, plus or minus — for starting
 * a fresh count. One statement: the UPDATE locks and zeroes the rows, and the
 * INSERT writes a MANUAL_ADJUSTMENT movement per row, so the ledger still
 * explains every figure. Reservations are left alone unless `resetReserved`,
 * which zeroes them too and releases the ACTIVE reservation rows behind them.
 */
function query<T>(
  tag: (strings: TemplateStringsArray, ...values: unknown[]) => T,
  warehouseId: string,
  userId: string,
  resetReserved: boolean
): T {
  return tag`
    WITH old AS (
      SELECT id, "productId", "quantityOnHand" AS qty FROM "Inventory"
      WHERE "warehouseId" = ${warehouseId}
        AND ("quantityOnHand" <> 0 OR (${resetReserved}::boolean AND "quantityReserved" <> 0)) FOR UPDATE
    ), z AS (
      UPDATE "Inventory" i SET "quantityOnHand" = 0,
        "quantityReserved" = CASE WHEN ${resetReserved}::boolean THEN 0 ELSE i."quantityReserved" END
      FROM old WHERE i.id = old.id
      RETURNING old."productId", old.qty
    ), r AS (
      -- Zeroed holds are released too, so an old order finishing later cannot
      -- eat into a newer order's hold.
      UPDATE "StockReservation" SET status = 'RELEASED', "releasedAt" = now()
      WHERE ${resetReserved}::boolean AND "warehouseId" = ${warehouseId} AND status = 'ACTIVE'
    ), m AS (
      INSERT INTO "InventoryMovement"
        (id, "productId", "warehouseId", "beforeQty", "movementQty", "afterQty", "movementType", "referenceType", "referenceId", "userId", "timestamp")
      SELECT gen_random_uuid()::text, "productId", ${warehouseId}, qty, -qty, 0, 'MANUAL_ADJUSTMENT'::"MovementType", 'RESET_ALL', ${userId}, ${userId}, now()
      FROM z WHERE qty <> 0
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM z)::int AS n, (SELECT count(*) FROM m)::int AS moved`;
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const body = (await req.json().catch(() => ({}))) as { warehouseId?: string; resetReserved?: boolean };
  const warehouseId = session.role === "ADMIN" ? body.warehouseId ?? session.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  let n: number;
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { sql } = await import("drizzle-orm");
    const result = await getDrizzleDb().execute(query(sql, warehouseId, session.sub, body.resetReserved === true));
    n = (result.rows[0] as { n: number }).n;
  } else {
    const db = (await import("@/lib/db")).getDb();
    n = (await query<Promise<{ n: number }[]>>(db.$queryRaw.bind(db), warehouseId, session.sub, body.resetReserved === true))[0]!.n;
  }

  const audit = {
    userId: session.sub,
    role: session.role,
    action: "STOCK_RESET_ALL",
    entityType: "Inventory",
    entityId: warehouseId,
    newValue: { productsZeroed: n, reservedZeroed: body.resetReserved === true, warehouseId },
  };
  if (isWorkersRuntime()) await (await import("@/lib/drizzle-audit")).writeAuditDrizzle(audit);
  else await (await import("@/lib/audit")).writeAudit(audit);

  return NextResponse.json({ zeroed: n });
}
