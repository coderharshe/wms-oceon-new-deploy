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

const movementItemSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.number().positive("Quantity must be greater than 0"),
  notes: z.string().optional(),
});

const movementSchema = z.object({
  productId: z.string().optional(),
  quantity: z.number().positive().optional(),
  items: z.array(movementItemSchema).optional(),
  warehouseId: z.string().optional(),
  movementType: z.enum(["DAMAGE", "EXPIRY", "RETURN", "TRANSFER_OUT", "TRANSFER_IN"]),
  direction: z.enum(["OUTWARD", "INWARD"]).default("OUTWARD"),
  customerId: z.string().optional(),
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

  const {
    items: inputItems,
    productId,
    quantity,
    movementType,
    direction,
    customerName,
    orderReference,
    reason,
  } = parsed.data;

  const rawItems =
    inputItems && inputItems.length > 0
      ? inputItems
      : productId && quantity
      ? [{ productId, quantity, notes: undefined }]
      : [];

  if (rawItems.length === 0) {
    return NextResponse.json({ error: "At least one product item is required" }, { status: 400 });
  }

  const warehouseId =
    session.role === "ADMIN" && parsed.data.warehouseId
      ? parsed.data.warehouseId
      : session.warehouseId!;

  if (!warehouseId) {
    return NextResponse.json({ error: "Warehouse location is required" }, { status: 400 });
  }

  const db = getDb();

  try {
    const isInward = direction === "INWARD";

    // 1. Pre-validate stock availability for all outward items
    if (!isInward) {
      for (const item of rawItems) {
        const inv = await db.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          include: { product: { select: { name: true, sku: true } } },
        });

        const currentQty = inv ? Number(inv.quantityOnHand) : 0;
        if (currentQty < item.quantity) {
          const prodLabel = inv?.product ? `${inv.product.name} (${inv.product.sku})` : item.productId;
          return NextResponse.json(
            {
              error: `Insufficient stock for ${prodLabel}. Current on-hand is ${currentQty}, attempted to deduct ${item.quantity}.`,
            },
            { status: 400 }
          );
        }
      }
    }

    const referenceType = isInward
      ? "CUSTOMER_RETURN"
      : movementType === "RETURN"
      ? "SUPPLIER_RETURN"
      : "OUTWARD_DISPATCH";

    const baseRefNotes = [
      customerName ? `Customer: ${customerName}` : "",
      orderReference ? `Ref: ${orderReference}` : "",
      reason,
    ]
      .filter(Boolean)
      .join(" | ");

    // 2. Perform atomic updates for all items
    const createdMovements = await db.$transaction(async (tx) => {
      const results = [];

      for (const item of rawItems) {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
        });

        const currentQty = inv ? Number(inv.quantityOnHand) : 0;
        const delta = isInward ? item.quantity : -item.quantity;
        const afterQty = currentQty + delta;

        if (!isInward && afterQty < 0) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }

        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          update: { quantityOnHand: afterQty },
          create: { productId: item.productId, warehouseId, quantityOnHand: afterQty },
        });

        const itemRefNotes = item.notes ? `${baseRefNotes} (Item note: ${item.notes})` : baseRefNotes;

        const move = await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            warehouseId,
            beforeQty: currentQty,
            movementQty: delta,
            afterQty,
            movementType,
            referenceType,
            referenceId: itemRefNotes,
            userId: session.sub,
          },
        });

        results.push(move);
      }

      return results;
    });

    // 3. Write audit log
    for (const move of createdMovements) {
      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId,
        action: `${direction}_${movementType}`,
        entityType: "InventoryMovement",
        entityId: move.id,
        reason: baseRefNotes,
        oldValue: { onHand: Number(move.beforeQty) },
        newValue: {
          onHand: Number(move.afterQty),
          delta: Number(move.movementQty),
          direction,
          movementType,
          customerName: customerName || null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      count: createdMovements.length,
      movement: createdMovements[0],
      movements: createdMovements,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to process inventory movement" },
      { status: 500 }
    );
  }
}
