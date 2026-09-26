import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const warehouseId =
    session.role === "ADMIN"
      ? req.nextUrl.searchParams.get("warehouseId") ?? undefined
      : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {
      movementType: { in: ["DAMAGE", "EXPIRY", "RETURN", "TRANSFER_OUT", "TRANSFER_IN"] },
    };
    if (warehouseId) where.warehouseId = warehouseId;

    const moves = await db.inventoryMovement.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            baseUnit: { select: { symbol: true } },
          },
        },
        user: { select: { id: true, name: true, staffId: true } },
        warehouse: { select: { name: true, code: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    return NextResponse.json(moves);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load inventory movements history" },
      { status: 500 }
    );
  }
}

const movementSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  warehouseId: z.string().optional(),
  quantity: z.number().positive("Quantity must be greater than 0"),
  movementType: z.enum(["DAMAGE", "EXPIRY", "RETURN", "TRANSFER_OUT", "TRANSFER_IN"]),
  direction: z.enum(["OUTWARD", "INWARD"]).default("OUTWARD"),
  customerName: z.string().optional(),
  orderReference: z.string().optional(),
  reason: z.string().min(3, "Mandatory reason explaining the movement"),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const parsed = movementSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { productId, quantity, movementType, direction, customerName, orderReference, reason } =
    parsed.data;

  const warehouseId =
    session.role === "ADMIN" && parsed.data.warehouseId
      ? parsed.data.warehouseId
      : session.warehouseId!;

  if (!warehouseId) {
    return NextResponse.json({ error: "Warehouse location is required" }, { status: 400 });
  }

  const db = getDb();

  try {
    const inv = await db.inventory.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    });

    const currentQty = inv ? Number(inv.quantityOnHand) : 0;
    const isInward = direction === "INWARD";
    const delta = isInward ? quantity : -quantity;
    const afterQty = currentQty + delta;

    if (!isInward && afterQty < 0) {
      return NextResponse.json(
        {
          error: `Insufficient stock to issue outward. Current on-hand is ${currentQty}, attempted to deduct ${quantity}.`,
        },
        { status: 400 }
      );
    }

    const referenceType = isInward
      ? "CUSTOMER_RETURN"
      : movementType === "RETURN"
      ? "SUPPLIER_RETURN"
      : "OUTWARD_DISPATCH";

    const refNotes = [
      customerName ? `Customer: ${customerName}` : "",
      orderReference ? `Ref: ${orderReference}` : "",
      reason,
    ]
      .filter(Boolean)
      .join(" | ");

    const move = await db.$transaction(async (tx) => {
      await tx.inventory.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantityOnHand: afterQty },
        create: { productId, warehouseId, quantityOnHand: afterQty },
      });

      return await tx.inventoryMovement.create({
        data: {
          productId,
          warehouseId,
          beforeQty: currentQty,
          movementQty: delta,
          afterQty,
          movementType,
          referenceType,
          referenceId: refNotes,
          userId: session.sub,
        },
      });
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: `${direction}_${movementType}`,
      entityType: "InventoryMovement",
      entityId: move.id,
      reason: refNotes,
      oldValue: { onHand: currentQty },
      newValue: {
        onHand: afterQty,
        delta,
        direction,
        movementType,
        customerName: customerName || null,
      },
    });

    return NextResponse.json({ success: true, movement: move });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process inventory movement" },
      { status: 500 }
    );
  }
}
