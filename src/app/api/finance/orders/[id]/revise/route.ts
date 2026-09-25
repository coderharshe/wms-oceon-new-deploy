import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { buildRevision, BillRevisionError } from "@/lib/bill-revision";
import { UnpricedProductError } from "@/lib/pricing";
import { UnitError } from "@/lib/units";
import { claimIdempotencyKey, claimIdempotencyKeyDrizzle, DuplicateRequestError } from "@/lib/idempotency";

/**
 * Revises an already-created bill, including one that has been paid.
 *
 * The money side is the same path QC revisions take — applyBillRevisionAdjustment
 * moves the customer's receivable, restates amountDue, writes a PaymentAdjustment
 * and recomputes payment status, so an over-collection becomes REFUND_DUE and a
 * shortfall becomes PAYMENT_ADJUSTMENT_REQUIRED. Finance resolves that from the
 * order screen exactly as it already does for a QC adjustment.
 *
 * Stock follows the bill automatically. Before QC the order's reservation is
 * rebuilt at the new quantities; after QC the stock has already left, so the
 * difference is put back (or taken) as a MANUAL_ADJUSTMENT movement carrying
 * the order id, which is what makes the correction traceable later.
 */

const schema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().positive(),
        unitId: z.string(),
        discount: z.number().min(0).default(0),
        unitPrice: z.number().positive().optional(),
      })
    )
    .min(1),
  reason: z.string().trim().min(1, "Say why the bill is being revised"),
  // Offline-first Modify Bill (src/lib/offline-bills.ts): the revision may be
  // sent more than once, and long after it was made. clientRequestId makes a
  // re-send a no-op; expectedVersion is the bill version the edit was made
  // on, so an edit to a bill QC or a manager has since changed is refused
  // rather than silently overwriting their change. null = not checked.
  clientRequestId: z.string().uuid().optional(),
  expectedVersion: z.number().int().nullable().optional(),
});

/** The bill moved on since the offline edit was made — see expectedVersion above. */
class VersionConflictError extends Error {
  constructor(public currentVersion: number) {
    super(`This bill was changed by someone else (now version ${currentVersion}). Check it and redo your change.`);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Manager included deliberately: a manager must be able to correct a bill
  // without borrowing a finance login, and the version records who did it.
  const session = await requireRole(["ADMIN", "FINANCE", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  try {
    return isWorkersRuntime() ? await reviseDrizzle(session, id, body) : await revisePrisma(session, id, body);
  } catch (err) {
    if (err instanceof BillRevisionError || err instanceof UnitError || err instanceof UnpricedProductError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof VersionConflictError) {
      return NextResponse.json({ error: err.message, conflict: true, currentVersion: err.currentVersion }, { status: 409 });
    }
    // A re-sent revision the server already applied — nothing more to do.
    if (err instanceof DuplicateRequestError) return NextResponse.json({ duplicate: true });
    throw err;
  }
}

type Session = Exclude<Awaited<ReturnType<typeof requireRole>>, NextResponse>;
type Body = z.infer<typeof schema>;

async function revisePrisma(session: Session, idOrRequestId: string, body: Body) {
  const db = (await import("@/lib/db")).getDb();
  const { releaseOrderReservations, reserveStockBatch, adjustStock } = await import("@/lib/inventory");
  const { applyBillRevisionAdjustment } = await import("@/lib/payment-service");
  const { writeAudit } = await import("@/lib/audit");
  const { publish } = await import("@/lib/realtime");

  // The id may be the clientRequestId of a bill made offline — the PC queues
  // a revision to it before it ever learns the server's order id. The real id
  // always wins; the fallback only runs when no order has that id.
  const ord0 =
    (await db.order.findUnique({ where: { id: idOrRequestId }, select: { id: true, warehouseId: true } })) ??
    (await db.order.findUnique({ where: { clientRequestId: idOrRequestId }, select: { id: true, warehouseId: true } }));
  if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
  if (forbidden) return forbidden;
  const orderId = ord0.id;

  const result = await db.$transaction(async (tx) => {
    if (body.clientRequestId) await claimIdempotencyKey(tx, body.clientRequestId);
    // Order row first, then Bill — the same order cancel, refund and QC-start
    // lock in, so a revise can't deadlock them or land on an order that is
    // being cancelled. Status and currentVersion are read only after both
    // locks. Two revisions of one bill serialise here, so the second sees
    // the first's version and gets a 409 instead of a clash.
    //
    // QC completion takes neither lock up front: it reads the version,
    // inserts version N+1, then updates Bill and finally Order. If it races
    // us, the unique [billId, versionNumber] index is what makes the later of
    // the two fail and roll back (or, if QC already holds Bill and wants
    // Order, Postgres' deadlock detector aborts one side). Either way nothing
    // is overwritten; the loser gets a 500 and the queue retries it.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Bill" WHERE "orderId" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, bill: { include: { versions: { include: { items: true } } } } },
    });
    if (order.status === "CANCELLED") throw new BillRevisionError("This order is cancelled — it cannot be revised");
    const bill = order.bill;
    if (!bill) throw new BillRevisionError("This order has no bill yet — edit the draft instead");
    // Thrown, not returned: the rollback also releases the idempotency key,
    // so nothing at all is written for a refused edit.
    if (body.expectedVersion != null && bill.currentVersion !== body.expectedVersion) throw new VersionConflictError(bill.currentVersion);

    const currentVersion = bill.versions.find((v) => v.versionNumber === bill.currentVersion) ?? bill.versions.at(-1)!;

    const productIds = [...new Set([...body.items.map((i) => i.productId), ...order.items.map((i) => i.productId)])];
    const products = await tx.product.findMany({ where: { id: { in: productIds } }, include: { saleUnits: true } });

    const revision = buildRevision({
      items: body.items,
      sellingMode: order.sellingMode,
      products: new Map(products.map((p) => [p.id, p])),
      unitsByProduct: new Map(products.map((p) => [p.id, p.saleUnits])),
      previousItems: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitId: i.unitId })),
    });

