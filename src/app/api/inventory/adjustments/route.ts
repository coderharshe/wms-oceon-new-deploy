import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const adjustments = await db.stockAdjustmentRequest.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } } } },
        requestedByUser: { select: { id: true, name: true, staffId: true } },
        approvedByUser: { select: { id: true, name: true, staffId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(adjustments);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load adjustments" }, { status: 500 });
  }
}
