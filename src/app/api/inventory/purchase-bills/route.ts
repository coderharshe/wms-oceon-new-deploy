import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { toBaseQty, assertValidUnit, UnitError } from "@/lib/units";
import { allocateOtherCharges, billTotals, lineAmount, movingAverageCost } from "@/lib/purchase";
import { isUniqueViolation } from "@/lib/db-errors";
import { claimIdempotencyKey, claimIdempotencyKeyDrizzle, DuplicateRequestError } from "@/lib/idempotency";

// Receiving purchased stock. This is the only way inventory enters the system
// (everything else — QC, sale — only ever deducts), and it replaces the old
// single-product /api/manager/inventory/receive form: every receipt now
// belongs to a supplier's bill, so the paper trail and the stock movement are
// created in one transaction and can't drift apart.

const lineSchema = z.object({
  productId: z.string(),
  unitId: z.string(),
  quantity: z.number().positive(),
  rate: z.number().min(0), // purchase rate per the line's unit, as printed on the bill
});

const schema = z.object({
  supplierId: z.string().optional(),
  supplierBillNo: z.string().optional(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warehouseId: z.string().optional(), // ADMIN only; forced to own warehouse otherwise
  items: z.array(lineSchema).min(1),
  gstAmount: z.number().min(0).optional(),
  otherCharges: z.number().min(0).optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
  // Set when this came from the offline write-queue being flushed — a retried
  // flush must not receive the same stock twice. See src/lib/idempotency.ts.
  clientRequestId: z.string().optional(),
});

const DUPLICATE_BILL = { error: "This supplier bill number has already been received" } as const;

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 25, 100);
  // Set by the supplier screen to show one supplier's ledger.
  const supplierId = req.nextUrl.searchParams.get("supplierId");

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { purchaseBill, supplier } = await import("@/generated/drizzle/schema");
    const { and, eq, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const filters = [
      session.role === "ADMIN" ? undefined : eq(purchaseBill.warehouseId, session.warehouseId!),
      supplierId ? eq(purchaseBill.supplierId, supplierId) : undefined,
    ].filter(Boolean);
    const rows = await db
      .select({ bill: purchaseBill, supplierName: supplier.name })
      .from(purchaseBill)
      .innerJoin(supplier, eq(supplier.id, purchaseBill.supplierId))
      .where(filters.length ? and(...(filters as any[])) : undefined)
      .orderBy(desc(purchaseBill.createdAt))
      .limit(limit);
    return NextResponse.json(rows.map((r) => ({ ...r.bill, supplier: { name: r.supplierName } })));
  }

  const db = (await import("@/lib/db")).getDb();
  const rows = await db.purchaseBill.findMany({
    where: {
      ...(session.role === "ADMIN" ? {} : { warehouseId: session.warehouseId! }),
      ...(supplierId ? { supplierId } : {}),
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const warehouseId = session.role === "ADMIN" ? input.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  // Totals are always recomputed from the lines — the client never gets to
  // say what a bill adds up to.
  const totals = billTotals(input.items, input.gstAmount ?? 0, input.otherCharges ?? 0);
  // Landed cost: freight/loading is part of what the stock cost us, GST is not.
  const freightShares = allocateOtherCharges(input.items, input.otherCharges ?? 0);

  try {
    const effectiveBillNo = input.supplierBillNo?.trim() || `DIR-${Date.now().toString().slice(-6)}`;
    const effectiveBillDate = input.billDate || new Date().toISOString().slice(0, 10);

    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { product, productUnit, purchaseBill, purchaseBillItem, supplier } = await import("@/generated/drizzle/schema");
      const { eq, inArray } = await import("drizzle-orm");
      const { adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
      const { nextNumberDrizzle } = await import("@/lib/drizzle-numbering");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();

      let targetSupplierId = input.supplierId;
      if (!targetSupplierId) {
        const [existing] = await db.select().from(supplier).limit(1);
        if (existing) {
          targetSupplierId = existing.id;
        } else {
          targetSupplierId = crypto.randomUUID();
          await db.insert(supplier).values({
            id: targetSupplierId,
            name: "Direct Inward / General Supplier",
            active: true,
          });
        }
      }

      const productIds = [...new Set(input.items.map((i) => i.productId))];
      const products = await db.select().from(product).where(inArray(product.id, productIds));
      if (products.length !== productIds.length) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      const units = await db.select().from(productUnit).where(inArray(productUnit.productId, productIds));

      const billId = crypto.randomUUID();
      const grnNumber = await db.transaction(async (tx) => {
        if (input.clientRequestId) await claimIdempotencyKeyDrizzle(tx, input.clientRequestId);
        const grn = await nextNumberDrizzle(tx, "grn", "GRN");
        await tx.insert(purchaseBill).values({
          id: billId,
          grnNumber: grn,
          supplierBillNo: effectiveBillNo,
          billDate: effectiveBillDate,
          supplierId: targetSupplierId!,
          warehouseId,
          subtotal: totals.subtotal.toString(),
          gstAmount: totals.gstAmount.toString(),
          otherCharges: totals.otherCharges.toString(),
          total: totals.total.toString(),
          paymentStatus: input.paymentStatus ?? "UNPAID",
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          invoiceKeys: [],
          receivedByUserId: session.sub,
        });

        // A supplier bill routinely lists the same product twice at two rates;
        // each line must weight against the average the previous line produced,
        // not against the pre-bill value fetched above.
        const runningAvg = new Map<string, Decimal | string | null>(products.map((p) => [p.id, p.avgCost]));

        for (const [idx, item] of input.items.entries()) {
          const saleUnits = units
            .filter((u) => u.productId === item.productId)
            .map((u) => ({ unitId: u.unitId, factorToBase: u.factorToBase, isBaseUnit: u.isBaseUnit }));
          assertValidUnit(saleUnits, item.unitId);
          const baseQty = toBaseQty(saleUnits, item.unitId, item.quantity);
          const amount = lineAmount(item);

          await tx.insert(purchaseBillItem).values({
            id: crypto.randomUUID(),
            purchaseBillId: billId,
            productId: item.productId,
            quantity: item.quantity.toString(),
            unitId: item.unitId,
            rate: item.rate.toString(),
            amount: amount.toString(),
          });

          const { before } = await adjustStockDrizzle(tx, {
            productId: item.productId,
            warehouseId,
            deltaBaseQty: baseQty,
            movementType: "GRN",
            referenceType: "PURCHASE_BILL",
            referenceId: billId,
            userId: session.sub,
          });

          const newAvg = movingAverageCost({
            onHandBefore: before,
            previousAvgCost: runningAvg.get(item.productId) ?? null,
            receivedBaseQty: baseQty,
            lineAmount: amount.add(freightShares[idx]!),
          });
          runningAvg.set(item.productId, newAvg);
          await tx.update(product).set({ avgCost: newAvg.toString() }).where(eq(product.id, item.productId));
        }
        return grn;
      });

      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId,
        action: "STOCK_RECEIVED",
        entityType: "PurchaseBill",
        entityId: billId,
        newValue: { grnNumber, supplierBillNo: effectiveBillNo, total: totals.total.toString(), lines: input.items.length },
      });
      return NextResponse.json({ id: billId, grnNumber }, { status: 201 });
    }

    const db = (await import("@/lib/db")).getDb();
    const { adjustStock } = await import("@/lib/inventory");
    const { nextNumber } = await import("@/lib/numbering");

    let targetSupplierId = input.supplierId;
    if (!targetSupplierId) {
      const existing = await db.supplier.findFirst();
      if (existing) {
        targetSupplierId = existing.id;
      } else {
        const createdSup = await db.supplier.create({
          data: {
            name: "Direct Inward / General Supplier",
            active: true,
          },
        });
        targetSupplierId = createdSup.id;
      }
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await db.product.findMany({ where: { id: { in: productIds } }, include: { saleUnits: true } });
    if (products.length !== productIds.length) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const created = await db.$transaction(async (tx) => {
      if (input.clientRequestId) await claimIdempotencyKey(tx, input.clientRequestId);
      const grnNumber = await nextNumber(tx, "grn", "GRN");
      const bill = await tx.purchaseBill.create({
        data: {
          grnNumber,
          supplierBillNo: effectiveBillNo,
          billDate: new Date(effectiveBillDate),
          supplierId: targetSupplierId!,
          warehouseId,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          otherCharges: totals.otherCharges,
          total: totals.total,
          paymentStatus: input.paymentStatus ?? "UNPAID",
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: input.notes ?? null,
          receivedByUserId: session.sub,
        },
      });

      // See the Drizzle branch: same product on two lines must compound.
      const runningAvg = new Map<string, Decimal | null>(products.map((p) => [p.id, p.avgCost]));

      for (const [idx, item] of input.items.entries()) {
        const p = products.find((x) => x.id === item.productId)!;
        assertValidUnit(p.saleUnits, item.unitId);
        const baseQty = toBaseQty(p.saleUnits, item.unitId, item.quantity);
        const amount = lineAmount(item);

        await tx.purchaseBillItem.create({
          data: {
            purchaseBillId: bill.id,
            productId: item.productId,
            quantity: new Decimal(item.quantity),
            unitId: item.unitId,
            rate: new Decimal(item.rate),
            amount,
          },
        });

        const { before } = await adjustStock(tx, {
          productId: item.productId,
          warehouseId,
          deltaBaseQty: baseQty,
          movementType: "GRN",
          referenceType: "PURCHASE_BILL",
          referenceId: bill.id,
          userId: session.sub,
        });

        const newAvg = movingAverageCost({
          onHandBefore: before,
          previousAvgCost: runningAvg.get(item.productId) ?? null,
          receivedBaseQty: baseQty,
          lineAmount: amount.add(freightShares[idx]!),
        });
        runningAvg.set(item.productId, newAvg);
        await tx.product.update({ where: { id: item.productId }, data: { avgCost: newAvg } });
      }
      return bill;
    });

    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: "STOCK_RECEIVED",
      entityType: "PurchaseBill",
      entityId: created.id,
      newValue: {
        grnNumber: created.grnNumber,
        supplierBillNo: input.supplierBillNo,
        total: totals.total.toString(),
        lines: input.items.length,
      },
    });
    return NextResponse.json({ id: created.id, grnNumber: created.grnNumber }, { status: 201 });
  } catch (err) {
    if (err instanceof UnitError) return NextResponse.json({ error: err.message }, { status: 400 });
    // A retried offline-queue flush of a bill already received.
    if (err instanceof DuplicateRequestError) return NextResponse.json({ ok: true, duplicate: true });
    if (isUniqueViolation(err, "supplierBillNo")) return NextResponse.json(DUPLICATE_BILL, { status: 409 });
    throw err;
  }
}
