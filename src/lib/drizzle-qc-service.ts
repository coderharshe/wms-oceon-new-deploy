import { Decimal } from "@prisma/client/runtime/library";
import { eq, and, inArray } from "drizzle-orm";
import { qcSession, bill, billVersion, billItem, product, productUnit, qcAdjustment, order } from "@/generated/drizzle/schema";
import type { getDrizzleDb } from "./drizzle-db";
import { toBaseQty } from "./units";
import { sumBillTotals, resolveUnitPrice } from "./pricing";
import { finalizeQcDeductionDrizzle } from "./drizzle-inventory";
import { applyBillRevisionAdjustmentDrizzle } from "./drizzle-payment-service";
import { writeAuditDrizzle } from "./drizzle-audit";
import { publish } from "./realtime";
import { notifyDrizzle } from "./drizzle-notifications";

type Db = import("./drizzle-db").DrizzleDbOrTx;
type QcAction = "KEEP" | "REDUCE" | "REMOVE" | "MARK_UNAVAILABLE";

export type LineDecision = { productId: string; action: QcAction; finalQty: number; reason?: string };

export type CompleteResult =
  | { ok: true; orderStatus: string; total: string; paymentStatus: string }
  | { ok: false; kind: "blocked"; lines: { productId: string; productName: string; detail: string }[] };

type ResolvedLine = {
  productId: string;
  unitId: string;
  originalQty: Decimal;
  finalQty: Decimal;
  action: QcAction;
  reason: string | null;
  changeType: "KEPT" | "REDUCED" | "REMOVED" | "UNAVAILABLE";
  reservedBaseQty: Decimal;
};

/** Drizzle equivalent of src/lib/qc-service.ts — same evaluate-then-commit design (PRD §36). */
async function evaluate(db: Db, args: { sessionId: string; lineDecisions: LineDecision[] }) {
  const [session] = await db.select().from(qcSession).where(eq(qcSession.id, args.sessionId));
  if (!session) throw new Error("QC session not found");
  const [ord] = await db.select().from(order).where(eq(order.id, session.orderId));
  if (!ord) throw new Error("Order not found");
  const [b] = await db.select().from(bill).where(eq(bill.orderId, session.orderId));
  if (!b) throw new Error("Bill not found");
  const [currentVersion] = await db.select().from(billVersion).where(and(eq(billVersion.billId, b.id), eq(billVersion.versionNumber, b.currentVersion)));
  if (!currentVersion) throw new Error("Bill version not found");
  const currentItems = await db.select().from(billItem).where(eq(billItem.billVersionId, currentVersion.id));
  const warehouseId = ord.warehouseId;

  const productIds = currentItems.map((i) => i.productId);
  const products = productIds.length ? await db.select().from(product).where(inArray(product.id, productIds)) : [];
  const productMap = new Map(products.map((p) => [p.id, p]));
  const saleUnits = productIds.length ? await db.select().from(productUnit).where(inArray(productUnit.productId, productIds)) : [];
  const saleUnitsByProduct = new Map<string, typeof saleUnits>();
  for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), su]);

  const blocked: { productId: string; productName: string; detail: string }[] = [];
  const resolved: ResolvedLine[] = [];

  for (const item of currentItems) {
    const decision = args.lineDecisions.find((d) => d.productId === item.productId);
    const p = productMap.get(item.productId);
    if (!p) continue;
    const originalQty = new Decimal(item.quantity);
    const finalQty = decision ? new Decimal(decision.finalQty) : originalQty;
    const action: QcAction = decision?.action ?? "KEEP";
    const changed = !finalQty.equals(originalQty) || action === "MARK_UNAVAILABLE";

    if (finalQty.gt(originalQty)) {
      blocked.push({ productId: item.productId, productName: p.name, detail: "QC can only reduce quantity, not increase it" });
      continue;
    }
    if (changed && !decision?.reason) {
      blocked.push({ productId: item.productId, productName: p.name, detail: "Reason is required" });
      continue;
    }

    const changeType: ResolvedLine["changeType"] = !changed ? "KEPT" : finalQty.isZero() ? (action === "MARK_UNAVAILABLE" ? "UNAVAILABLE" : "REMOVED") : "REDUCED";
    resolved.push({
      productId: item.productId,
      unitId: item.unitId,
      originalQty,
      finalQty,
      action,
      reason: decision?.reason ?? null,
      changeType,
      reservedBaseQty: toBaseQty((saleUnitsByProduct.get(item.productId) ?? []) as any, item.unitId, originalQty),
    });
  }

  return { session, order: ord, bill: b, currentVersion, currentItems, productMap, saleUnitsByProduct, warehouseId, blocked, resolved };
}

