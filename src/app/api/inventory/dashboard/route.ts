import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? undefined : session.warehouseId!;

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { inventory, product } = await import("@/generated/drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = getDrizzleDb();

      const conditions = [];
      if (warehouseId) conditions.push(eq(inventory.warehouseId, warehouseId));

      const rows = await db
        .select({
          qty: inventory.quantityOnHand,
          price: product.wholesalePrice,
          minStock: product.minStock,
        })
        .from(inventory)
        .leftJoin(product, eq(inventory.productId, product.id))
        .where(conditions.length ? and(...conditions) : undefined);

      const totalSkus = rows.length;
      let totalQuantity = 0;
      let totalValuation = 0;
      let lowStockCount = 0;
      let oosCount = 0;

      for (const r of rows) {
        const q = Number(r.qty || 0);
        const p = Number(r.price || 0);
        const min = Number(r.minStock || 0);
        totalQuantity += q;
        totalValuation += q * p;
        if (q <= 0) oosCount++;
        else if (min > 0 && q < min) lowStockCount++;
      }

      return NextResponse.json({
        totalSkus,
        totalQuantity,
        totalValuation,
        lowStockCount,
        oosCount,
        nearExpiryCount: 0,
        todayInward: 0,
        todayOutward: 0,
      });
    }

    const db = (await import("@/lib/db")).getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const rows = await db.inventory.findMany({
      where,
      include: {
        product: true,
      },
    });

    const totalSkus = rows.length;
    let totalQuantity = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let oosCount = 0;

    for (const r of rows) {
      const q = Number(r.quantityOnHand || 0);
      const p = Number(r.product?.wholesalePrice || 0);
      const min = Number(r.product?.minStock || 0);
      totalQuantity += q;
      totalValuation += q * p;
      if (q <= 0) oosCount++;
      else if (min > 0 && q < min) lowStockCount++;
    }

    return NextResponse.json({
      totalSkus,
      totalQuantity,
      totalValuation,
      lowStockCount,
      oosCount,
      nearExpiryCount: 0,
      todayInward: 0,
      todayOutward: 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load inventory metrics" }, { status: 500 });
  }
}
