import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { hashPassword } from "@/lib/password";
import { isWorkersRuntime } from "@/lib/cf-env";
import { clearActiveSid } from "@/lib/session-registry";
import { isUniqueViolation } from "@/lib/db-errors";

const schema = z.object({
  active: z.boolean().optional(),
  name: z.string().trim().min(1).optional(),
  staffId: z.string().trim().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "FINANCE", "PROCUREMENT", "INVENTORY", "BILLING", "QC"]).optional(),
  warehouseId: z.string().nullable().optional(),
  password: z.string().min(1).optional(),
  contact: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  town: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  shift: z.string().nullable().optional(),
  joiningDate: z.string().nullable().optional(),
  endingDate: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  bankUpi: z.string().nullable().optional(),
  reportingManager: z.string().nullable().optional(),
  theme: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  fontFamily: z.string().nullable().optional(),
  fontSize: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await patchUser(req, params);
  } catch (err) {
    if (isUniqueViolation(err, "staffId")) return NextResponse.json({ error: "That Staff ID is already taken" }, { status: 409 });
    throw err;
  }
}

async function patchUser(req: NextRequest, params: Promise<{ id: string }>) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { password, ...rest } = parsed.data;

  if (session.role === "MANAGER") {
    if (rest.warehouseId !== undefined) return NextResponse.json({ error: "Managers cannot move staff between warehouses" }, { status: 403 });
    if (rest.role === "ADMIN") return NextResponse.json({ error: "Managers cannot grant the admin role" }, { status: 403 });
  }

  // role/warehouseId/active are baked into the target's 12h JWT, so editing
  // the row alone changes nothing until it expires — a fired employee kept
  // full access for up to half a day. Clearing their registered sid makes
  // getSession() reject the stale token on its very next request and bounce
  // them to login, where they get a token carrying the new values.
  // staffId is their login id and is baked into the token too, so a rename revokes as well.
  const mustRevoke = rest.active === false || rest.role !== undefined || rest.warehouseId !== undefined || rest.staffId !== undefined;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { user } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    if (session.role === "MANAGER" || password) {
      const [target] = await db.select({ warehouseId: user.warehouseId }).from(user).where(eq(user.id, id));
      if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (session.role === "MANAGER") {
        const forbidden = assertWarehouseAccess(session, target.warehouseId ?? "");
        if (forbidden) return forbidden;
      }
    }
    const [updated] = await db
      .update(user)
      .set({ ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) })
      .where(eq(user.id, id))
      .returning();
    if (mustRevoke) await clearActiveSid(id).catch(() => {});
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "USER_UPDATED", entityType: "User", entityId: id, newValue: rest });
    const { passwordHash: _ph, ...safe } = updated!;
    return NextResponse.json(safe);
  }

  const db = (await import("@/lib/db")).getDb();
  if (session.role === "MANAGER" || password) {
    const target = await db.user.findUnique({ where: { id }, select: { warehouseId: true } });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.role === "MANAGER") {
      const forbidden = assertWarehouseAccess(session, target.warehouseId ?? "");
      if (forbidden) return forbidden;
    }
  }
  const user = await db.user.update({
    where: { id },
    data: {
      ...rest,
      ...(password ? { passwordHash: await hashPassword(password), plainPassword: password } : {}),
    },
  });
  if (mustRevoke) await clearActiveSid(id).catch(() => {});
  await (await import("@/lib/audit")).writeAudit({ userId: session.sub, role: session.role, action: "USER_UPDATED", entityType: "User", entityId: id, newValue: rest });
  const { passwordHash: _ph, ...safe } = user;
  return NextResponse.json(safe);
}
