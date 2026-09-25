import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isQcEnabled } from "@/lib/settings";
import { isWorkersRuntime } from "@/lib/cf-env";

// Every role reads this — Finance's order screen has to know whether the
// button hands the order to QC or completes it outright.
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "QC"]);
  if (isErrorResponse(session)) return session;
  return NextResponse.json({ enabled: await isQcEnabled() });
}

const schema = z.object({ enabled: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { setSetting } = await import("@/lib/settings");
  await setSetting("QC_ENABLED", String(parsed.data.enabled));
  const { writeAudit } = isWorkersRuntime()
    ? { writeAudit: (await import("@/lib/drizzle-audit")).writeAuditDrizzle }
    : await import("@/lib/audit");
  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId ?? undefined,
    action: "QC_STAGE_TOGGLED",
    entityType: "SystemSetting",
    entityId: "QC_ENABLED",
    newValue: { enabled: parsed.data.enabled },
  });
  return NextResponse.json({ enabled: parsed.data.enabled });
}
