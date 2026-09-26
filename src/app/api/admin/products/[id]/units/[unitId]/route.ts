import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";
import { fail } from "@/lib/api-error";

// Every field is optional so a caller can change one thing without having to
// resend the rest — the barcode editor sends only barcode, the unit editor
// only the size and rates. null on a price means "derive from the base price"
// (see resolveUnitPrice); null on the barcode clears it.
const schema = z
  .object({
    barcode: z.string().min(1).nullable().optional(),
    barcodeGenerated: z.boolean().default(false),
    factorToBase: z.number().positive().optional(),
    isDefaultSaleUnit: z.boolean().optional(),
    wholesalePrice: z.number().positive().nullable().optional(),
    retailPrice: z.number().positive().nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "barcodeGenerated"), { message: "Nothing to change" });

// Sets/clears the barcode on one sale unit of an existing product. Product
// creation (POST /api/admin/products) sets these at the same time as the
// units themselves; this covers a catalogue that already exists — without it,
// every product added before barcodes shipped could never get one.
//
// `unitId` here is the Unit's id (what the client already has from the
// product's saleUnits), not the ProductUnit row id — the [productId, unitId]
// pair is unique, so it identifies the row on its own.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; unitId: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;
  const { id, unitId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { barcode, barcodeGenerated, factorToBase, isDefaultSaleUnit, wholesalePrice, retailPrice } = parsed.data;
  // Only the keys actually sent are written, so an untouched field keeps its
  // value rather than being reset to a default.
  const patch = {
    ...(barcode !== undefined ? { barcode, barcodeGenerated: barcode ? barcodeGenerated : false } : {}),
    ...(isDefaultSaleUnit !== undefined ? { isDefaultSaleUnit } : {}),
  };

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { productUnit } = await import("@/generated/drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();
      const [updated] = await db
        .update(productUnit)
        .set({
          ...patch,
          ...(factorToBase !== undefined ? { factorToBase: factorToBase.toString() } : {}),
          ...(wholesalePrice !== undefined ? { wholesalePrice: wholesalePrice?.toString() ?? null } : {}),
          ...(retailPrice !== undefined ? { retailPrice: retailPrice?.toString() ?? null } : {}),
        })
        .where(and(eq(productUnit.productId, id), eq(productUnit.unitId, unitId)))
        .returning();
      if (!updated) return NextResponse.json({ error: "That unit is not attached to this product" }, { status: 404 });
      if (isDefaultSaleUnit) {
        const { ne, and: and2 } = await import("drizzle-orm");
        await db.update(productUnit).set({ isDefaultSaleUnit: false })
          .where(and2(eq(productUnit.productId, id), ne(productUnit.id, updated.id)));
      }
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        action: "PRODUCT_UNIT_UPDATED",
        entityType: "Product",
        entityId: id,
        newValue: { unitId, ...parsed.data },
      });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const existing = await db.productUnit.findFirst({ where: { productId: id, unitId } });
    if (!existing) return NextResponse.json({ error: "That unit is not attached to this product" }, { status: 404 });
    const updated = await db.productUnit.update({
      where: { id: existing.id },
      data: {
        ...patch,
        ...(factorToBase !== undefined ? { factorToBase } : {}),
        ...(wholesalePrice !== undefined ? { wholesalePrice } : {}),
        ...(retailPrice !== undefined ? { retailPrice } : {}),
      },
    });
    if (isDefaultSaleUnit) {
      await db.productUnit.updateMany({ where: { productId: id, id: { not: existing.id } }, data: { isDefaultSaleUnit: false } });
    }
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      action: "PRODUCT_UNIT_UPDATED",
      entityType: "Product",
      entityId: id,
      newValue: { unitId, ...parsed.data },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err, "barcode")) {
      return fail(409, "That barcode is already assigned to another product or unit.", { label: "Find it", href: `/manager/products?q=${encodeURIComponent(typeof barcode === "string" ? barcode : "")}` });
    }
    throw err;
  }
}

// An order still moving through the flow can be revised or QC'd, and both
// convert its lines with toBaseQty() — which looks the unit up in the
// product's sale units. Detaching one out from under a live order would make
// it unconvertible, so those block the detach; finished orders never get
// re-converted and are left alone.
const LIVE_ORDER_STATUSES = ["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID", "READY_FOR_QC", "QC_IN_PROGRESS", "QC_ADJUSTMENT_REQUIRED", "ADDITIONAL_PAYMENT_REQUIRED", "REFUND_REQUIRED", "READY_FOR_HANDOVER"] as const;

/**
 * Detaches a sale unit from one product. The Unit itself is untouched — it
 * stays available for every other product.
 *
 * The base unit can go too. Product.baseUnitId is a separate column, so the
 * stock stays counted in that unit and every other unit's factorToBase stays
 * correct — the unit simply stops being one you can bill, sell or receive in.
 * Re-attaching it (POST ../units) restores the flag.
 *
 * Two refusals remain, both about breaking something that already exists: a
 * unit a live order is billed in (toBaseQty would fall back to factor 1 and
 * silently restate that order's quantities), and the product's last unit
 * (nothing left to transact it in at all).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; unitId: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;
  const { id, unitId } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { productUnit, orderItem, order } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray, count } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const [existing] = await db.select().from(productUnit).where(and(eq(productUnit.productId, id), eq(productUnit.unitId, unitId)));
    if (!existing) return NextResponse.json({ error: "That unit is not attached to this product" }, { status: 404 });
    const [attached] = await db.select({ c: count() }).from(productUnit).where(eq(productUnit.productId, id));
    if ((attached?.c ?? 0) <= 1) {
      return fail(409, "A product needs at least one unit to be bought or sold in.", { label: "Attach a unit", href: "/manager/inventory#attach" });
    }

    const [live] = await db
      .select({ c: count() })
      .from(orderItem)
      .innerJoin(order, eq(orderItem.orderId, order.id))
      .where(and(eq(orderItem.productId, id), eq(orderItem.unitId, unitId), inArray(order.status, LIVE_ORDER_STATUSES as unknown as string[] as any)));
    if ((live?.c ?? 0) > 0) {
      return fail(409, `${live!.c} order${live!.c > 1 ? "s are" : " is"} still open in this unit — finish or cancel them first.`, { label: "Open Orders", href: "/manager/orders" });
    }

    await db.delete(productUnit).where(eq(productUnit.id, existing.id));
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      action: "PRODUCT_UNIT_DETACHED",
      entityType: "Product",
      entityId: id,
      oldValue: existing,
    });
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.productUnit.findFirst({ where: { productId: id, unitId } });
  if (!existing) return NextResponse.json({ error: "That unit is not attached to this product" }, { status: 404 });
  const attached = await db.productUnit.count({ where: { productId: id } });
  if (attached <= 1) {
    return fail(409, "A product needs at least one unit to be bought or sold in.", { label: "Attach a unit", href: "/manager/inventory#attach" });
  }

  const live = await db.orderItem.count({
    where: { productId: id, unitId, order: { status: { in: LIVE_ORDER_STATUSES as unknown as string[] as any } } },
  });
  if (live > 0) {
    return fail(409, `${live} order${live > 1 ? "s are" : " is"} still open in this unit — finish or cancel them first.`, { label: "Open Orders", href: "/manager/orders" });
  }

  await db.productUnit.delete({ where: { id: existing.id } });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    action: "PRODUCT_UNIT_DETACHED",
    entityType: "Product",
    entityId: id,
    oldValue: existing,
  });
  return NextResponse.json({ ok: true });
}
