import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({ name: z.string().min(1), code: z.string().min(1), address: z.string().optional() });

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { warehouse } = await import("@/generated/drizzle/schema");
    const { asc } = await import("drizzle-orm");
    const warehouses = await getDrizzleDb().select().from(warehouse).orderBy(asc(warehouse.name));
    return NextResponse.json(warehouses);
  }

  const db = (await import("@/lib/db")).getDb();
  const warehouses = await db.warehouse.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(warehouses);
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { warehouse } = await import("@/generated/drizzle/schema");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const [created] = await getDrizzleDb().insert(warehouse).values({ id: crypto.randomUUID(), ...parsed.data }).returning();
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "WAREHOUSE_CREATED", entityType: "Warehouse", entityId: created!.id, newValue: parsed.data });
    return NextResponse.json(created, { status: 201 });
  }

  const db = (await import("@/lib/db")).getDb();
  const warehouse = await db.warehouse.create({ data: parsed.data });
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "WAREHOUSE_CREATED", entityType: "Warehouse", entityId: warehouse.id, newValue: parsed.data });
  return NextResponse.json(warehouse, { status: 201 });
}
