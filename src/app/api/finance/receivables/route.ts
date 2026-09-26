import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    // Fetch unpaid or partially paid orders
    const unpaidOrders = await db.order.findMany({
      where: {
        ...where,
        status: { in: ["BILLED", "PAYMENT_PENDING", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER", "COMPLETED"] },
        bill: {
          paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PENDING", "PAYMENT_ADJUSTMENT_REQUIRED"] },
        },
      },
      include: {
        customer: true,
        warehouse: { select: { name: true, code: true } },
        bill: {
          include: {
            payment: {
              include: {
                transactions: true,
              },
            },
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date().getTime();
    let totalReceivables = 0;
    const ageing = {
      bucket0_7: 0,
      bucket8_15: 0,
      bucket16_30: 0,
      bucket31_60: 0,
      bucket60Plus: 0,
    };

    const receivablesList = unpaidOrders.map((ord) => {
      const billVersion = ord.bill?.versions[0];
      const billTotal = billVersion ? Number(billVersion.total) : 0;
      const amountPaid = ord.bill?.payment ? Number(ord.bill.payment.amountPaid) : 0;
      const balanceDue = billTotal - amountPaid;

      totalReceivables += balanceDue;

      const billAgeDays = Math.floor((now - new Date(ord.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      if (billAgeDays <= 7) ageing.bucket0_7 += balanceDue;
      else if (billAgeDays <= 15) ageing.bucket8_15 += balanceDue;
      else if (billAgeDays <= 30) ageing.bucket16_30 += balanceDue;
      else if (billAgeDays <= 60) ageing.bucket31_60 += balanceDue;
      else ageing.bucket60Plus += balanceDue;

      return {
        id: ord.id,
        orderNumber: ord.orderNumber,
        billNumber: ord.bill?.billNumber,
        customerName: ord.customer.shopName,
        ownerName: ord.customer.ownerName,
        mobile: ord.customer.mobile,
        creditLimit: ord.customer.creditLimit ? Number(ord.customer.creditLimit) : null,
        billTotal,
        amountPaid,
        balanceDue,
        ageDays: billAgeDays,
        createdAt: ord.createdAt,
        warehouse: ord.warehouse.name,
      };
    });

    return NextResponse.json({
      totalReceivables,
      ageing,
      receivablesList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load receivables" }, { status: 500 });
  }
}
