import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: true,
      createdByUser: { select: { name: true, staffId: true } },
      approvedByUser: { select: { name: true, staffId: true } },
      items: {
        include: {
          product: true,
          unit: true,
        },
      },
      purchaseBills: true,
    },
  });

  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, po.warehouseId);
  if (forbidden) return forbidden;

  return NextResponse.json(po);
}

const patchSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]),
  approvalNotes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const po = await db.purchaseOrder.findUnique({ where: { id } });
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, po.warehouseId);
  if (forbidden) return forbidden;

  // Approval matrix authorization check
  if (parsed.data.status === "APPROVED") {
    const total = Number(po.total);
    if (total > 50000 && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Purchase orders above ₹50,000 require Sir/Admin approval" }, { status: 403 });
    }
    if (total > 10000 && session.role !== "ADMIN" && session.role !== "MANAGER") {
      return NextResponse.json({ error: "Purchase orders above ₹10,000 require Manager approval" }, { status: 403 });
    }
  }

  const updated = await db.purchaseOrder.update({
    where: { id },
    data: {
      status: parsed.data.status,
      approvalNotes: parsed.data.approvalNotes,
      approvedByUserId: parsed.data.status === "APPROVED" ? session.sub : po.approvedByUserId,
    },
  });

  return NextResponse.json({ success: true, po: updated });
}
