import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// A manager overriding a product's reserved figure — e.g. clearing holds left by
// orders that will never complete. The reservation rows themselves are left
// alone unless the figure is set to 0 (see query). Like /adjust, the client sends
// the figure its screen showed, and the UPDATE only lands if the row still
// holds it — otherwise 409 and the manager re-reads.
const schema = z.object({
  productId: z.string(),
  warehouseId: z.string().optional(), // ADMIN only
  reservedQty: z.number().min(0).max(1e10),
  expectedReserved: z.string().regex(/^-?\d+(\.\d+)?$/),
});

function query<T>(tag: (strings: TemplateStringsArray, ...values: unknown[]) => T, a: { productId: string; warehouseId: string; qty: string; expected: string }): T {
  // Setting 0 also releases the product's ACTIVE holds, so an old order
  // finishing later cannot eat into a newer order's hold. A non-zero figure
  // can't be tied to particular orders, so their rows are left as they are.
  return tag`
    WITH u AS (
      UPDATE "Inventory" SET "quantityReserved" = ${a.qty}::numeric
      WHERE "productId" = ${a.productId} AND "warehouseId" = ${a.warehouseId} AND "quantityReserved" = ${a.expected}::numeric
      RETURNING "quantityReserved"::text AS reserved
    ), r AS (
      UPDATE "StockReservation" SET status = 'RELEASED', "releasedAt" = now()
      WHERE EXISTS (SELECT 1 FROM u WHERE reserved::numeric = 0)
        AND "productId" = ${a.productId} AND "warehouseId" = ${a.warehouseId} AND status = 'ACTIVE'
    )
    SELECT reserved FROM u`;
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const warehouseId = session.role === "ADMIN" ? input.warehouseId ?? session.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  const args = { productId: input.productId, warehouseId, qty: String(input.reservedQty), expected: input.expectedReserved };
  let rows: { reserved: string }[];
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { sql } = await import("drizzle-orm");
    rows = (await getDrizzleDb().execute(query(sql, args))).rows as { reserved: string }[];
  } else {
    const db = (await import("@/lib/db")).getDb();
    rows = await query<Promise<{ reserved: string }[]>>(db.$queryRaw.bind(db), args);
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "Reserved stock changed (or product not found) — refresh and try again" }, { status: 409 });
  }

  const audit = {
    userId: session.sub,
    role: session.role,
    action: "RESERVED_ADJUSTED",
    entityType: "Inventory",
    entityId: input.productId,
    oldValue: { reserved: input.expectedReserved },
    newValue: { reserved: rows[0]!.reserved, warehouseId },
  };
  if (isWorkersRuntime()) await (await import("@/lib/drizzle-audit")).writeAuditDrizzle(audit);
  else await (await import("@/lib/audit")).writeAudit(audit);

  return NextResponse.json({ reserved: rows[0]!.reserved });
}
