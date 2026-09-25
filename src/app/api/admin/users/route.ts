import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { hashPassword } from "@/lib/password";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { user, warehouse } = await import("@/generated/drizzle/schema");
    const { eq, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const users = session.role === "MANAGER" ? await db.select().from(user).where(eq(user.warehouseId, session.warehouseId!)).orderBy(asc(user.name)) : await db.select().from(user).orderBy(asc(user.name));
    const warehouseIds = [...new Set(users.map((u) => u.warehouseId).filter((w): w is string => !!w))];
    const warehouses = warehouseIds.length ? await db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(inArray(warehouse.id, warehouseIds)) : [];
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    return NextResponse.json(users.map(({ passwordHash: _passwordHash, ...u }) => ({ ...u, warehouse: u.warehouseId ? { name: warehouseMap.get(u.warehouseId)?.name } : null })));
  }

  const db = (await import("@/lib/db")).getDb();
  const users = await db.user.findMany({
    where: session.role === "MANAGER" ? { warehouseId: session.warehouseId } : {},
    include: { warehouse: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(users.map(({ passwordHash: _passwordHash, ...u }) => u));
}

const schema = z.object({
  // Trimmed here so a stray space can't create "FIN-01 " as a second account
  // nobody can log into. 6 is the floor for a new id; older seeded ids
  // (QC-1, MGR-1) are shorter and stay valid — only renames are re-checked.
  staffId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  password: z.string().min(1),
  role: z.enum(["ADMIN", "MANAGER", "FINANCE", "PROCUREMENT", "INVENTORY", "BILLING", "QC"]),
  warehouseId: z.string().optional(),
});

/**
 * Staff IDs are unique, so re-using one is an ordinary "already taken" the
 * admin can fix — it was surfacing as an unhandled 500 and the form only said
 * "Could not create user".
 */
export async function POST(req: NextRequest) {
  try {
    return await createUser(req);
  } catch (err) {
    if (isUniqueViolation(err, "staffId")) return NextResponse.json({ error: "That Staff ID is already taken" }, { status: 409 });
    throw err;
  }
}

async function createUser(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (session.role === "MANAGER" && parsed.data.role !== "ADMIN") {
    parsed.data.warehouseId = session.warehouseId!; // managers may only staff their own warehouse
  }
  if (parsed.data.role !== "ADMIN" && !parsed.data.warehouseId) {
    return NextResponse.json({ error: "warehouseId is required for non-admin users" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { user } = await import("@/generated/drizzle/schema");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const [created] = await getDrizzleDb()
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        staffId: parsed.data.staffId,
        name: parsed.data.name,
        passwordHash,
        role: parsed.data.role,
        warehouseId: parsed.data.role === "ADMIN" ? null : parsed.data.warehouseId,
      })
      .returning();
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "USER_CREATED", entityType: "User", entityId: created!.id, newValue: { staffId: created!.staffId, role: created!.role } });
    const { passwordHash: _ph, ...safe } = created!;
    return NextResponse.json(safe, { status: 201 });
  }

  const db = (await import("@/lib/db")).getDb();
  const user = await db.user.create({
    data: {
      staffId: parsed.data.staffId,
      name: parsed.data.name,
      passwordHash,
      plainPassword: parsed.data.password,
      role: parsed.data.role,
      warehouseId: parsed.data.role === "ADMIN" ? null : parsed.data.warehouseId,
    },
  });
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "USER_CREATED", entityType: "User", entityId: user.id, newValue: { staffId: user.staffId, role: user.role } });
  const { passwordHash: _ph, ...safe } = user;
  return NextResponse.json(safe, { status: 201 });
}
