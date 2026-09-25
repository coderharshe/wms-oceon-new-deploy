import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const DUPLICATE_MOBILE_ERROR = { error: "A customer with this mobile number is already registered" } as const;
// Postgres unique_violation SQLSTATE — how a duplicate surfaces from the raw
// `pg` driver Drizzle uses; Prisma wraps the same case as P2002 instead.
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof PrismaClientKnownRequestError) return err.code === "P2002";
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { customer } = await import("@/generated/drizzle/schema");
    const { or, ilike, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const where = q ? or(ilike(customer.shopName, `%${q}%`), ilike(customer.mobile, `%${q}%`), ilike(customer.ownerName, `%${q}%`)) : undefined;
    const customers = await db.select().from(customer).where(where).orderBy(asc(customer.shopName)).limit(25);
    return NextResponse.json(customers);
  }

  const db = (await import("@/lib/db")).getDb();
  const customers = await db.customer.findMany({
    where: q
      ? {
          OR: [
            { shopName: { contains: q, mode: "insensitive" } },
            { mobile: { contains: q } },
            { ownerName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    take: 25,
    orderBy: { shopName: "asc" },
  });
  return NextResponse.json(customers);
}

const createSchema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().optional(),
  mobile: z.string().trim().min(1).optional(), // walk-ins often give no number
  address: z.string().optional(),
  gstin: z.string().optional(),
  type: z.enum(["WHOLESALE", "RETAIL"]),
  creditLimit: z.number().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { customer } = await import("@/generated/drizzle/schema");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();
      const [created] = await db
        .insert(customer)
        .values({
          id: crypto.randomUUID(),
          shopName: parsed.data.shopName,
          ownerName: parsed.data.ownerName,
          mobile: parsed.data.mobile,
          address: parsed.data.address,
          gstin: parsed.data.gstin,
          type: parsed.data.type,
          creditLimit: parsed.data.creditLimit?.toString(),
          notes: parsed.data.notes,
        })
        .returning();
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        warehouseId: session.warehouseId,
        action: "CUSTOMER_CREATED",
        entityType: "Customer",
        entityId: created!.id,
        newValue: parsed.data,
      });
      return NextResponse.json(created, { status: 201 });
    }

    const db = (await import("@/lib/db")).getDb();
    const customer = await db.customer.create({ data: parsed.data });
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: session.warehouseId,
      action: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: customer.id,
      newValue: parsed.data,
    });
    return NextResponse.json(customer, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json(DUPLICATE_MOBILE_ERROR, { status: 409 });
    throw err;
  }
}
