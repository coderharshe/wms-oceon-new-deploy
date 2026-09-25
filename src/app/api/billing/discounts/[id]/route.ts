import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { getDb } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  approvalNotes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const reqItem = await db.discountApproval.findUnique({ where: { id } });
  if (!reqItem) return NextResponse.json({ error: "Discount request not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, reqItem.warehouseId);
  if (forbidden) return forbidden;

  const pct = Number(reqItem.discountPercent);

  // Authorization check for approval tier
  if (parsed.data.status === "APPROVED") {
    if (pct > 5 && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Discounts greater than 5% require Sir/Admin approval" }, { status: 403 });
    }
  }

  const updated = await db.discountApproval.update({
    where: { id },
    data: {
      status: parsed.data.status,
      approvalNotes: parsed.data.approvalNotes,
      approvedByUserId: session.sub,
    },
  });

  return NextResponse.json({ success: true, discountApproval: updated });
}