    // ── stock ──────────────────────────────────────────────────────────
    // ACTIVE reservations mean QC has not consumed them yet, so the stock is
    // still on the shelf and only the reservation has to move.
    const active = await tx.stockReservation.count({ where: { orderId, status: "ACTIVE" } });
    if (active > 0) {
      await releaseOrderReservations(tx, orderId);
      await reserveStockBatch(tx, {
        orderId,
        warehouseId: order.warehouseId,
        userId: session.sub,
        lines: revision.lines
          .filter((l) => l.baseQty.gt(0))
          .map((l) => ({ productId: l.productId, baseQty: l.baseQty })),
      });
    } else {
      for (const [productId, delta] of revision.stockDeltas) {
        await adjustStock(tx, {
          productId,
          warehouseId: order.warehouseId,
          deltaBaseQty: delta.neg(), // billing more takes stock out, billing less puts it back
          movementType: "MANUAL_ADJUSTMENT",
          referenceType: "BILL_REVISION",
          referenceId: orderId,
          userId: session.sub,
        });
      }
    }

    // ── the new version ────────────────────────────────────────────────
    const nextVersionNumber = bill.currentVersion + 1;
    const version = await tx.billVersion.create({
      data: {
        billId: bill.id,
        versionNumber: nextVersionNumber,
        versionType: "FINANCE",
        subtotal: revision.totals.subtotal,
        discountTotal: revision.totals.discountTotal,
        taxTotal: revision.totals.taxTotal,
        total: revision.totals.total,
        createdByUserId: session.sub,
        reason: body.reason,
      },
    });
    await tx.billItem.createMany({
      data: revision.lines.map((l) => ({
        billVersionId: version.id,
        productId: l.productId,
        quantity: l.quantity,
        unitId: l.unitId,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
        changeType: l.changeType,
        previousQuantity: l.previousQuantity,
      })),
    });
    await tx.bill.update({ where: { id: bill.id }, data: { currentVersion: nextVersionNumber } });

    // The order's own lines are what the billing screen and stock checks read,
    // so they have to follow the bill or the two disagree from here on.
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.orderItem.createMany({
      data: revision.lines
        .filter((l) => l.quantity.gt(0))
        .map((l) => ({
          orderId,
          productId: l.productId,
          quantity: l.quantity,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
          discount: l.discount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
        })),
    });

