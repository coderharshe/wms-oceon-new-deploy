import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "PAID", "CANCELLED"]),
  approvalNotes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const voucher = await db.voucher.findUnique({ where: { id } });
  if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, voucher.warehouseId);
  if (forbidden) return forbidden;

  const amt = Number(voucher.amount);

  if (parsed.data.status === "APPROVED") {
    if (amt > 25000 && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Vouchers above ₹25,000 require Sir/Admin authorization" }, { status: 403 });
    }
    if (amt > 5000 && session.role !== "ADMIN" && session.role !== "MANAGER") {
      return NextResponse.json({ error: "Vouchers above ₹5,000 require Manager authorization" }, { status: 403 });
    }
  }

  const updated = await db.voucher.update({
    where: { id },
    data: {
      status: parsed.data.status,
      approvedByUserId: parsed.data.status === "APPROVED" ? session.sub : voucher.approvedByUserId,
    },
  });

  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: voucher.warehouseId,
    action: `VOUCHER_${parsed.data.status}`,
    entityType: "Voucher",
    entityId: voucher.id,
    oldValue: { status: voucher.status },
    newValue: { status: parsed.data.status },
  });

  return NextResponse.json({ success: true, voucher: updated });
}
