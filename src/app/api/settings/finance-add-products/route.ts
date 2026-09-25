import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { financeCanAddProducts } from "@/lib/settings";
import { isWorkersRuntime } from "@/lib/cf-env";

// Finance's order screen reads this to decide whether to offer "add this as a
// new product" when a search comes back empty; the manager screen reads it to
// render the switch. The POST route that actually creates a product enforces
// the same setting, so turning it off is not merely a hidden button.
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  return NextResponse.json({ enabled: await financeCanAddProducts() });
}

const schema = z.object({ enabled: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { setSetting } = await import("@/lib/settings");
  await setSetting("FINANCE_ADD_PRODUCTS", String(parsed.data.enabled));
  const { writeAudit } = isWorkersRuntime()
    ? { writeAudit: (await import("@/lib/drizzle-audit")).writeAuditDrizzle }
    : await import("@/lib/audit");
  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId ?? undefined,
    action: "FINANCE_ADD_PRODUCTS_TOGGLED",
    entityType: "SystemSetting",
    entityId: "FINANCE_ADD_PRODUCTS",
    newValue: { enabled: parsed.data.enabled },
  });
  return NextResponse.json({ enabled: parsed.data.enabled });
}
