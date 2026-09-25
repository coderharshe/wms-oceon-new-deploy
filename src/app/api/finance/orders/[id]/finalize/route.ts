import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { shortfallIssues, sumBillTotals } from "@/lib/pricing";
import { toBaseQty } from "@/lib/units";
import { isWorkersRuntime } from "@/lib/cf-env";
import { applyReceivableDelta, recordCashPayment } from "@/lib/payment-service";
import { applyReceivableDeltaDrizzle, recordCashPaymentDrizzle } from "@/lib/drizzle-payment-service";
import { completeIfQcOff } from "@/lib/complete-without-qc";

// Turns a DRAFT order into a real bill: reserves stock and creates the Bill
// / BillVersion(FINANCE) / BillItem / Payment rows, using the OrderItem rows
// (and the prices they locked in) exactly as saved when the draft was made —
// same shape as the direct-create path in POST /api/finance/orders, just
// operating on an existing order instead of a fresh one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  // Same rule as a bill made at the counter: paid as it prints, unless the
  // caller says this one goes on credit. No body at all means paid.
  const unpaid = await req.json().then((b) => !!(b as { unpaid?: boolean })?.unpaid).catch(() => false);

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, orderItem, product, productUnit, bill, billVersion, billItem, payment } = await import("@/generated/drizzle/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const { nextNumberDrizzle } = await import("@/lib/drizzle-numbering");
    const { reserveStockBatchDrizzle } = await import("@/lib/drizzle-inventory");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const { publish } = await import("@/lib/realtime");
    const db = getDrizzleDb();

    const [ord0] = await db.select().from(order).where(eq(order.id, id));
    if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
    if (forbidden) return forbidden;
    if (ord0.status !== "DRAFT") return NextResponse.json({ error: `Order is in status ${ord0.status}, not a draft` }, { status: 409 });

    const result = await db.transaction(async (tx) => {
      const items = await tx.select().from(orderItem).where(eq(orderItem.orderId, ord0.id));
      const productIds = [...new Set(items.map((i) => i.productId))];
      const saleUnits = productIds.length ? await tx.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : [];
      const saleUnitsByProduct = new Map<string, typeof saleUnits>();
      for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), su]);

      // Never refuses: short stock reserves anyway and comes back to be
      // recorded on the order. Finalising a draft must not be the step that
      // strands a customer who is already at the counter.
      const short = await reserveStockBatchDrizzle(tx, {
        warehouseId: ord0.warehouseId,
        orderId: ord0.id,
        userId: session.sub,
        lines: items.map((item) => ({
          productId: item.productId,
          baseQty: toBaseQty((saleUnitsByProduct.get(item.productId) ?? []) as any, item.unitId, item.quantity),
        })),
      });
      const names = short.length
        ? new Map((await tx.select().from(product).where(inArray(product.id, short.map((s) => s.productId)))).map((p) => [p.id, p.name]))
        : new Map<string, string>();
      const issues = shortfallIssues(short, (id) => names.get(id) ?? id);

      const totals = sumBillTotals(items);
      const billNumber = await nextNumberDrizzle(tx, "bill", "INV");
      const [newBill] = await tx
        .insert(bill)
        .values({ id: crypto.randomUUID(), billNumber, orderId: ord0.id, warehouseId: ord0.warehouseId, paymentStatus: "UNPAID", currentVersion: 1 })
        .returning();
      const [version] = await tx
        .insert(billVersion)
        .values({
          id: crypto.randomUUID(),
          billId: newBill!.id,
          versionNumber: 1,
          versionType: "FINANCE",
          subtotal: totals.subtotal.toString(),
          discountTotal: totals.discountTotal.toString(),
          taxTotal: totals.taxTotal.toString(),
          total: totals.total.toString(),
          createdByUserId: session.sub,
        })
        .returning();
      await tx.insert(billItem).values(
        items.map((i) => ({
          id: crypto.randomUUID(),
          billVersionId: version!.id,
          productId: i.productId,
          quantity: i.quantity,
          unitId: i.unitId,
          unitPrice: i.unitPrice,
          discount: i.discount,
          taxAmount: i.taxAmount,
          lineTotal: i.lineTotal,
          changeType: "KEPT" as const,
        }))
      );
      const [pay] = await tx.insert(payment).values({ id: crypto.randomUUID(), billId: newBill!.id, amountDue: totals.total.toString(), amountPaid: "0" }).returning();
      // A finalized draft becomes a real unpaid bill — raise the receivable
      // here, exactly as the direct-billing route does.
      await applyReceivableDeltaDrizzle(tx, ord0.customerId, { due: 0, paid: 0 }, { due: totals.total, paid: 0 });
      const [updatedOrder] = await tx
        .update(order)
        .set({
          status: "BILLED",
          updatedAt: new Date().toISOString(),
          // Adds to whatever the draft was already flagged for, rather than
          // replacing it — both problems are still the manager's to clear.
          ...(issues.length
            ? { needsReview: true, reviewNotes: [ord0.reviewNotes, ...issues].filter(Boolean).join("\n") }
            : {}),
        })
        .where(eq(order.id, ord0.id))
        .returning();

      // After the status write above, not before: settling the bill moves the
      // order to PAID, and a "BILLED" written afterwards would undo it.
      if (!unpaid && totals.total.gt(0)) {
        await recordCashPaymentDrizzle(tx, { billId: newBill!.id, amountReceived: totals.total, userId: session.sub, warehouseId: ord0.warehouseId, orderId: ord0.id });
      }

      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: ord0.warehouseId,
        action: "BILL_CREATED",
        entityType: "Bill",
        entityId: newBill!.id,
        newValue: { billNumber, total: totals.total.toString(), orderId: ord0.id },
      }, tx);

      return { order: updatedOrder, bill: { ...newBill, versions: [{ ...version, items: [] }], payment: pay } };
    });

    publish(`warehouse:${ord0.warehouseId}`, "order:created", { orderId: result.order!.id });
    if (!unpaid) await completeIfQcOff(ord0.id, session.sub);
    return NextResponse.json(result);
  }

  const db = (await import("@/lib/db")).getDb();
  const { nextNumber } = await import("@/lib/numbering");
  const { reserveStockBatch } = await import("@/lib/inventory");
  const { writeAudit } = await import("@/lib/audit");
  const { publish } = await import("@/lib/realtime");

  const ord0 = await db.order.findUnique({ where: { id } });
  if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
  if (forbidden) return forbidden;
  if (ord0.status !== "DRAFT") return NextResponse.json({ error: `Order is in status ${ord0.status}, not a draft` }, { status: 409 });

  const result = await db.$transaction(
    async (tx) => {
      const items = await tx.orderItem.findMany({ where: { orderId: ord0.id }, include: { product: { include: { saleUnits: true } } } });

      // Batched + sorted-order locking, same deadlock reasoning as the
      // order-creation route and the Drizzle path above.
      const short = await reserveStockBatch(tx, {
        warehouseId: ord0.warehouseId,
        orderId: ord0.id,
        userId: session.sub,
        lines: items.map((item) => ({
          productId: item.productId,
          baseQty: toBaseQty(item.product.saleUnits, item.unitId, item.quantity),
        })),
      });
      const nameOf = new Map(items.map((i) => [i.productId, i.product.name]));
      const issues = shortfallIssues(short, (id) => nameOf.get(id) ?? id);

      const totals = sumBillTotals(items);
      const billNumber = await nextNumber(tx, "bill", "INV");
      const bill = await tx.bill.create({
        data: {
          billNumber,
          orderId: ord0.id,
          warehouseId: ord0.warehouseId,
          paymentStatus: "UNPAID",
          currentVersion: 1,
          versions: {
            create: {
              versionNumber: 1,
              versionType: "FINANCE",
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              total: totals.total,
              createdByUserId: session.sub,
              items: {
                create: items.map((i) => ({
                  productId: i.productId,
                  quantity: i.quantity,
                  unitId: i.unitId,
                  unitPrice: i.unitPrice,
                  discount: i.discount,
                  taxAmount: i.taxAmount,
                  lineTotal: i.lineTotal,
                  changeType: "KEPT",
                })),
              },
            },
          },
          payment: { create: { amountDue: totals.total, amountPaid: 0 } },
        },
        include: { versions: { include: { items: true } }, payment: true },
      });
      // A finalized draft becomes a real unpaid bill — raise the receivable.
      await applyReceivableDelta(tx, ord0.customerId, { due: 0, paid: 0 }, { due: totals.total, paid: 0 });
      const order = await tx.order.update({
        where: { id: ord0.id },
        data: {
          status: "BILLED",
          ...(issues.length
            ? { needsReview: true, reviewNotes: [ord0.reviewNotes, ...issues].filter(Boolean).join("\n") }
            : {}),
        },
      });

      // After the status write above, not before: settling the bill moves the
      // order to PAID, and a "BILLED" written afterwards would undo it.
      if (!unpaid && totals.total.gt(0)) {
        await recordCashPayment(tx, { billId: bill.id, amountReceived: totals.total, userId: session.sub, warehouseId: ord0.warehouseId, orderId: ord0.id });
      }

      await writeAudit(
        {
          userId: session.sub,
          role: session.role,
          warehouseId: ord0.warehouseId,
          action: "BILL_CREATED",
          entityType: "Bill",
          entityId: bill.id,
          newValue: { billNumber, total: totals.total.toString(), orderId: ord0.id },
        },
        tx
      );

      return { order, bill };
    },
    { timeout: 15000 }
  );

  publish(`warehouse:${ord0.warehouseId}`, "order:created", { orderId: result.order.id });
  if (!unpaid) await completeIfQcOff(ord0.id, session.sub);
  return NextResponse.json(result);
}
