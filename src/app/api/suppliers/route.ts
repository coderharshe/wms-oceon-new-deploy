import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";
import { supplierSchema } from "@/lib/purchase";

// Suppliers are warehouse-agnostic master data (the same wholesaler delivers
// to every branch), so no warehouse scoping on the supplier row itself — but
// the credit figures joined on below ARE scoped, because a branch manager has
// no business seeing what another branch owes.

type Credit = { bills: number; outstanding: number; lastBillDate: string | null };

// Suppliers with no bills yet still need the zeros — the screen shows a
// column, not a blank.
const NO_CREDIT: Credit = { bills: 0, outstanding: 0, lastBillDate: null };

function mergeCredit<T extends { id: string }>(rows: T[], credit: Map<string, Credit>) {
  return rows.map((r) => ({ ...r, ...(credit.get(r.id) ?? NO_CREDIT) }));
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  // Receiving staff only ever pick from active suppliers; the supplier
  // management screen passes includeInactive=1 to manage the rest.
  const canManage = session.role === "ADMIN" || session.role === "MANAGER";
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1" && canManage;
  // Credit history: how many bills this supplier has sent, how much of it is
  // still unpaid, and when we last received from them. Skipped for the
  // receive form's picker (`withCredit` unset) — that just needs the names.
  const withCredit = req.nextUrl.searchParams.get("withCredit") === "1" && canManage;
  // ADMIN sees every branch's dues; everyone else only their own.
  const scopeWarehouseId = session.role === "ADMIN" ? null : session.warehouseId!;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { supplier } = await import("@/generated/drizzle/schema");
    const { and, or, ilike, eq, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const filters = [
      includeInactive ? undefined : eq(supplier.active, true),
      q ? or(ilike(supplier.name, `%${q}%`), ilike(supplier.phone, `%${q}%`), ilike(supplier.gstin, `%${q}%`)) : undefined,
    ].filter(Boolean);
    const rows = await db
      .select()
      .from(supplier)
      .where(filters.length ? and(...(filters as any[])) : undefined)
      .orderBy(asc(supplier.name))
      .limit(100);
    if (!withCredit) return NextResponse.json(rows);
    const { purchaseBill } = await import("@/generated/drizzle/schema");
    const { sql, count, max } = await import("drizzle-orm");
    // One grouped pass over the branch's bills: total count, the unpaid part
    // of it, and the last receipt date. Cheap enough not to bother caching —
    // PurchaseBill is a few rows per supplier per month.
    const agg = await db
      .select({
        supplierId: purchaseBill.supplierId,
        bills: count(),
        outstanding: sql<number>`coalesce(sum(case when ${purchaseBill.paymentStatus} <> 'PAID' then ${purchaseBill.total} else 0 end), 0)::float8`,
        lastBillDate: max(purchaseBill.billDate),
      })
      .from(purchaseBill)
      .where(scopeWarehouseId ? eq(purchaseBill.warehouseId, scopeWarehouseId) : undefined)
      .groupBy(purchaseBill.supplierId);
    const credit = new Map(
      agg.map((a) => [a.supplierId, { bills: a.bills, outstanding: Number(a.outstanding), lastBillDate: a.lastBillDate }]),
    );
    return NextResponse.json(mergeCredit(rows, credit));
  }

  const db = (await import("@/lib/db")).getDb();
  const rows = await db.supplier.findMany({
    where: {
      ...(includeInactive ? {} : { active: true }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q } },
              { gstin: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  if (!withCredit) return NextResponse.json(rows);
  // Two groupBys rather than one: Prisma can't express a conditional SUM, and
  // this path only ever runs under `next dev`.
  const where = scopeWarehouseId ? { warehouseId: scopeWarehouseId } : {};
  const [counts, unpaid] = await Promise.all([
    db.purchaseBill.groupBy({ by: ["supplierId"], _count: { _all: true }, _max: { billDate: true }, where }),
    db.purchaseBill.groupBy({ by: ["supplierId"], _sum: { total: true }, where: { ...where, paymentStatus: { not: "PAID" as const } } }),
  ]);
  const outstanding = new Map(unpaid.map((u) => [u.supplierId, Number(u._sum.total ?? 0)]));
  const credit = new Map(
    counts.map((c) => [
      c.supplierId,
      {
        bills: c._count._all,
        outstanding: outstanding.get(c.supplierId) ?? 0,
        lastBillDate: c._max.billDate ? c._max.billDate.toISOString().slice(0, 10) : null,
      },
    ]),
  );
  return NextResponse.json(mergeCredit(rows, credit));
}


// Anyone who can receive stock can add a supplier — a new supplier's truck at
// the gate must not wait on an admin. Admin cleans up/deactivates later.
export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = supplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = {
    ...parsed.data,
    name: parsed.data.name.trim(),
    email: parsed.data.email || undefined,
    gstin: parsed.data.gstin ? parsed.data.gstin.toUpperCase() : undefined,
  };

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { supplier } = await import("@/generated/drizzle/schema");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();
      const [created] = await db.insert(supplier).values({ id: crypto.randomUUID(), ...data }).returning();
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId,
        action: "SUPPLIER_CREATED",
        entityType: "Supplier",
        entityId: created!.id,
        newValue: data,
      });
      return NextResponse.json(created, { status: 201 });
    }

    const db = (await import("@/lib/db")).getDb();
    const created = await db.supplier.create({ data });
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action: "SUPPLIER_CREATED",
      entityType: "Supplier",
      entityId: created.id,
      newValue: data,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "A supplier with this name already exists" }, { status: 409 });
    throw err;
  }
}
