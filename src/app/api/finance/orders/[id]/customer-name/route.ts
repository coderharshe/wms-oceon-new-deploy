import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// A name typed wrong at the counter, fixed after the bill is out. Names only:
// mobile, credit and type stay with ADMIN/MANAGER on /api/customers/[id].
// The name lives on the Customer, which every print reads fresh, so the
// corrected name is on the next reprint — and on this customer's other bills,
// because it is the same customer. Audited with the order it was fixed from.
const schema = z.object({
  ownerName: z.string().trim().min(1, "Customer name cannot be empty"),
  shopName: z.string().trim().optional(), // blank keeps the customer name, as on the bill screen
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid name" }, { status: 400 });
  const ownerName = parsed.data.ownerName;
  const shopName = parsed.data.shopName || ownerName;

  const audit = (customerId: string, old: { ownerName: string | null; shopName: string }) => ({
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId,
    action: "CUSTOMER_NAME_CORRECTED",
    entityType: "Customer",
    entityId: customerId,
    oldValue: { ownerName: old.ownerName, shopName: old.shopName },
    newValue: { ownerName, shopName, fromOrderId: id },
  });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, customer } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const [ord] = await db.select({ customerId: order.customerId, warehouseId: order.warehouseId }).from(order).where(eq(order.id, id));
    if (!ord) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord.warehouseId);
    if (forbidden) return forbidden;
    const [old] = await db.select().from(customer).where(eq(customer.id, ord.customerId));
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [updated] = await db.update(customer).set({ ownerName, shopName }).where(eq(customer.id, old.id)).returning();
    await writeAuditDrizzle(audit(old.id, old));
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const ord = await db.order.findUnique({ where: { id }, include: { customer: true } });
  if (!ord) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, ord.warehouseId);
  if (forbidden) return forbidden;
  const updated = await db.customer.update({ where: { id: ord.customerId }, data: { ownerName, shopName } });
  await (await import("@/lib/audit")).writeAudit(audit(ord.customerId, ord.customer));
  return NextResponse.json(updated);
}