export async function completeQcSessionDrizzle(
  db: Db,
  args: { sessionId: string; userId: string; lineDecisions: LineDecision[]; scanVerification?: import("./qc-service").ScanVerification }
): Promise<CompleteResult> {
  const first = await evaluate(db, args);
  if (first.session.status === "COMPLETED") throw new Error("QC session already completed");
  if (first.blocked.length > 0) return { ok: false, kind: "blocked", lines: first.blocked };

  const committed = await db.transaction(async (tx) => {
    // Lock the QcSession row BEFORE reading it: the status check above ran
    // outside the transaction, so without this two overlapping completes both
    // pass it and both deduct stock. Serialise on the row, then re-read.
    await tx.select({ id: qcSession.id }).from(qcSession).where(eq(qcSession.id, args.sessionId)).for("update");
    const { session: locked, bill: b, currentVersion, currentItems, productMap, saleUnitsByProduct, warehouseId, blocked, resolved } = await evaluate(tx, args);
    if (locked.status === "COMPLETED") throw new Error("QC session already completed");
    if (blocked.length > 0) throw new Error("CHANGE_BLOCKED");

    const lineTotals = resolved.map((r) => {
      const p = productMap.get(r.productId)!;
      const originalItem = currentItems.find((i) => i.productId === r.productId);
      const unitPrice = originalItem ? new Decimal(originalItem.unitPrice) : resolveUnitPrice(p, first.session ? first.order.sellingMode : "RETAIL");
      const discount = originalItem ? new Decimal(originalItem.discount) : new Decimal(0);
      const gross = r.finalQty.mul(unitPrice).sub(discount);
      const taxAmount = gross.mul(new Decimal(p.taxPercent).div(100));
      return { r, product: p, unitPrice, discount, taxAmount, lineTotal: gross.add(taxAmount) };
    });

    const hasChanges = resolved.some((r) => r.changeType !== "KEPT");
    const totals = sumBillTotals(lineTotals.map((l) => ({ quantity: l.r.finalQty, unitPrice: l.unitPrice, discount: l.discount, taxAmount: l.taxAmount, lineTotal: l.lineTotal })));

    const nextVersionNumber = b.currentVersion + 1;
    const [newVersion] = await tx
      .insert(billVersion)
      .values({
        id: crypto.randomUUID(),
        billId: b.id,
        versionNumber: nextVersionNumber,
        versionType: hasChanges ? "QC_ADJUSTMENT" : "FINAL",
        subtotal: totals.subtotal.toString(),
        discountTotal: totals.discountTotal.toString(),
        taxTotal: totals.taxTotal.toString(),
        total: totals.total.toString(),
        createdByUserId: args.userId,
        reason: hasChanges ? "QC verification adjustment" : "QC verified — no changes",
      })
      .returning();

    for (const l of lineTotals) {
      await tx.insert(billItem).values({
        id: crypto.randomUUID(),
        billVersionId: newVersion!.id,
        productId: l.r.productId,
        quantity: l.r.finalQty.toString(),
        unitId: l.r.unitId,
        unitPrice: l.unitPrice.toString(),
        discount: l.discount.toString(),
        taxAmount: l.taxAmount.toString(),
        lineTotal: l.lineTotal.toString(),
        changeType: l.r.changeType as any,
        previousQuantity: l.r.originalQty.toString(),
        reason: l.r.reason,
      });
    }
    await tx.update(bill).set({ currentVersion: nextVersionNumber }).where(eq(bill.id, b.id));

    for (const l of lineTotals) {
      const finalBaseQty = toBaseQty((saleUnitsByProduct.get(l.r.productId) ?? []) as any, l.r.unitId, l.r.finalQty);
      await finalizeQcDeductionDrizzle(tx, { productId: l.r.productId, warehouseId, reservedBaseQty: l.r.reservedBaseQty, finalBaseQty, referenceId: first.session.orderId, userId: args.userId });
      if (l.r.changeType !== "KEPT") {
        await tx.insert(qcAdjustment).values({
          id: crypto.randomUUID(),
          qcSessionId: args.sessionId,
          productId: l.r.productId,
          originalQty: l.r.originalQty.toString(),
          finalQty: l.r.finalQty.toString(),
          unitId: l.r.unitId,
          action: l.r.action as any,
          reason: l.r.reason,
        });
      }
    }

    const outcome = await applyBillRevisionAdjustmentDrizzle(tx, { billId: b.id, previousTotal: new Decimal(currentVersion.total), newTotal: totals.total, warehouseId, orderId: first.session.orderId });
    const orderStatus = outcome.status === "PAYMENT_ADJUSTMENT_REQUIRED" ? "ADDITIONAL_PAYMENT_REQUIRED" : outcome.status === "REFUND_DUE" ? "REFUND_REQUIRED" : "READY_FOR_HANDOVER";

    await tx.update(order).set({ status: orderStatus as any, updatedAt: new Date().toISOString() }).where(eq(order.id, first.session.orderId));
    await tx.update(qcSession).set({ status: "COMPLETED", completedAt: new Date().toISOString() }).where(eq(qcSession.id, args.sessionId));
    await writeAuditDrizzle({ userId: args.userId, warehouseId, action: "QC_COMPLETED", entityType: "QcSession", entityId: args.sessionId, newValue: { orderStatus, total: totals.total.toString(), hasChanges, ...(args.scanVerification ?? {}) } }, tx);

    return { orderStatus, total: totals.total, paymentStatus: outcome.status, warehouseId, hasChanges };
  });

  if (committed.hasChanges) {
    await notifyDrizzle(db, { role: "FINANCE", warehouseId: committed.warehouseId, type: "QC_ADJUSTMENT", title: "QC adjusted an order", message: `Order updated — new total ₹${committed.total.toFixed(2)} (${committed.paymentStatus})` });
  }
  publish(`warehouse:${committed.warehouseId}`, "qc:completed", { orderId: first.session.orderId });
  return { ok: true, orderStatus: committed.orderStatus, total: committed.total.toString(), paymentStatus: committed.paymentStatus };
}

