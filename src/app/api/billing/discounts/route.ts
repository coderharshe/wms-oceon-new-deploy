import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "BILLING", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const status = req.nextUrl.searchParams.get("status") ?? undefined;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const discounts = await db.discountApproval.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        order: { select: { id: true, orderNumber: true, status: true, customer: { select: { shopName: true } } } },
        requestedByUser: { select: { id: true, name: true, staffId: true } },
        approvedByUser: { select: { id: true, name: true, staffId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(discounts);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load discount requests" }, { status: 500 });
  }
}

const createDiscountReqSchema = z.object({
  orderId: z.string().optional(),
  warehouseId: z.string().optional(),
  discountPercent: z.number().min(0).max(100),
  discountAmount: z.number().min(0),
  billAmount: z.number().positive(),
  reason: z.string().min(2, "Reason for discount is mandatory"),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "BILLING", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = createDiscountReqSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const pct = parsed.data.discountPercent;
    let initialStatus: "PENDING" | "APPROVED" = "PENDING";
    let approvedByUserId: string | null = null;

    // 0 - 2%: Auto-approved for billing staff
    if (pct <= 2) {
      initialStatus = "APPROVED";
      approvedByUserId = session.sub;
    } else if (pct <= 5) {
      // 2 - 5%: If created by Manager or Admin, approved immediately
      if (session.role === "ADMIN" || session.role === "MANAGER") {
        initialStatus = "APPROVED";
        approvedByUserId = session.sub;
      }
    } else {
      // 5%+: If created by Admin, approved immediately
      if (session.role === "ADMIN") {
        initialStatus = "APPROVED";
        approvedByUserId = session.sub;
      }
    }

    const discountApproval = await db.discountApproval.create({
      data: {
        orderId: parsed.data.orderId || null,
        warehouseId,
        discountPercent: parsed.data.discountPercent,
        discountAmount: parsed.data.discountAmount,
        billAmount: parsed.data.billAmount,
        reason: parsed.data.reason,
        status: initialStatus,
        requestedByUserId: session.sub,
        approvedByUserId,
      },
      include: {
        requestedByUser: { select: { name: true, staffId: true } },
      },
    });

    return NextResponse.json({ success: true, discountApproval });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit discount request" }, { status: 500 });
  }
}
