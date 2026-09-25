import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { invalidateJson } from "@/lib/kv-cache";
import { isWorkersRuntime } from "@/lib/cf-env";

// Same roles that may create a unit (see the collection route's POST).
const ROLES = ["ADMIN", "MANAGER"] as const;

const schema = z.object({
  name: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  type: z.enum(["WEIGHT", "VOLUME", "COUNT", "CUSTOM"]).optional(),
});

const DUPLICATE = { error: "Another unit already uses that name or symbol" } as const;
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof PrismaClientKnownRequestError) return err.code === "P2002";
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

/**
 * Renames a unit.
 *
 * Everything references units by id, so a changed symbol shows up on every
 * past bill, invoice and label too — that is deliberate: a symbol is a display
 * name, and correcting a typo should correct it everywhere.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...ROLES]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid unit details" }, { status: 400 });
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { unit } = await import("@/generated/drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();

      const [existing] = await db.select().from(unit).where(eq(unit.id, id));
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const [updated] = await db.update(unit).set(patch).where(eq(unit.id, id)).returning();
      await invalidateJson("units:all");
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId,
        action: "UNIT_UPDATED",
        entityType: "Unit",
        entityId: id,
        oldValue: existing,
        newValue: patch,
      });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const existing = await db.unit.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const updated = await db.unit.update({ where: { id }, data: patch });
    await invalidateJson("units:all");
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action: "UNIT_UPDATED",
      entityType: "Unit",
      entityId: id,
      oldValue: existing,
      newValue: patch,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json(DUPLICATE, { status: 409 });
    throw err;
  }
}

// What a unit is spoken for by. Every one of these is an onDelete: restrict FK,
// so the database would refuse the delete anyway — counting first just turns a
// constraint violation into a sentence someone can act on.
function describeUsage(counts: { products: number; saleUnits: number; orderLines: number; billLines: number; purchaseLines: number }) {
  const parts: string[] = [];
  if (counts.products) parts.push(`${counts.products} product${counts.products > 1 ? "s" : ""} use it as their base unit`);
  if (counts.saleUnits) parts.push(`${counts.saleUnits} product sale unit${counts.saleUnits > 1 ? "s" : ""}`);
  if (counts.orderLines) parts.push(`${counts.orderLines} order line${counts.orderLines > 1 ? "s" : ""}`);
  if (counts.billLines) parts.push(`${counts.billLines} bill line${counts.billLines > 1 ? "s" : ""}`);
  if (counts.purchaseLines) parts.push(`${counts.purchaseLines} purchase line${counts.purchaseLines > 1 ? "s" : ""}`);
  return parts;
}

/**
 * Deletes a unit, but only one nothing references.
 *
 * A unit that is attached to a product or sits on a past order/bill stays put:
 * removing it would rewrite history, and the FKs are `restrict` for exactly
 * that reason. The usage is counted first so the refusal can say what is
 * holding it rather than surfacing a constraint error.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole([...ROLES]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { unit, product, productUnit, orderItem, billItem, purchaseBillItem } = await import("@/generated/drizzle/schema");
    const { eq, count } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const [existing] = await db.select().from(unit).where(eq(unit.id, id));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const one = async (table: any, column: any) => (await db.select({ c: count() }).from(table).where(eq(column, id)))[0]?.c ?? 0;
    const parts = describeUsage({
      products: await one(product, product.baseUnitId),
      saleUnits: await one(productUnit, productUnit.unitId),
      orderLines: await one(orderItem, orderItem.unitId),
      billLines: await one(billItem, billItem.unitId),
      purchaseLines: await one(purchaseBillItem, purchaseBillItem.unitId),
    });
    if (parts.length) {
      return NextResponse.json({ error: `${existing.symbol} is still in use by ${parts.join(", ")} — detach it first.` }, { status: 409 });
    }

    await db.delete(unit).where(eq(unit.id, id));
    await invalidateJson("units:all");
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action: "UNIT_DELETED",
      entityType: "Unit",
      entityId: id,
      oldValue: existing,
    });
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.unit.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parts = describeUsage({
    products: await db.product.count({ where: { baseUnitId: id } }),
    saleUnits: await db.productUnit.count({ where: { unitId: id } }),
    orderLines: await db.orderItem.count({ where: { unitId: id } }),
    billLines: await db.billItem.count({ where: { unitId: id } }),
    purchaseLines: await db.purchaseBillItem.count({ where: { unitId: id } }),
  });
  if (parts.length) {
    return NextResponse.json({ error: `${existing.symbol} is still in use by ${parts.join(", ")} — detach it first.` }, { status: 409 });
  }

  await db.unit.delete({ where: { id } });
  await invalidateJson("units:all");
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId,
    action: "UNIT_DELETED",
    entityType: "Unit",
    entityId: id,
    oldValue: existing,
  });
  return NextResponse.json({ ok: true });
}
