import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, QcAction, PrismaClient } from "@/generated/prisma/client";
import { toBaseQty } from "./units";
import { sumBillTotals, resolveUnitPrice } from "./pricing";
import { finalizeQcDeduction } from "./inventory";
import { applyBillRevisionAdjustment } from "./payment-service";
import { writeAudit } from "./audit";
import { publish } from "./realtime";
import { notify } from "./notifications";

type Db = PrismaClient | Prisma.TransactionClient;

export type LineDecision = {
  productId: string;
  action: QcAction; // KEEP | REDUCE | REMOVE | MARK_UNAVAILABLE
  finalQty: number;
  reason?: string;
};

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

/**
 * Read-only pass: QC can only ever keep or reduce a line (never increase or
 * add a new product — enforced here, not just in the UI, since this is a
 * money-affecting endpoint). Does not write anything, so it's safe to call
 * outside a transaction.
 */
/** Barcode-check summary recorded on the QC_COMPLETED audit entry. */
export type ScanVerification = { scannedProductIds: string[]; scannedCount: number; lineCount: number };

async function evaluate(db: Db, args: { sessionId: string; lineDecisions: LineDecision[] }) {
  const session = await db.qcSession.findUniqueOrThrow({ where: { id: args.sessionId }, include: { order: true } });
  const bill = await db.bill.findUniqueOrThrow({
    where: { orderId: session.orderId },
    include: { versions: { include: { items: true } } },
  });
  const currentVersion = bill.versions.find((v) => v.versionNumber === bill.currentVersion)!;
  const warehouseId = session.order.warehouseId;

  const productIds = currentVersion.items.map((i) => i.productId);
  const products = await db.product.findMany({ where: { id: { in: productIds } }, include: { saleUnits: true } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const blocked: { productId: string; productName: string; detail: string }[] = [];
  const resolved: ResolvedLine[] = [];

  for (const billItem of currentVersion.items) {
    const decision = args.lineDecisions.find((d) => d.productId === billItem.productId);
    const product = productMap.get(billItem.productId);
    if (!product) continue;
    const originalQty = new Decimal(billItem.quantity);
    const finalQty = decision ? new Decimal(decision.finalQty) : originalQty;
    const action: QcAction = decision?.action ?? "KEEP";
    const changed = !finalQty.equals(originalQty) || action === "MARK_UNAVAILABLE";

    if (finalQty.gt(originalQty)) {
      blocked.push({ productId: billItem.productId, productName: product.name, detail: "QC can only reduce quantity, not increase it" });
      continue;
    }
    if (changed && !decision?.reason) {
      blocked.push({ productId: billItem.productId, productName: product.name, detail: "Reason is required" });
      continue;
    }

    const changeType: ResolvedLine["changeType"] = !changed
      ? "KEPT"
      : finalQty.isZero()
      ? action === "MARK_UNAVAILABLE"
        ? "UNAVAILABLE"
        : "REMOVED"
      : "REDUCED";

    resolved.push({
      productId: billItem.productId,
      unitId: billItem.unitId,
      originalQty,
      finalQty,
      action,
      reason: decision?.reason ?? null,
      changeType,
      reservedBaseQty: toBaseQty(product.saleUnits, billItem.unitId, originalQty),
    });
  }

  return { session, bill, currentVersion, productMap, warehouseId, blocked, resolved };
}

export async function completeQcSession(
  db: PrismaClient,
  args: { sessionId: string; userId: string; lineDecisions: LineDecision[]; scanVerification?: ScanVerification }
): Promise<CompleteResult> {
  const first = await evaluate(db, args);
  if (first.session.status === "COMPLETED") throw new Error("QC session already completed");

  if (first.blocked.length > 0) {
    return { ok: false, kind: "blocked", lines: first.blocked };
  }

  // Nothing blocked — commit everything atomically (PRD §36).
  const committed = await db.$transaction(async (tx) => {
    // Re-run evaluate() inside the transaction against a locked, current view
    // so a concurrent change can't slip through between the check above and
    // the write below (PRD §37).
    // Lock the QcSession row BEFORE reading it: the status check above ran
    // outside the transaction, so without this two overlapping completes both
    // pass it and both deduct stock. Serialise on the row, then re-read.
    await tx.$queryRaw`SELECT id FROM "QcSession" WHERE id = ${args.sessionId} FOR UPDATE`;
    const { session, bill, currentVersion, productMap, warehouseId, blocked, resolved } = await evaluate(tx, args);
    if (session.status === "COMPLETED") throw new Error("QC session already completed");
    if (blocked.length > 0) throw new QcValidationError(blocked);

    const lineTotals = resolved.map((r) => {
      const product = productMap.get(r.productId)!;
      const originalItem = currentVersion.items.find((i) => i.productId === r.productId);
      const unitPrice = originalItem
        ? new Decimal(originalItem.unitPrice)
        : resolveUnitPrice(product, first.session.order.sellingMode);
      const discount = originalItem ? new Decimal(originalItem.discount) : new Decimal(0);
      const gross = r.finalQty.mul(unitPrice).sub(discount);
      const taxAmount = gross.mul(new Decimal(product.taxPercent).div(100));
      return { r, product, unitPrice, discount, taxAmount, lineTotal: gross.add(taxAmount) };
    });

    const hasChanges = resolved.some((r) => r.changeType !== "KEPT");
    const totals = sumBillTotals(
      lineTotals.map((l) => ({ quantity: l.r.finalQty, unitPrice: l.unitPrice, discount: l.discount, taxAmount: l.taxAmount, lineTotal: l.lineTotal }))
    );

    const nextVersionNumber = bill.currentVersion + 1;
    await tx.billVersion.create({
      data: {
        billId: bill.id,
        versionNumber: nextVersionNumber,
        versionType: hasChanges ? "QC_ADJUSTMENT" : "FINAL",
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdByUserId: args.userId,
        reason: hasChanges ? "QC verification adjustment" : "QC verified — no changes",
        items: {
          create: lineTotals.map((l) => ({
            productId: l.r.productId,
            quantity: l.r.finalQty,
            unitId: l.r.unitId,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
            changeType: l.r.changeType,
            previousQuantity: l.r.originalQty,
            reason: l.r.reason,
          })),
        },
      },
    });
    await tx.bill.update({ where: { id: bill.id }, data: { currentVersion: nextVersionNumber } });

    for (const l of lineTotals) {
      const finalBaseQty = toBaseQty(l.product.saleUnits, l.r.unitId, l.r.finalQty);
      await finalizeQcDeduction(tx, {
        productId: l.r.productId,
        warehouseId,
        reservedBaseQty: l.r.reservedBaseQty,
        finalBaseQty,
        referenceId: first.session.orderId,
        userId: args.userId,
      });
      if (l.r.changeType !== "KEPT") {
        await tx.qcAdjustment.create({
          data: {
            qcSessionId: args.sessionId,
            productId: l.r.productId,
            originalQty: l.r.originalQty,
            finalQty: l.r.finalQty,
            unitId: l.r.unitId,
            action: l.r.action,
            reason: l.r.reason,
          },
        });
      }
    }

    const outcome = await applyBillRevisionAdjustment(tx, {
      billId: bill.id,
      previousTotal: new Decimal(currentVersion.total),
      newTotal: totals.total,
      warehouseId,
      orderId: first.session.orderId,
    });

    const orderStatus =
      outcome.status === "PAYMENT_ADJUSTMENT_REQUIRED"
        ? "ADDITIONAL_PAYMENT_REQUIRED"
        : outcome.status === "REFUND_DUE"
        ? "REFUND_REQUIRED"
        : "READY_FOR_HANDOVER";

    await tx.order.update({ where: { id: first.session.orderId }, data: { status: orderStatus } });
    await tx.qcSession.update({ where: { id: args.sessionId }, data: { status: "COMPLETED", completedAt: new Date() } });

    await writeAudit(
      {
        userId: args.userId,
        warehouseId,
        action: "QC_COMPLETED",
        entityType: "QcSession",
        entityId: args.sessionId,
        newValue: { orderStatus, total: totals.total.toString(), hasChanges, ...(args.scanVerification ?? {}) },
      },
      tx
    );

    return { orderStatus, total: totals.total, paymentStatus: outcome.status, warehouseId, hasChanges };
  }, { timeout: 15000 });

  if (committed.hasChanges) {
    // Finance sees this both as a notification and as a "Needs Refund /
    // Extra Payment" entry on their dashboard (order status drives that list).
    await notify(db, {
      role: "FINANCE",
      warehouseId: committed.warehouseId,
      type: "QC_ADJUSTMENT",
      title: "QC adjusted an order",
      message: `Order updated — new total ₹${committed.total.toFixed(2)} (${committed.paymentStatus})`,
    });
  }
  publish(`warehouse:${committed.warehouseId}`, "qc:completed", { orderId: first.session.orderId });

  return { ok: true, orderStatus: committed.orderStatus, total: committed.total.toString(), paymentStatus: committed.paymentStatus };
}

export class QcValidationError extends Error {
  constructor(public lines: { productId: string; productName: string; detail: string }[]) {
    super("blocked");
  }
}

