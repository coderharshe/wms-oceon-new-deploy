import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({
  theme: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  fontFamily: z.string().nullable().optional(),
  fontSize: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { user } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const [found] = await db
      .select()
      .from(user)
      .where(eq(user.id, session.sub));

    if (!found) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const u = found as any;
    return NextResponse.json({
      id: u.id,
      staffId: u.staffId,
      name: u.name,
      role: u.role,
      theme: u.theme || "default",
      accentColor: u.accentColor || null,
      fontFamily: u.fontFamily || "inter",
      fontSize: u.fontSize || "standard",
    });
  }

  const db = (await import("@/lib/db")).getDb();
  const found = await db.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      staffId: true,
      name: true,
      role: true,
      theme: true,
      accentColor: true,
      fontFamily: true,
      fontSize: true,
    },
  });

  if (!found) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(found);
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { user } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const [updated] = await db
      .update(user)
      .set(data as any)
      .where(eq(user.id, session.sub))
      .returning();

    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const u = updated as any;
    return NextResponse.json({
      id: u.id,
      staffId: u.staffId,
      name: u.name,
      theme: u.theme,
      accentColor: u.accentColor,
      fontFamily: u.fontFamily,
      fontSize: u.fontSize,
    });
  }

  const db = (await import("@/lib/db")).getDb();
  const updated = await db.user.update({
    where: { id: session.sub },
    data,
    select: {
      id: true,
      staffId: true,
      name: true,
      theme: true,
      accentColor: true,
      fontFamily: true,
      fontSize: true,
    },
  });

  return NextResponse.json(updated);
}
