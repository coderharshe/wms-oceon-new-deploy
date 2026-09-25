import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({ name: z.string().optional(), address: z.string().optional(), active: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  // A manager can correct their own branch's details but not another one's,
  // and creating a warehouse (POST, on the collection route) stays admin-only.
  if (session.role === "MANAGER") {
    const forbidden = assertWarehouseAccess(session, id);
    if (forbidden) return forbidden;
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { warehouse } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [before] = await db.select().from(warehouse).where(eq(warehouse.id, id));
    const [updated] = await db.update(warehouse).set(parsed.data).where(eq(warehouse.id, id)).returning();
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "WAREHOUSE_UPDATED", entityType: "Warehouse", entityId: id, oldValue: before as object, newValue: parsed.data });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const before = await db.warehouse.findUnique({ where: { id } });
  const warehouse = await db.warehouse.update({ where: { id }, data: parsed.data });
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "WAREHOUSE_UPDATED", entityType: "Warehouse", entityId: id, oldValue: before as object, newValue: parsed.data });
  return NextResponse.json(warehouse);
}
