import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const orders = await db.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, phone: true, contactPerson: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        createdByUser: { select: { id: true, name: true, staffId: true } },
        approvedByUser: { select: { id: true, name: true, staffId: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
        purchaseBills: { select: { id: true, grnNumber: true, total: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(orders);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load purchase orders" }, { status: 500 });
  }
}

const poItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
  unitId: z.string().min(1),
  purchaseRate: z.number().positive(),
  schemeDiscount: z.number().default(0),
  taxPercent: z.number().default(0),
});

const createPoSchema = z.object({
  supplierId: z.string().min(1),
  warehouseId: z.string().optional(),
  creditDays: z.number().default(0),
  expectedDelivery: z.string().optional(),
  freightCharges: z.number().default(0),
  otherCharges: z.number().default(0),
  schemeDiscount: z.number().default(0),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;

  const parsed = createPoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    let subtotal = 0;
    let gstAmount = 0;

    const lineItems = parsed.data.items.map((item) => {
      const lineSub = item.quantity * item.purchaseRate - item.schemeDiscount;
      const tax = (lineSub * item.taxPercent) / 100;
      const lineTotal = lineSub + tax;
      subtotal += lineSub;
      gstAmount += tax;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitId: item.unitId,
        purchaseRate: item.purchaseRate,
        schemeDiscount: item.schemeDiscount,
        taxPercent: item.taxPercent,
        lineTotal,
      };
    });

    const total = subtotal + gstAmount + parsed.data.freightCharges + parsed.data.otherCharges - parsed.data.schemeDiscount;

    // Determine initial approval status according to OCEON tiered approval matrix
    let initialStatus: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" = "APPROVED";
    let approvedByUserId: string | null = null;

    if (total > 50000) {
      if (session.role === "ADMIN") {
        initialStatus = "APPROVED";
        approvedByUserId = session.sub;
      } else {
        initialStatus = "PENDING_APPROVAL"; // Requires Sir/Admin
      }
    } else if (total > 10000) {
      if (session.role === "ADMIN" || session.role === "MANAGER") {
        initialStatus = "APPROVED";
        approvedByUserId = session.sub;
      } else {
        initialStatus = "PENDING_APPROVAL"; // Requires Manager/Admin
      }
    } else {
      // <= 10,000: Procurement officer can approve directly
      initialStatus = "APPROVED";
      approvedByUserId = session.sub;
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.purchaseOrder.count();
    const poNumber = `PO-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    const po = await db.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: parsed.data.supplierId,
        warehouseId,
        status: initialStatus,
        subtotal,
        gstAmount,
        freightCharges: parsed.data.freightCharges,
        otherCharges: parsed.data.otherCharges,
        schemeDiscount: parsed.data.schemeDiscount,
        total,
        creditDays: parsed.data.creditDays,
        expectedDelivery: parsed.data.expectedDelivery ? new Date(parsed.data.expectedDelivery) : null,
        notes: parsed.data.notes,
        createdByUserId: session.sub,
        approvedByUserId,
        items: {
          create: lineItems,
        },
      },
      include: {
        items: true,
        supplier: true,
      },
    });

    return NextResponse.json({ success: true, po });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create PO" }, { status: 500 });
  }
}
