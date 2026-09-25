import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {
      movementType: { in: ["DAMAGE", "EXPIRY", "RETURN", "TRANSFER_OUT"] },
    };
    if (warehouseId) where.warehouseId = warehouseId;

    const outwardMoves = await db.inventoryMovement.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } } } },
        user: { select: { id: true, name: true, staffId: true } },
        warehouse: { select: { name: true, code: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 100,
    });

    return NextResponse.json(outwardMoves);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load outward history" }, { status: 500 });
  }
}

const outwardSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().optional(),
  quantity: z.number().positive(),
  movementType: z.enum(["DAMAGE", "EXPIRY", "RETURN", "TRANSFER_OUT"]),
  reason: z.string().min(3, "Mandatory reason explaining the outward movement"),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const parsed = outwardSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const inv = await db.inventory.findUnique({
      where: { productId_warehouseId: { productId: parsed.data.productId, warehouseId } },
    });

    const currentQty = inv ? Number(inv.quantityOnHand) : 0;
    const qtyDeducted = parsed.data.quantity;
    const afterQty = currentQty - qtyDeducted;

    const move = await db.$transaction(async (tx) => {
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId: parsed.data.productId, warehouseId } },
        update: { quantityOnHand: afterQty },
        create: { productId: parsed.data.productId, warehouseId, quantityOnHand: afterQty },
      });

      return await tx.inventoryMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId,
          beforeQty: currentQty,
          movementQty: -qtyDeducted,
          afterQty,
          movementType: parsed.data.movementType,
          referenceType: "OUTWARD_DISPATCH",
          referenceId: parsed.data.reason,
          userId: session.sub,
        },
      });
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: `OUTWARD_${parsed.data.movementType}`,
      entityType: "InventoryMovement",
      entityId: move.id,
      reason: parsed.data.reason,
      oldValue: { onHand: currentQty },
      newValue: { onHand: afterQty, deducted: qtyDeducted, movementType: parsed.data.movementType },
    });

    return NextResponse.json({ success: true, movement: move });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process stock outward" }, { status: 500 });
  }
}
