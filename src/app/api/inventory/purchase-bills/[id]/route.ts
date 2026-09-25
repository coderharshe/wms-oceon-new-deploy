import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// A received bill's lines are never edited — the stock they moved is already
// in inventory and its GRN movements are history. The only mutable field is
// whether the supplier has been paid (PATCH below); a wrong bill is corrected
// with a stock adjustment, not by rewriting the paper trail.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { purchaseBill, purchaseBillItem, supplier, product, unit } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const [row] = await db
      .select({ bill: purchaseBill, supplier })
      .from(purchaseBill)
      .innerJoin(supplier, eq(supplier.id, purchaseBill.supplierId))
      .where(eq(purchaseBill.id, id));
    if (!row) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, row.bill.warehouseId);
    if (forbidden) return forbidden;

    const items = await db
      .select({ item: purchaseBillItem, productName: product.name, sku: product.sku, unitSymbol: unit.symbol })
      .from(purchaseBillItem)
      .innerJoin(product, eq(product.id, purchaseBillItem.productId))
      .innerJoin(unit, eq(unit.id, purchaseBillItem.unitId))
      .where(eq(purchaseBillItem.purchaseBillId, id));

    return NextResponse.json({
      ...row.bill,
      supplier: row.supplier,
      items: items.map((i) => ({ ...i.item, product: { name: i.productName, sku: i.sku }, unit: { symbol: i.unitSymbol } })),
    });
  }

  const db = (await import("@/lib/db")).getDb();
  const bill = await db.purchaseBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { product: { select: { name: true, sku: true } }, unit: { select: { symbol: true } } } },
    },
  });
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, bill.warehouseId);
  if (forbidden) return forbidden;
  return NextResponse.json(bill);
}

const patchSchema = z.object({
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { purchaseBill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [existing] = await db.select().from(purchaseBill).where(eq(purchaseBill.id, id));
    if (!existing) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, existing.warehouseId);
    if (forbidden) return forbidden;

    const [updated] = await db.update(purchaseBill).set({ paymentStatus: parsed.data.paymentStatus }).where(eq(purchaseBill.id, id)).returning();
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: existing.warehouseId,
      action: "PURCHASE_BILL_PAYMENT_STATUS_CHANGED",
      entityType: "PurchaseBill",
      entityId: id,
      oldValue: { paymentStatus: existing.paymentStatus },
      newValue: { paymentStatus: parsed.data.paymentStatus },
    });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.purchaseBill.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, existing.warehouseId);
  if (forbidden) return forbidden;

  const updated = await db.purchaseBill.update({ where: { id }, data: { paymentStatus: parsed.data.paymentStatus } });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: existing.warehouseId,
    action: "PURCHASE_BILL_PAYMENT_STATUS_CHANGED",
    entityType: "PurchaseBill",
    entityId: id,
    oldValue: { paymentStatus: existing.paymentStatus },
    newValue: { paymentStatus: parsed.data.paymentStatus },
  });
  return NextResponse.json(updated);
}
