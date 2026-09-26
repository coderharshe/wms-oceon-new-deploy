import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// Correcting what the shelf actually holds. Receiving stock goes through
// /api/inventory/purchase-bills — that is the only way stock *arrives*, and
// this route deliberately cannot replace it (no supplier, no cost, no GRN).
// This is for the other half: a stock count that disagrees with the system,
// damage, expiry, and putting right the negative on-hand a mis-sequenced
// sale leaves behind.
//
// The client sends the count it took, not a delta, because that is what the
// person is holding — but it also sends the on-hand figure its screen was
// showing. If the real row has moved since (a sale landed while the count was
// being typed), the numbers no longer describe the same reality, so the
// transaction is rolled back and the manager re-counts against fresh figures
// rather than silently overwriting someone else's movement.
const schema = z.object({
  productId: z.string(),
  warehouseId: z.string().optional(), // ADMIN only; forced to own warehouse otherwise
  countedQty: z.number().min(0), // in the product's base unit, matching the Stock table
  expectedOnHand: z.number(),
  movementType: z.enum(["STOCK_COUNT_ADJUSTMENT", "DAMAGE", "EXPIRY", "MANUAL_ADJUSTMENT"]),
  note: z.string().max(200).optional(),
});

class StaleCountError extends Error {}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const warehouseId = session.role === "ADMIN" ? input.warehouseId ?? session.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  const expected = new Decimal(input.expectedOnHand);
  const delta = new Decimal(input.countedQty).sub(expected);
  if (delta.isZero()) return NextResponse.json({ error: "Counted quantity matches the system — nothing to adjust" }, { status: 400 });

  const audit = {
    userId: session.sub,
    role: session.role,
    action: "STOCK_ADJUSTED",
    entityType: "Inventory",
    entityId: input.productId,
    oldValue: { onHand: expected.toString() },
    newValue: { onHand: input.countedQty.toString(), movementType: input.movementType, note: input.note ?? null, warehouseId },
  };

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const result = await getDrizzleDb().transaction(async (tx) => {
        const moved = await adjustStockDrizzle(tx, {
          productId: input.productId,
          warehouseId,
          deltaBaseQty: delta,
          movementType: input.movementType,
          referenceType: "ADJUSTMENT",
          referenceId: session.sub,
          userId: session.sub,
        });
        if (!moved.before.equals(expected)) throw new StaleCountError();
        return moved;
      });
      await writeAuditDrizzle(audit);
      return NextResponse.json({ before: result.before.toString(), after: result.after.toString() });
    }

    const db = (await import("@/lib/db")).getDb();
    const { adjustStock } = await import("@/lib/inventory");
    const result = await db.$transaction(async (tx) => {
      const moved = await adjustStock(tx, {
        productId: input.productId,
        warehouseId,
        deltaBaseQty: delta,
        movementType: input.movementType,
        referenceType: "ADJUSTMENT",
        referenceId: session.sub,
        userId: session.sub,
      });
      if (!moved.before.equals(expected)) throw new StaleCountError();
      return moved;
    });
    await (await import("@/lib/audit")).writeAudit(audit);
    return NextResponse.json({ before: result.before.toString(), after: result.after.toString() });
  } catch (err) {
    if (err instanceof StaleCountError) {
      return NextResponse.json({ error: "Stock changed while you were counting — refresh and count again" }, { status: 409 });
    }
    throw err;
  }
}
