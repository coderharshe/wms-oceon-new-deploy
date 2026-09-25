import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const requisitions = await db.purchaseRequisition.findMany({
      where,
      include: {
        warehouse: { select: { name: true, code: true } },
        requestedByUser: { select: { name: true, staffId: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } } },
            },
            suggestedSupplier: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(requisitions);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load requisitions" }, { status: 500 });
  }
}

const reqItemSchema = z.object({
  productId: z.string().min(1),
  requiredQty: z.number().positive(),
  currentStock: z.number().default(0),
  reorderLevel: z.number().optional(),
  suggestedSupplierId: z.string().optional(),
  notes: z.string().optional(),
});

const createReqSchema = z.object({
  warehouseId: z.string().optional(),
  notes: z.string().optional(),
  autoGenerateFromLowStock: z.boolean().optional(),
  items: z.array(reqItemSchema).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const parsed = createReqSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.purchaseRequisition.count();
    const requisitionNo = `REQ-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    // Auto-generate from low stock if requested
    if (parsed.data.autoGenerateFromLowStock) {
      const inventoryItems = await db.inventory.findMany({
        where: { warehouseId },
        include: {
          product: {
            include: {
              supplierRates: {
                orderBy: { rate: "asc" },
                take: 1,
              },
            },
          },
        },
      });

      const lowStockLines = [];
      for (const inv of inventoryItems) {
        const minStock = Number(inv.product.minStock || 0);
        const qty = Number(inv.quantityOnHand);
        if (minStock > 0 && qty < minStock) {
          const shortage = minStock - qty;
          const bestSupplier = inv.product.supplierRates[0]?.supplierId;
          lowStockLines.push({
            productId: inv.productId,
            requiredQty: shortage > 0 ? shortage : minStock,
            currentStock: qty,
            reorderLevel: minStock,
            suggestedSupplierId: bestSupplier,
            notes: "Auto-generated from reorder level threshold",
          });
        }
      }

      if (lowStockLines.length === 0) {
        return NextResponse.json({ error: "No low stock items found to generate requisition" }, { status: 400 });
      }

      const requisition = await db.purchaseRequisition.create({
        data: {
          requisitionNo,
          warehouseId,
          requestedByUserId: session.sub,
          notes: parsed.data.notes || "Auto-generated requisition for low stock SKUs",
          items: {
            create: lowStockLines.map((line) => ({
              productId: line.productId,
              requiredQty: line.requiredQty,
              currentStock: line.currentStock,
              reorderLevel: line.reorderLevel,
              suggestedSupplierId: line.suggestedSupplierId,
              notes: line.notes,
            })),
          },
        },
        include: { items: true },
      });

      return NextResponse.json({ success: true, requisition });
    }

    if (!parsed.data.items || parsed.data.items.length === 0) {
      return NextResponse.json({ error: "Requisition items are required" }, { status: 400 });
    }

    const requisition = await db.purchaseRequisition.create({
      data: {
        requisitionNo,
        warehouseId,
        requestedByUserId: session.sub,
        notes: parsed.data.notes,
        items: {
          create: parsed.data.items.map((i) => ({
            productId: i.productId,
            requiredQty: i.requiredQty,
            currentStock: i.currentStock,
            reorderLevel: i.reorderLevel,
            suggestedSupplierId: i.suggestedSupplierId,
            notes: i.notes,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json({ success: true, requisition });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create requisition" }, { status: 500 });
  }
}
