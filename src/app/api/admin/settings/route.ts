import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getSetting, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { THEME_NAMES } from "@/lib/themes";
import { isGstin } from "@/lib/gst";

const KEYS = ["BUSINESS_NAME", "BUSINESS_GSTIN", "BUSINESS_ADDRESS", "BUSINESS_EMAIL", "UPI_VPA", "GSTIN_LOOKUP_URL", "GSTIN_LOOKUP_KEY", "GSTIN_LOOKUP_PATHS", "THEME_MANAGER", "THEME_FINANCE", "FONT_SIZE_MANAGER", "FONT_SIZE_FINANCE"] as const;

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const values = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await getSetting(k)])));
  return NextResponse.json(values);
}

// A theme name that isn't one of ours would paint the portal in the defaults
// with no hint as to why, so it's refused here rather than swallowed.
const schema = z
  .object({ key: z.enum(KEYS), value: z.string() })
  .refine((v) => !v.key.startsWith("THEME_") || THEME_NAMES.includes(v.value), {
    message: "Unknown theme",
    path: ["value"],
  })
  // A malformed GSTIN would reach the printed tax invoice, where it is a legal
  // claim about the business — and the state code and PAN on that invoice are
  // read straight off it. Blank is allowed: a shop that isn't registered.
  .refine((v) => v.key !== "BUSINESS_GSTIN" || v.value.trim() === "" || isGstin(v.value), {
    message: "Not a valid GSTIN",
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
