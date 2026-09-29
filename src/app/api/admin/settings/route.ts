import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getSetting, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { THEME_NAMES } from "@/lib/themes";
import { isGstin } from "@/lib/gst";
import { isWorkersRuntime } from "@/lib/cf-env";

const STANDARD_KEYS = [
  "BUSINESS_NAME",
  "BUSINESS_GSTIN",
  "BUSINESS_ADDRESS",
  "BUSINESS_EMAIL",
  "BUSINESS_PHONE",
  "UPI_VPA",
  "GSTIN_LOOKUP_URL",
  "GSTIN_LOOKUP_KEY",
  "GSTIN_LOOKUP_PATHS",
  "THEME_MANAGER",
  "THEME_FINANCE",
  "FONT_SIZE_MANAGER",
  "FONT_SIZE_FINANCE",
] as const;

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const result: Record<string, string> = {};

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { systemSetting } = await import("@/generated/drizzle/schema");
    const db = getDrizzleDb();
    const rows = await db.select().from(systemSetting);
    for (const r of rows) {
      if (r.value !== null && r.value !== undefined) {
        result[r.key] = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
      }
    }
  } else {
    const db = (await import("@/lib/db")).getDb();
    const rows = await db.systemSetting.findMany();
    for (const r of rows) {
      if (r.value !== null && r.value !== undefined) {
        result[r.key] = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
      }
    }
  }

  // Ensure standard keys exist in response
  for (const k of STANDARD_KEYS) {
    if (result[k] === undefined) {
      result[k] = await getSetting(k);
    }
  }

  return NextResponse.json(result);
}

const schema = z
  .object({ key: z.string().min(1), value: z.string() })
  .refine((v) => !v.key.startsWith("THEME_") || THEME_NAMES.includes(v.value), {
    message: "Unknown theme",
    path: ["value"],
  })
  .refine((v) => !v.key.includes("GSTIN") || v.value.trim() === "" || isGstin(v.value), {
    message: "Not a valid GSTIN format (15 characters required)",
    path: ["value"],
  });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await setSetting(parsed.data.key, parsed.data.value);
  await writeAudit({ userId: session.sub, role: session.role, action: "SETTING_UPDATED", entityType: "SystemSetting", entityId: parsed.data.key, newValue: parsed.data });
  return NextResponse.json({ ok: true });
}
