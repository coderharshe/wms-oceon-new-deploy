import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const settlements = await db.uPISettlement.findMany({
      where,
      orderBy: { collectionDate: "desc" },
      take: 100,
    });

    let totalCollected = 0;
    let totalSettled = 0;
    let totalCharges = 0;

    for (const s of settlements) {
      totalCollected += Number(s.collectedAmount);
      totalSettled += Number(s.settlementAmount || 0);
      totalCharges += Number(s.chargesAmount || 0);
    }

    return NextResponse.json({
      totalCollected,
      totalSettled,
      totalCharges,
      pendingSettlement: totalCollected - (totalSettled + totalCharges),
      settlements,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load UPI settlements" }, { status: 500 });
  }
}

const updateSettlementSchema = z.object({
  id: z.string().min(1),
  settlementDate: z.string().min(1),
  settlementAmount: z.number().min(0),
  chargesAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = updateSettlementSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();

  try {
    const record = await db.uPISettlement.findUnique({ where: { id: parsed.data.id } });
    if (!record) return NextResponse.json({ error: "Settlement record not found" }, { status: 404 });

    const collected = Number(record.collectedAmount);
    const settled = parsed.data.settlementAmount;
    const charges = parsed.data.chargesAmount;
    const diff = collected - (settled + charges);

    const status = Math.abs(diff) < 0.05 ? "SETTLED" : "DISCREPANCY";

    const updated = await db.uPISettlement.update({
      where: { id: parsed.data.id },
      data: {
        settlementDate: new Date(parsed.data.settlementDate),
        settlementAmount: settled,
        chargesAmount: charges,
        status,
        notes: parsed.data.notes || (status === "DISCREPANCY" ? `Settlement discrepancy of ₹${diff.toFixed(2)}` : undefined),
      },
    });

    return NextResponse.json({ success: true, settlement: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update settlement" }, { status: 500 });
  }
}
