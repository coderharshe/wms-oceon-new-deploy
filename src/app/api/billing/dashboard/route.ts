import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "BILLING", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? undefined : session.warehouseId!;

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, bill, billVersion, billItem } = await import("@/generated/drizzle/schema");
      const { eq, and, sql, gte } = await import("drizzle-orm");
      const db = getDrizzleDb();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const conditions = [gte(order.createdAt, todayIso)];
      if (warehouseId) conditions.push(eq(order.warehouseId, warehouseId));

      const orders = await db
        .select({
          id: order.id,
          status: order.status,
          total: billVersion.total,
        })
        .from(order)
        .leftJoin(bill, eq(bill.orderId, order.id))
        .leftJoin(billVersion, and(eq(billVersion.billId, bill.id), eq(billVersion.versionNumber, bill.currentVersion)))
        .where(and(...conditions));

      const todayOrders = orders.length;
      const todayBills = orders.filter((o) => o.status !== "DRAFT" && o.status !== "CANCELLED").length;
      const cancelledOrders = orders.filter((o) => o.status === "CANCELLED").length;
      const todaySales = orders
        .filter((o) => o.status !== "CANCELLED" && o.total)
        .reduce((sum, o) => sum + Number(o.total || 0), 0);

      const avgOrderValue = todayBills > 0 ? todaySales / todayBills : 0;

      return NextResponse.json({
        todayOrders,
        todayBills,
        todaySales,
        avgOrderValue,
        itemsSold: todayBills * 3, // placeholder aggregate
        cancelledOrders,
        creditSales: 0,
      });
    }

    const db = (await import("@/lib/db")).getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: any = { createdAt: { gte: today } };
    if (warehouseId) where.warehouseId = warehouseId;

    const orders = await db.order.findMany({
      where,
      include: {
        bill: {
          include: {
            versions: true,
          },
        },
      },
    });

    const todayOrders = orders.length;
    const billedOrders = orders.filter((o) => o.status !== "DRAFT" && o.status !== "CANCELLED");
    const todayBills = billedOrders.length;
    const cancelledOrders = orders.filter((o) => o.status === "CANCELLED").length;

    let todaySales = 0;
    for (const o of billedOrders) {
      if (o.bill) {
        const v = o.bill.versions.find((ver) => ver.versionNumber === o.bill!.currentVersion);
        if (v) todaySales += Number(v.total);
      }
    }

    const avgOrderValue = todayBills > 0 ? todaySales / todayBills : 0;

    return NextResponse.json({
      todayOrders,
      todayBills,
      todaySales,
      avgOrderValue,
      itemsSold: todayBills,
      cancelledOrders,
      creditSales: 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load billing metrics" }, { status: 500 });
  }
}
