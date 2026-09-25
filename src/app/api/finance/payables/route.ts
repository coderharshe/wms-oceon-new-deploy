import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  try {
    const db = getDb();
    const where: any = {
      paymentStatus: { in: ["UNPAID", "PARTIAL"] },
    };
    if (warehouseId) where.warehouseId = warehouseId;

    const bills = await db.purchaseBill.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, phone: true, contactPerson: true } },
        warehouse: { select: { name: true, code: true } },
        purchaseOrder: { select: { poNumber: true, creditDays: true } },
      },
      orderBy: { billDate: "asc" },
    });

    const now = new Date().getTime();
    let totalPayables = 0;
    const ageing = {
      currentDue: 0,
      overdue0_15: 0,
      overdue16_30: 0,
      overdue30Plus: 0,
    };

    const payablesList = bills.map((b) => {
      const amount = Number(b.total);
      totalPayables += amount;

      const creditDays = b.purchaseOrder?.creditDays || 0;
      const billTime = new Date(b.billDate).getTime();
      const dueTime = b.dueDate ? new Date(b.dueDate).getTime() : billTime + creditDays * 24 * 60 * 60 * 1000;
      const overdueDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));

      if (overdueDays <= 0) ageing.currentDue += amount;
      else if (overdueDays <= 15) ageing.overdue0_15 += amount;
      else if (overdueDays <= 30) ageing.overdue16_30 += amount;
      else ageing.overdue30Plus += amount;

      return {
        id: b.id,
        grnNumber: b.grnNumber,
        supplierBillNo: b.supplierBillNo,
        supplierName: b.supplier.name,
        contactPerson: b.supplier.contactPerson,
        phone: b.supplier.phone,
        billDate: b.billDate,
        dueDate: new Date(dueTime).toISOString().slice(0, 10),
        amount,
        paymentStatus: b.paymentStatus,
        overdueDays: Math.max(0, overdueDays),
        poNumber: b.purchaseOrder?.poNumber,
        warehouse: b.warehouse.name,
      };
    });

    return NextResponse.json({
      totalPayables,
      ageing,
      payablesList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load payables" }, { status: 500 });
  }
}