    const outcome = await applyBillRevisionAdjustment(tx, {
      billId: bill.id,
      previousTotal: new Decimal(currentVersion.total),
      newTotal: revision.totals.total,
      warehouseId: order.warehouseId,
      orderId,
    });

    await writeAudit(
      {
        userId: session.sub,
        role: session.role,
        warehouseId: order.warehouseId,
        action: "BILL_REVISED",
        entityType: "Bill",
        entityId: bill.id,
        oldValue: { version: currentVersion.versionNumber, total: currentVersion.total.toString() },
        newValue: {
          version: nextVersionNumber,
          total: revision.totals.total.toString(),
          reason: body.reason,
          changes: revision.lines.filter((l) => l.changeType !== "KEPT").map((l) => `${l.productName}: ${l.previousQuantity ?? 0} -> ${l.quantity}`),
        },
      },
      tx
    );

    return { versionNumber: nextVersionNumber, total: revision.totals.total.toString(), status: outcome.status };
  });

  publish(`order:${orderId}`, "bill:revised", result);
  return NextResponse.json(result);
}

async function reviseDrizzle(session: Session, idOrRequestId: string, body: Body) {
  const { getDrizzleDb } = await import("@/lib/drizzle-db");
  const { order, orderItem, product, productUnit, bill, billVersion, billItem, stockReservation } = await import("@/generated/drizzle/schema");
  const { eq, and, inArray, desc } = await import("drizzle-orm");
  const { releaseOrderReservationsDrizzle, reserveStockBatchDrizzle, adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
  const { applyBillRevisionAdjustmentDrizzle } = await import("@/lib/drizzle-payment-service");
  const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
  const { publish } = await import("@/lib/realtime");
  const db = getDrizzleDb();

  // Same id-first, clientRequestId-fallback lookup as the Prisma path above.
  let [ord0] = await db.select({ id: order.id, warehouseId: order.warehouseId }).from(order).where(eq(order.id, idOrRequestId));
  if (!ord0) [ord0] = await db.select({ id: order.id, warehouseId: order.warehouseId }).from(order).where(eq(order.clientRequestId, idOrRequestId));
  if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
  if (forbidden) return forbidden;
  const orderId = ord0.id;

  const result = await db.transaction(async (tx) => {
    if (body.clientRequestId) await claimIdempotencyKeyDrizzle(tx, body.clientRequestId);
    // Lock Order, then Bill, then read both — see revisePrisma.
    await tx.select({ id: order.id }).from(order).where(eq(order.id, orderId)).for("update");
    const [b] = await tx.select().from(bill).where(eq(bill.orderId, orderId)).for("update");
    const [ord] = await tx.select().from(order).where(eq(order.id, orderId));
    if (!ord) throw new BillRevisionError("Order not found");
    if (ord.status === "CANCELLED") throw new BillRevisionError("This order is cancelled — it cannot be revised");

    if (!b) throw new BillRevisionError("This order has no bill yet — edit the draft instead");
    if (body.expectedVersion != null && b.currentVersion !== body.expectedVersion) throw new VersionConflictError(b.currentVersion);
    const [currentVersion] = await tx
      .select()
      .from(billVersion)
      .where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)))
      .orderBy(desc(billVersion.versionNumber))
      .limit(1);
    if (!currentVersion) throw new BillRevisionError("This bill has no current version");

    const prevItems = await tx.select().from(orderItem).where(eq(orderItem.orderId, orderId));
    const productIds = [...new Set([...body.items.map((i) => i.productId), ...prevItems.map((i) => i.productId)])];
    const products = await tx.select().from(product).where(inArray(product.id, productIds));
    const units = await tx.select().from(productUnit).where(inArray(productUnit.productId, productIds));
    const unitsByProduct = new Map<string, typeof units>();
    for (const u of units) unitsByProduct.set(u.productId, [...(unitsByProduct.get(u.productId) ?? []), u]);

    const revision = buildRevision({
      items: body.items,
      sellingMode: ord.sellingMode as "WHOLESALE" | "RETAIL",
      products: new Map(products.map((p) => [p.id, p])) as never,
      unitsByProduct: unitsByProduct as never,
      previousItems: prevItems.map((i) => ({ productId: i.productId, quantity: i.quantity, unitId: i.unitId })),
    });

    const activeRes = await tx
      .select({ id: stockReservation.id })
      .from(stockReservation)
      .where(and(eq(stockReservation.orderId, orderId), eq(stockReservation.status, "ACTIVE")));
    if (activeRes.length > 0) {
      await releaseOrderReservationsDrizzle(tx, orderId);
      await reserveStockBatchDrizzle(tx, {
        orderId,
        warehouseId: ord.warehouseId,
        userId: session.sub,
        lines: revision.lines.filter((l) => l.baseQty.gt(0)).map((l) => ({ productId: l.productId, baseQty: l.baseQty })),
      });
    } else {
      for (const [productId, delta] of revision.stockDeltas) {
        await adjustStockDrizzle(tx, {
          productId,
          warehouseId: ord.warehouseId,
          deltaBaseQty: delta.neg(),
          movementType: "MANUAL_ADJUSTMENT",
          referenceType: "BILL_REVISION",
          referenceId: orderId,
          userId: session.sub,
        });
      }
    }

    const nextVersionNumber = b.currentVersion + 1;
    const [newVersion] = await tx
      .insert(billVersion)
      .values({
        id: crypto.randomUUID(),
        billId: b.id,
        versionNumber: nextVersionNumber,
        versionType: "FINANCE",
        subtotal: revision.totals.subtotal.toString(),
        discountTotal: revision.totals.discountTotal.toString(),
        taxTotal: revision.totals.taxTotal.toString(),
        total: revision.totals.total.toString(),
        createdByUserId: session.sub,
        reason: body.reason,
      })
      .returning();

    await tx.insert(billItem).values(
      revision.lines.map((l) => ({
        id: crypto.randomUUID(),
        billVersionId: newVersion!.id,
        productId: l.productId,
        quantity: l.quantity.toString(),
        unitId: l.unitId,
        unitPrice: l.unitPrice.toString(),
        discount: l.discount.toString(),
        taxAmount: l.taxAmount.toString(),
        lineTotal: l.lineTotal.toString(),
        changeType: l.changeType,
        previousQuantity: l.previousQuantity?.toString() ?? null,
      }))
    );
    await tx.update(bill).set({ currentVersion: nextVersionNumber }).where(eq(bill.id, b.id));

    await tx.delete(orderItem).where(eq(orderItem.orderId, orderId));
    await tx.insert(orderItem).values(
      revision.lines
        .filter((l) => l.quantity.gt(0))
        .map((l) => ({
          id: crypto.randomUUID(),
          orderId,
          productId: l.productId,
          quantity: l.quantity.toString(),
          unitId: l.unitId,
          unitPrice: l.unitPrice.toString(),
          discount: l.discount.toString(),
          taxAmount: l.taxAmount.toString(),
          lineTotal: l.lineTotal.toString(),
        }))
    );

    const outcome = await applyBillRevisionAdjustmentDrizzle(tx, {
      billId: b.id,
      previousTotal: new Decimal(currentVersion.total),
      newTotal: revision.totals.total,
      warehouseId: ord.warehouseId,
      orderId,
    });

    await writeAuditDrizzle(
      {
        userId: session.sub,
        role: session.role,
        warehouseId: ord.warehouseId,
        action: "BILL_REVISED",
        entityType: "Bill",
        entityId: b.id,
        oldValue: { version: currentVersion.versionNumber, total: currentVersion.total },
        newValue: {
          version: nextVersionNumber,
          total: revision.totals.total.toString(),
          reason: body.reason,
          changes: revision.lines.filter((l) => l.changeType !== "KEPT").map((l) => `${l.productName}: ${l.previousQuantity ?? 0} -> ${l.quantity}`),
        },
      },
      tx
    );

    return { versionNumber: nextVersionNumber, total: revision.totals.total.toString(), status: outcome.status };
  });

  publish(`order:${orderId}`, "bill:revised", result);
  return NextResponse.json(result);
}
