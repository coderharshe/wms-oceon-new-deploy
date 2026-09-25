import { NextResponse } from "next/server";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { assertValidUnit, toBaseQty, UnitError } from "@/lib/units";
import { DuplicateRequestError } from "@/lib/idempotency";
import { GST_ENTITY_TYPE, GST_ISSUED, GST_DEDUCTED_LATER, type GstInvoiceRecord } from "@/lib/gst-register";

/**
 * Moves the stock for a GST invoice that was issued without deducting it —
 * the "Deduct now" button on the register, for when the box was forgotten.
 *
 * The guard is an idempotency key, not a "have we already?" read: two clicks
 * (or a double-submit on a slow connection) would both pass a check-then-act
 * and deduct the goods twice. `gst-deduct:<invoiceNo>` is claimed inside the
 * same transaction as the movements, so exactly one attempt can ever win.
 */

class NotFound extends Error {}
class AlreadyDeducted extends Error {}
class ShortfallError extends Error {}

export async function POST(_req: Request, { params }: { params: Promise<{ invoiceNo: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { invoiceNo } = await params;

  try {
    const moved = isWorkersRuntime() ? await runDrizzle(session, invoiceNo) : await runPrisma(session, invoiceNo);
    if (isErrorResponse(moved)) return moved;
    return NextResponse.json({ ok: true, invoiceNo, lines: moved });
  } catch (err) {
    if (err instanceof NotFound) return NextResponse.json({ error: "No such GST invoice at this warehouse" }, { status: 404 });
    if (err instanceof AlreadyDeducted || err instanceof DuplicateRequestError)
      return NextResponse.json({ error: "Stock for this invoice has already been deducted" }, { status: 409 });
    if (err instanceof ShortfallError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof UnitError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

type Session = Exclude<Awaited<ReturnType<typeof requireRole>>, NextResponse>;

/** Shared precondition check: the invoice exists here, has replayable lines,
 *  and has not already had its stock moved either way. */
function vet(issued: { newValue: unknown; warehouseId: string | null } | undefined, alreadyLater: boolean) {
  if (!issued) throw new NotFound();
  const rec = (issued.newValue ?? {}) as Partial<GstInvoiceRecord>;
  if (rec.stockDeducted || alreadyLater) throw new AlreadyDeducted();
  const items = rec.items ?? [];
  // Invoices issued before the register stored line detail cannot be replayed.
  if (!items.length) throw new NotFound();
  return items;
}

async function runPrisma(session: Session, invoiceNo: string) {
  const db = (await import("@/lib/db")).getDb();
  const { adjustStock } = await import("@/lib/inventory");
  const { writeAudit } = await import("@/lib/audit");
  const { claimIdempotencyKey } = await import("@/lib/idempotency");

  const logs = await db.auditLog.findMany({ where: { entityType: GST_ENTITY_TYPE, entityId: invoiceNo } });
  const issued = logs.find((l) => l.action === GST_ISSUED);
  const items = vet(issued, logs.some((l) => l.action === GST_DEDUCTED_LATER));

  const forbidden = issued!.warehouseId ? assertWarehouseAccess(session, issued!.warehouseId) : null;
  if (forbidden) return forbidden;
  const warehouseId = issued!.warehouseId;
  if (!warehouseId) throw new NotFound();

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.product.findMany({ where: { id: { in: productIds } }, include: { saleUnits: true } });
  const byId = new Map(products.map((p) => [p.id, p]));

  await db.$transaction(async (tx) => {
    await claimIdempotencyKey(tx, `gst-deduct:${invoiceNo}`);
    for (const it of items) {
      const p = byId.get(it.productId);
      if (!p) throw new NotFound();
      assertValidUnit(p.saleUnits, it.unitId);
      const { after } = await adjustStock(tx, {
        productId: it.productId,
        warehouseId,
        deltaBaseQty: toBaseQty(p.saleUnits, it.unitId, it.quantity).neg(),
        movementType: "SALE",
        referenceType: "GST_INVOICE",
        referenceId: invoiceNo,
        userId: session.sub,
      });
      if (after.lessThan(new Decimal(0))) throw new ShortfallError(`Not enough stock for ${p.name}`);
    }
  });

  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId,
    action: GST_DEDUCTED_LATER,
    entityType: GST_ENTITY_TYPE,
    entityId: invoiceNo,
    newValue: { lines: items.length, deductedAt: new Date().toISOString() },
    reason: "Stock moved from the GST invoice register after the invoice was issued without it",
  });
  return items.length;
}

async function runDrizzle(session: Session, invoiceNo: string) {
  const { getDrizzleDb } = await import("@/lib/drizzle-db");
  const { auditLog, product, productUnit } = await import("@/generated/drizzle/schema");
  const { eq, and, inArray } = await import("drizzle-orm");
  const { adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
  const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
  const { claimIdempotencyKeyDrizzle } = await import("@/lib/idempotency");
  const db = getDrizzleDb();

  const logs = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, GST_ENTITY_TYPE), eq(auditLog.entityId, invoiceNo)));
  const issued = logs.find((l) => l.action === GST_ISSUED);
  const items = vet(issued, logs.some((l) => l.action === GST_DEDUCTED_LATER));

  const forbidden = issued!.warehouseId ? assertWarehouseAccess(session, issued!.warehouseId) : null;
  if (forbidden) return forbidden;
  const warehouseId = issued!.warehouseId;
  if (!warehouseId) throw new NotFound();

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.select().from(product).where(inArray(product.id, productIds));
  const units = await db.select().from(productUnit).where(inArray(productUnit.productId, productIds));
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  if (products.length !== productIds.length) throw new NotFound();

  await db.transaction(async (tx) => {
    await claimIdempotencyKeyDrizzle(tx, `gst-deduct:${invoiceNo}`);
    for (const it of items) {
      const us = units.filter((u) => u.productId === it.productId);
      assertValidUnit(us, it.unitId);
      const { after } = await adjustStockDrizzle(tx, {
        productId: it.productId,
        warehouseId,
        deltaBaseQty: toBaseQty(us, it.unitId, it.quantity).neg(),
        movementType: "SALE",
        referenceType: "GST_INVOICE",
        referenceId: invoiceNo,
        userId: session.sub,
      });
      if (after.lessThan(new Decimal(0))) throw new ShortfallError(`Not enough stock for ${nameOf.get(it.productId) ?? "product"}`);
    }
  });

  await writeAuditDrizzle({
    userId: session.sub,
    role: session.role,
    warehouseId,
    action: GST_DEDUCTED_LATER,
    entityType: GST_ENTITY_TYPE,
    entityId: invoiceNo,
    newValue: { lines: items.length, deductedAt: new Date().toISOString() },
    reason: "Stock moved from the GST invoice register after the invoice was issued without it",
  });
  return items.length;
}
