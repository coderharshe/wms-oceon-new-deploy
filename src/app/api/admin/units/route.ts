import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { cachedJson, invalidateJson } from "@/lib/kv-cache";
import { isWorkersRuntime } from "@/lib/cf-env";

// Units change only via deliberate admin action — a generous TTL is safe,
// and every product/order/QC screen loads this list on mount.
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "QC", "INVENTORY", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { unit } = await import("@/generated/drizzle/schema");
    const { asc } = await import("drizzle-orm");
    const units = await cachedJson("units:all", 300, () => getDrizzleDb().select().from(unit).orderBy(asc(unit.symbol)));
    return NextResponse.json(units);
  }

  const db = (await import("@/lib/db")).getDb();
  const units = await cachedJson("units:all", 300, () => db.unit.findMany({ orderBy: { symbol: "asc" } }));
  return NextResponse.json(units);
}

const schema = z.object({ name: z.string().min(1), symbol: z.string().min(1), type: z.enum(["WEIGHT", "VOLUME", "COUNT", "CUSTOM"]) });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { unit } = await import("@/generated/drizzle/schema");
    const [created] = await getDrizzleDb().insert(unit).values({ id: crypto.randomUUID(), ...parsed.data }).returning();
    await invalidateJson("units:all");
    return NextResponse.json(created, { status: 201 });
  }

  const db = (await import("@/lib/db")).getDb();
  const unit = await db.unit.create({ data: parsed.data });
  await invalidateJson("units:all");
  return NextResponse.json(unit, { status: 201 });
}
