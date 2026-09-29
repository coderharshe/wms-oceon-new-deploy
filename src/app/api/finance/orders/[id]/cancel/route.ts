import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { toBaseQty } from "@/lib/units";

// Cancellable statuses: DRAFT, BILLED, PAYMENT_PENDING, PAID, READY_FOR_QC, COMPLETED.
const CANCELLABLE = ["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID", "READY_FOR_QC", "COMPLETED"];
const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"];

// `refund` says what happened to money already collected, asked in the
// cancel dialog: given back in cash (out of the canceller's drawer), by UPI,
// kept as credit on the customer's account, or not yet (left on Finance's
// "Needs Refund" list, the old behaviour and still the default).
const REFUND = { CASH: "CASH_REFUND", UPI: "UPI_REFUND", CREDIT: "CUSTOMER_CREDIT" } as const;
const schema = z.object({
  reason: z.string().trim().min(1).optional(),
  refund: z.enum(["CASH", "UPI", "CREDIT", "LATER"]).default("LATER"),
});

/** Status/QC state changed between the pre-check and the row lock, or QC holds the order. */
class CancelConflictError extends Error {}
/** Money was already collected and no reason was given for reversing it. */
class ReasonRequiredError extends Error {}

// Reverses whatever was committed: releases any reserved stock (and restores on-hand
// inventory if the order was already completed/deducted), and if money
// was already collected, routes it through the refund-resolve flow.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  // Body is optional — an unpaid DRAFT/BILLED cancel needs no explanation.
  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const reason = parsed.data.reason ?? null;
  const resolution = parsed.data.refund === "LATER" ? null : REFUND[parsed.data.refund];

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, orderItem, bill, billVersion, billItem, payment, paymentAdjustment, qcSession, inventory, inventoryMovement, productUnit } = await import("@/generated/drizzle/schema");
      const { eq, and, inArray, isNull, desc } = await import("drizzle-orm");
      const { releaseOrderReservationsDrizzle } = await import("@/lib/drizzle-inventory");
      const { applyBillRevisionAdjustmentDrizzle, resolvePaymentAdjustmentDrizzle } = await import("@/lib/drizzle-payment-service");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const { publish } = await import("@/lib/realtime");
      const db = getDrizzleDb();

      const [ord0] = await db.select().from(order).where(eq(order.id, id));
      if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
      if (forbidden) return forbidden;

      const updated = await db.transaction(async (tx) => {
        // Lock and re-read the order INSIDE the transaction
        const [ord] = await tx.select().from(order).where(eq(order.id, ord0.id)).for("update");
        if (!CANCELLABLE.includes(ord!.status)) {
          throw new CancelConflictError(`Order is in status ${ord!.status}, cannot cancel from here`);
        }
        const [activeQc] = await tx
          .select({ id: qcSession.id })
          .from(qcSession)
          .where(and(eq(qcSession.orderId, ord!.id), inArray(qcSession.status, ACTIVE_SESSION as any)));
        if (activeQc) throw new CancelConflictError("QC is working on this order — release the QC session before cancelling");

        // Release any reservations still active
        await releaseOrderReservationsDrizzle(tx, ord!.id);

        const [b] = await tx.select().from(bill).where(eq(bill.orderId, ord!.id));

        // If the order was COMPLETED, stock was permanently deducted from onHand.
        // Return all line items back to quantityOnHand and record movement.
        if (ord!.status === "COMPLETED") {
          let linesToRestore: { productId: string; unitId: string; quantity: string }[] = [];
          if (b) {
            const [currentVer] = await tx
              .select()
              .from(billVersion)
              .where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)));
            if (currentVer) {
              const vItems = await tx
                .select()
                .from(billItem)
                .where(eq(billItem.billVersionId, currentVer.id));
              linesToRestore = vItems.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity }));
            }
          }
          if (linesToRestore.length === 0) {
            const oItems = await tx.select().from(orderItem).where(eq(orderItem.orderId, ord!.id));
            linesToRestore = oItems.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity }));
          }

          for (const item of linesToRestore) {
            const pUnits = await tx.select().from(productUnit).where(eq(productUnit.productId, item.productId));
            const baseQty = toBaseQty(
              pUnits.map((u) => ({ unitId: u.unitId, factorToBase: u.factorToBase, isBaseUnit: u.isBaseUnit })),
              item.unitId,
              item.quantity
            );

            const [inv] = await tx
              .select()
              .from(inventory)
              .where(and(eq(inventory.productId, item.productId), eq(inventory.warehouseId, ord!.warehouseId)));
            if (inv) {
              const before = new Decimal(inv.quantityOnHand);
              const after = before.add(baseQty);
              await tx
                .update(inventory)
                .set({ quantityOnHand: after.toString() })
                .where(eq(inventory.id, inv.id));

              await tx.insert(inventoryMovement).values({
                id: crypto.randomUUID(),
                productId: item.productId,
                warehouseId: ord!.warehouseId,
                beforeQty: before.toString(),
                movementQty: baseQty.toString(),
                afterQty: after.toString(),
                movementType: "RETURN",
                referenceType: "ORDER",
                referenceId: ord!.id,
                userId: session.sub,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }

        if (b) {
          const [pay] = await tx.select().from(payment).where(eq(payment.billId, b.id));
          if (pay && new Decimal(pay.amountPaid).gt(0)) {
            // Money already collected must never be reversed unexplained.
            if (!reason) throw new ReasonRequiredError("A reason is required to cancel an order that has been paid");
            const [currentVersion] = await tx
              .select()
              .from(billVersion)
              .where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)));
            if (currentVersion) {
              await applyBillRevisionAdjustmentDrizzle(tx, {
                billId: b.id,
                previousTotal: new Decimal(currentVersion.total),
                newTotal: new Decimal(0),
                warehouseId: ord!.warehouseId,
                orderId: ord!.id,
              });
            }
            if (resolution) {
              const [adj] = await tx
                .select({ id: paymentAdjustment.id })
                .from(paymentAdjustment)
                .where(and(eq(paymentAdjustment.billId, b.id), isNull(paymentAdjustment.resolutionType)))
                .orderBy(desc(paymentAdjustment.createdAt))
                .limit(1);
              if (adj) {
                await resolvePaymentAdjustmentDrizzle(tx, {
                  adjustmentId: adj.id,
                  resolutionType: resolution,
                  userId: session.sub,
                  notes: reason ?? undefined,
                  amount: new Decimal(pay.amountPaid),
                });
              }
            }
          }
        }

        const [result] = await tx
          .update(order)
          .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
          .where(eq(order.id, ord!.id))
          .returning();
        await writeAuditDrizzle(
          {
            userId: session.sub,
            role: session.role,
            warehouseId: ord!.warehouseId,
            action: "ORDER_CANCELLED",
            entityType: "Order",
            entityId: ord!.id,
            newValue: { refund: parsed.data.refund },
            reason,
          },
          tx
        );
        return result;
      });

      publish(`warehouse:${ord0.warehouseId}`, "order:cancelled", { orderId: ord0.id });
      publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const { releaseOrderReservations } = await import("@/lib/inventory");
    const { applyBillRevisionAdjustment, resolvePaymentAdjustment } = await import("@/lib/payment-service");
    const { writeAudit } = await import("@/lib/audit");
    const { publish } = await import("@/lib/realtime");

    const ord0 = await db.order.findUnique({ where: { id } });
    if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
    if (forbidden) return forbidden;

    const updated = await db.$transaction(async (tx) => {
      // Row lock
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${ord0.id} FOR UPDATE`;
      const ord = await tx.order.findUniqueOrThrow({ where: { id: ord0.id } });
      if (!CANCELLABLE.includes(ord.status)) {
        throw new CancelConflictError(`Order is in status ${ord.status}, cannot cancel from here`);
      }
      const activeQc = await tx.qcSession.findFirst({ where: { orderId: ord.id, status: { in: ACTIVE_SESSION as any } } });
      if (activeQc) throw new CancelConflictError("QC is working on this order — release the QC session before cancelling");

      // Release any active reservations
      await releaseOrderReservations(tx, ord.id);

      const bill = await tx.bill.findUnique({
        where: { orderId: ord.id },
        include: {
          payment: true,
          versions: {
            include: {
              items: true,
            },
          },
        },
      });

      // If the order was COMPLETED, stock was permanently deducted from onHand.
      // Return all line items back to quantityOnHand and record movement.
      if (ord.status === "COMPLETED") {
        let linesToRestore: { productId: string; unitId: string; quantity: any }[] = [];
        if (bill) {
          const currentVer = bill.versions.find((v) => v.versionNumber === bill.currentVersion);
          if (currentVer) {
            linesToRestore = currentVer.items.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity }));
          }
        }
        if (linesToRestore.length === 0) {
          const oItems = await tx.orderItem.findMany({ where: { orderId: ord.id } });
          linesToRestore = oItems.map((i) => ({ productId: i.productId, unitId: i.unitId, quantity: i.quantity }));
        }

        for (const item of linesToRestore) {
          const pUnits = await tx.productUnit.findMany({ where: { productId: item.productId } });
          const baseQty = toBaseQty(
            pUnits.map((u) => ({ unitId: u.unitId, factorToBase: u.factorToBase, isBaseUnit: u.isBaseUnit })),
            item.unitId,
            item.quantity
          );

          const inv = await tx.inventory.findUnique({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: ord.warehouseId } },
          });
          if (inv) {
            const before = inv.quantityOnHand;
            const after = before.add(baseQty);
            await tx.inventory.update({
              where: { id: inv.id },
              data: { quantityOnHand: after },
            });
            await tx.inventoryMovement.create({
              data: {
                productId: item.productId,
                warehouseId: ord.warehouseId,
                beforeQty: before,
                movementQty: baseQty,
                afterQty: after,
                movementType: "RETURN",
                referenceType: "ORDER",
                referenceId: ord.id,
                userId: session.sub,
              },
            });
          }
        }
      }

      if (bill?.payment && new Decimal(bill.payment.amountPaid).gt(0)) {
        // Money already collected must never be reversed unexplained.
        if (!reason) throw new ReasonRequiredError("A reason is required to cancel an order that has been paid");
        const currentVersion = bill.versions.find((v) => v.versionNumber === bill.currentVersion);
        if (currentVersion) {
          await applyBillRevisionAdjustment(tx, {
            billId: bill.id,
            previousTotal: new Decimal(currentVersion.total),
            newTotal: new Decimal(0),
            warehouseId: ord.warehouseId,
            orderId: ord.id,
          });
        }
        if (resolution) {
          const adj = await tx.paymentAdjustment.findFirst({ where: { billId: bill.id, resolutionType: null }, orderBy: { createdAt: "desc" } });
          if (adj) {
            await resolvePaymentAdjustment(tx, {
              adjustmentId: adj.id,
              resolutionType: resolution,
              userId: session.sub,
              notes: reason ?? undefined,
              amount: new Decimal(bill.payment.amountPaid),
            });
          }
        }
      }

      const result = await tx.order.update({ where: { id: ord.id }, data: { status: "CANCELLED" } });
      await writeAudit(
        {
          userId: session.sub,
          role: session.role,
          warehouseId: ord.warehouseId,
          action: "ORDER_CANCELLED",
          entityType: "Order",
          entityId: ord.id,
          newValue: { refund: parsed.data.refund },
          reason,
        },
        tx
      );
      return result;
    });

    publish(`warehouse:${ord0.warehouseId}`, "order:cancelled", { orderId: ord0.id });
    publish(`order:${ord0.id}`, "status:updated", { status: "CANCELLED" });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ReasonRequiredError) return NextResponse.json({ error: err.message, reasonRequired: true }, { status: 400 });
    if (err instanceof CancelConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
