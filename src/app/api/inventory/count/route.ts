import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const sessions = await db.stockCountSession.findMany({
      where,
      include: {
        warehouse: { select: { name: true, code: true } },
        conductedByUser: { select: { name: true, staffId: true } },
        items: {
          include: {
            product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(sessions);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load count sessions" }, { status: 500 });
  }
}

const countLineSchema = z.object({
  productId: z.string().min(1),
  systemQty: z.number(),
  physicalQty: z.number().min(0),
  notes: z.string().optional(),
});

const submitCountSessionSchema = z.object({
  warehouseId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(countLineSchema).min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;

  const parsed = submitCountSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.stockCountSession.count();
    const sessionNo = `COUNT-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    let varianceCount = 0;
    const itemsData = parsed.data.items.map((i) => {
      const variance = i.physicalQty - i.systemQty;
      if (variance !== 0) varianceCount++;
      return {
        productId: i.productId,
        systemQty: i.systemQty,
        physicalQty: i.physicalQty,
        varianceQty: variance,
        notes: i.notes,
      };
    });

    const countSession = await db.$transaction(async (tx) => {
      const sess = await tx.stockCountSession.create({
        data: {
          sessionNo,
          warehouseId,
          conductedByUserId: session.sub,
          notes: parsed.data.notes,
          totalSkusCounted: parsed.data.items.length,
          totalVarianceCount: varianceCount,
          items: {
            create: itemsData,
          },
        },
        include: { items: true },
      });

      // Automatically create pending StockAdjustmentRequest for every non-zero variance
      for (const item of itemsData) {
        if (item.varianceQty !== 0) {
          await tx.stockAdjustmentRequest.create({
            data: {
              warehouseId,
              productId: item.productId,
              systemQty: item.systemQty,
              physicalQty: item.physicalQty,
              varianceQty: item.varianceQty,
              reason: item.notes || `Variance detected in audit session ${sessionNo}`,
              status: "PENDING",
              requestedByUserId: session.sub,
            },
          });
        }
      }

      return sess;
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: "PHYSICAL_STOCK_COUNT_SUBMITTED",
      entityType: "StockCountSession",
      entityId: countSession.id,
      newValue: { sessionNo: countSession.sessionNo, skusCounted: countSession.totalSkusCounted, varianceCount },
    });

    return NextResponse.json({ success: true, countSession });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit stock count" }, { status: 500 });
  }
}
