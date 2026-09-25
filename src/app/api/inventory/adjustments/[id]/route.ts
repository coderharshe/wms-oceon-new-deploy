import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

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
  const adj = await db.stockAdjustmentRequest.findUnique({ where: { id } });
  if (!adj) return NextResponse.json({ error: "Stock adjustment request not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, adj.warehouseId);
  if (forbidden) return forbidden;

  if (adj.status !== "PENDING") {
    return NextResponse.json({ error: "Adjustment request has already been finalized" }, { status: 400 });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const record = await tx.stockAdjustmentRequest.update({
        where: { id },
        data: {
          status: parsed.data.status,
          approvalNotes: parsed.data.approvalNotes,
          approvedByUserId: session.sub,
        },
      });

      if (parsed.data.status === "APPROVED") {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: adj.productId, warehouseId: adj.warehouseId } },
        });

        const beforeQty = inv ? Number(inv.quantityOnHand) : 0;
        const physicalQty = Number(adj.physicalQty);
        const diff = physicalQty - beforeQty;

        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId: adj.productId, warehouseId: adj.warehouseId } },
          update: { quantityOnHand: physicalQty },
          create: { productId: adj.productId, warehouseId: adj.warehouseId, quantityOnHand: physicalQty },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: adj.productId,
            warehouseId: adj.warehouseId,
            beforeQty,
            movementQty: diff,
            afterQty: physicalQty,
            movementType: "STOCK_COUNT_ADJUSTMENT",
            referenceType: "ADJUSTMENT_REQUEST",
            referenceId: adj.id,
            userId: session.sub,
          },
        });
      }

      return record;
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: adj.warehouseId,
      action: `STOCK_ADJUSTMENT_${parsed.data.status}`,
      entityType: "StockAdjustmentRequest",
      entityId: adj.id,
      oldValue: { systemQty: adj.systemQty, physicalQty: adj.physicalQty },
      newValue: { status: parsed.data.status, approvalNotes: parsed.data.approvalNotes },
    });

    return NextResponse.json({ success: true, adjustment: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process adjustment" }, { status: 500 });
  }
}
