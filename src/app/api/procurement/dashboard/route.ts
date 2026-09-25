import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? undefined : session.warehouseId!;

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { purchaseBill } = await import("@/generated/drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = getDrizzleDb();

      const conditions = [];
      if (warehouseId) conditions.push(eq(purchaseBill.warehouseId, warehouseId));

      const bills = await db.select().from(purchaseBill).where(conditions.length ? and(...conditions) : undefined);

      const openPOs = bills.filter((b) => b.paymentStatus === "UNPAID" || b.paymentStatus === "PARTIAL").length;
      const totalPurchase = bills.reduce((sum, b) => sum + Number(b.total || 0), 0);

      return NextResponse.json({
        pendingRequisitions: 0,
        openPOs,
        pendingDeliveries: 0,
        overduePOs: 0,
        todayPurchaseValue: totalPurchase,
      });
    }

    const db = (await import("@/lib/db")).getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const bills = await db.purchaseBill.findMany({ where });
    const openPOs = bills.filter((b) => b.paymentStatus === "UNPAID" || b.paymentStatus === "PARTIAL").length;
    const totalPurchase = bills.reduce((sum, b) => sum + Number(b.total || 0), 0);

    return NextResponse.json({
      pendingRequisitions: 0,
      openPOs,
      pendingDeliveries: 0,
      overduePOs: 0,
      todayPurchaseValue: totalPurchase,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load procurement metrics" }, { status: 500 });
  }
}
