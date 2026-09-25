import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "PROCUREMENT", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const grns = await db.purchaseBill.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        receivedByUser: { select: { id: true, name: true, staffId: true } },
        purchaseOrder: { select: { id: true, poNumber: true, total: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { symbol: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(grns);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load GRN history" }, { status: 500 });
  }
}

const grnItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  unitId: z.string().min(1),
  rate: z.number().positive(),
});

const createGrnSchema = z.object({
  purchaseOrderId: z.string().optional(),
  supplierId: z.string().min(1),
  warehouseId: z.string().optional(),
  supplierBillNo: z.string().min(1),
  billDate: z.string().min(1),
  notes: z.string().optional(),
  items: z.array(grnItemSchema).min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = createGrnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.purchaseBill.count();
    const grnNumber = `GRN-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    let subtotal = 0;
    const lineItems = parsed.data.items.map((i) => {
      const amount = i.quantity * i.rate;
      subtotal += amount;
      return {
        productId: i.productId,
        quantity: i.quantity,
        unitId: i.unitId,
        rate: i.rate,
        amount,
      };
    });

    // Run in transaction: Create GRN, update inventory on-hand, write movements, update PO items receivedQty
    const result = await db.$transaction(async (tx) => {
      const pb = await tx.purchaseBill.create({
        data: {
          grnNumber,
          supplierBillNo: parsed.data.supplierBillNo,
          billDate: new Date(parsed.data.billDate),
          supplierId: parsed.data.supplierId,
          warehouseId,
          purchaseOrderId: parsed.data.purchaseOrderId || null,
          subtotal,
          total: subtotal,
          notes: parsed.data.notes,
          receivedByUserId: session.sub,
          items: {
            create: lineItems,
          },
        },
        include: { items: true },
      });

      // Update inventory and write movements
      for (const item of parsed.data.items) {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
        });

        const beforeQty = inv ? Number(inv.quantityOnHand) : 0;
        const afterQty = beforeQty + item.quantity;

        await tx.inventory.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          update: { quantityOnHand: afterQty },
          create: { productId: item.productId, warehouseId, quantityOnHand: afterQty },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            warehouseId,
            beforeQty,
            movementQty: item.quantity,
            afterQty,
            movementType: "GRN",
            referenceType: "PURCHASE_BILL",
            referenceId: pb.id,
            userId: session.sub,
          },
        });

        // Update product moving average cost
        await tx.product.update({
          where: { id: item.productId },
          data: { avgCost: item.rate },
        });
      }

      // If linked to PO, update receivedQty on PO items & PO status
      if (parsed.data.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: parsed.data.purchaseOrderId },
          include: { items: true },
        });

        if (po) {
          let allFullyReceived = true;
          for (const item of parsed.data.items) {
            const poItem = po.items.find((x) => x.productId === item.productId);
            if (poItem) {
              const newReceived = Number(poItem.receivedQty) + item.quantity;
              await tx.purchaseOrderItem.update({
                where: { id: poItem.id },
                data: { receivedQty: newReceived },
              });
              if (newReceived < Number(poItem.quantity)) {
                allFullyReceived = false;
              }
            }
          }

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: allFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED" },
          });
        }
      }

      return pb;
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: "GRN_RECEIVED",
      entityType: "PurchaseBill",
      entityId: result.id,
      newValue: { grnNumber: result.grnNumber, total: result.total, itemsCount: result.items.length },
    });

    return NextResponse.json({ success: true, grn: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process GRN" }, { status: 500 });
  }
}
