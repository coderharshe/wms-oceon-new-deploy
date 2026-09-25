import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// Credit is a control, not a counter clerk's field. Finance CAN now correct a
// customer's details — a GST invoice needs a GSTIN and an address, and the
// customer records that predate GST billing mostly have neither, so making
// the counter wait for a manager to type an address means no tax invoice gets
// raised at all. What Finance still cannot touch is the money and access
// half: `creditLimit` (how much they may owe) and `status` (whether they may
// be sold to). Those stay ADMIN/MANAGER, which is what the original rule was
// actually protecting. `creditLimit: null` clears the limit (= unlimited).
const FINANCE_FORBIDDEN = ["creditLimit", "status"] as const;
const schema = z.object({
  shopName: z.string().trim().min(1).optional(),
  ownerName: z.string().trim().nullable().optional(),
  mobile: z.string().trim().min(1).nullable().optional(), // null clears it — mobile is not mandatory
  address: z.string().trim().nullable().optional(),
  gstin: z.string().trim().nullable().optional(),
  type: z.enum(["WHOLESALE", "RETAIL"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  notes: z.string().trim().nullable().optional(),
  creditLimit: z.number().min(0).nullable().optional(),
});

const DUPLICATE_MOBILE_ERROR = { error: "A customer with this mobile number is already registered" } as const;
// Same duplicate-mobile handling as the create route: Prisma reports P2002,
// the raw pg driver Drizzle uses reports SQLSTATE 23505.
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof PrismaClientKnownRequestError) return err.code === "P2002";
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid customer details" }, { status: 400 });
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // Refused, not silently dropped: a screen that thinks it set a credit limit
  // and got a 200 back is worse than one told it may not.
  if (session.role === "FINANCE") {
    const blocked = FINANCE_FORBIDDEN.filter((k) => k in patch);
    if (blocked.length) {
      return NextResponse.json({ error: `Only a manager can change ${blocked.join(" and ")}` }, { status: 403 });
    }
  }

  // outstandingBalance is deliberately NOT patchable here — it is a ledger
  // figure, moved only by the POST below (or by the payment ledger itself).
  const action = "creditLimit" in patch && Object.keys(patch).length === 1 ? "CUSTOMER_CREDIT_LIMIT_UPDATED" : "CUSTOMER_UPDATED";

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { customer } = await import("@/generated/drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();

      const [existing] = await db.select().from(customer).where(eq(customer.id, id));
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const [updated] = await db
        .update(customer)
        // creditLimit is numeric in the schema, so Drizzle wants it as a string.
        .set({ ...patch, creditLimit: patch.creditLimit == null ? patch.creditLimit : patch.creditLimit.toString() })
        .where(eq(customer.id, id))
        .returning();
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId,
        action,
        entityType: "Customer",
        entityId: id,
        oldValue: existing,
        newValue: patch,
      });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const updated = await db.customer.update({ where: { id }, data: patch });
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action,
      entityType: "Customer",
      entityId: id,
      oldValue: { ...existing, creditLimit: existing.creditLimit?.toString() ?? null, outstandingBalance: existing.outstandingBalance.toString() },
      newValue: patch,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json(DUPLICATE_MOBILE_ERROR, { status: 409 });
    throw err;
  }
}

// Positive = the customer owes MORE (a charge), negative = they owe LESS (a
// credit note or an off-system settlement). Same sign convention as
// Customer.outstandingBalance itself — see payment-service's receivable notes.
const adjustSchema = z.object({
  amount: z.number().refine((n) => n !== 0, "Amount cannot be zero"),
  reason: z.string().trim().min(1),
});

/**
 * Manually moves a customer's outstanding balance.
 *
 * For the cases the payment ledger cannot see: a written-off dues, a
 * settlement taken outside the system, an opening balance. Every move needs a
 * reason and lands in the audit trail, because nothing else reconciles it.
 * The balance is clamped at zero — a customer cannot owe a negative amount,
 * and a credit beyond their dues is not tracked as store credit here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = adjustSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "An amount and a reason are required" }, { status: 400 });
  const { amount, reason } = parsed.data;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { customer } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(customer).where(eq(customer.id, id)).for("update");
      if (!existing) return null;
      const next = Math.max(0, Number(existing.outstandingBalance) + amount);
      const [row] = await tx.update(customer).set({ outstandingBalance: next.toFixed(2) }).where(eq(customer.id, id)).returning();
      return { row, before: existing.outstandingBalance };
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action: "CUSTOMER_BALANCE_ADJUSTED",
      entityType: "Customer",
      entityId: id,
      oldValue: { outstandingBalance: updated.before },
      newValue: { outstandingBalance: updated.row!.outstandingBalance, amount },
      reason,
    });
    return NextResponse.json(updated.row);
  }

  const db = (await import("@/lib/db")).getDb();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    const existing = await tx.customer.findUnique({ where: { id } });
    if (!existing) return null;
    const next = Math.max(0, Number(existing.outstandingBalance) + amount);
    const row = await tx.customer.update({ where: { id }, data: { outstandingBalance: next } });
    return { row, before: existing.outstandingBalance.toString() };
  });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId,
    action: "CUSTOMER_BALANCE_ADJUSTED",
    entityType: "Customer",
    entityId: id,
    oldValue: { outstandingBalance: result.before },
    newValue: { outstandingBalance: result.row.outstandingBalance.toString(), amount },
    reason,
  });
  return NextResponse.json(result.row);
}
