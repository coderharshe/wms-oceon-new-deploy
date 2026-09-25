import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const QC_STATUSES = ["READY_FOR_QC", "QC_IN_PROGRESS", "COMPLETED"] as const;

// Feeds the QC queue's sections: Waiting / In Progress / Completed. QC's job
// ends the moment they submit — orders needing a refund/extra payment or
// waiting for physical handover are Finance's/warehouse's concern, not QC's.
export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "QC"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order: orderT, customer: customerT, bill: billT, payment: paymentT, qcSession: qcSessionT, user: userT } = await import("@/generated/drizzle/schema");
    const { eq, inArray, and, asc, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const where = warehouseId ? and(eq(orderT.warehouseId, warehouseId), inArray(orderT.status, QC_STATUSES as any)) : inArray(orderT.status, QC_STATUSES as any);
    const orders = await db.select().from(orderT).where(where).orderBy(asc(orderT.createdAt)).limit(100);
    if (orders.length === 0) return NextResponse.json([]);

    const orderIds = orders.map((o) => o.id);
    const customerIds = [...new Set(orders.map((o) => o.customerId))];
    const [customers, bills, sessions] = await Promise.all([
      customerIds.length ? db.select().from(customerT).where(inArray(customerT.id, customerIds)) : Promise.resolve([]),
      db.select().from(billT).where(inArray(billT.orderId, orderIds)),
      db.select().from(qcSessionT).where(inArray(qcSessionT.orderId, orderIds)).orderBy(desc(qcSessionT.startedAt)),
    ]);
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const billIds = bills.map((b) => b.id);
    const payments = billIds.length ? await db.select().from(paymentT).where(inArray(paymentT.billId, billIds)) : [];
    const paymentByBill = new Map(payments.map((p) => [p.billId, p]));
    const billByOrder = new Map(bills.map((b) => [b.orderId, { ...b, payment: paymentByBill.get(b.id) ?? null }]));
    const latestSessionByOrder = new Map<string, (typeof sessions)[number]>();
    for (const s of sessions) if (!latestSessionByOrder.has(s.orderId)) latestSessionByOrder.set(s.orderId, s);
    // Only fetch names for the sessions actually shown — one per order at most.
    const holderIds = [...new Set([...latestSessionByOrder.values()].map((s) => s.qcUserId))];
    const holders = holderIds.length ? await db.select({ id: userT.id, name: userT.name }).from(userT).where(inArray(userT.id, holderIds)) : [];
    const holderNameById = new Map(holders.map((h) => [h.id, h.name]));

    const result = orders.map((o) => {
      const s = latestSessionByOrder.get(o.id);
      return {
        ...o,
        customer: customerMap.get(o.customerId) ?? null,
        bill: billByOrder.get(o.id) ?? null,
        // isYou is computed server-side against the requester's own id, so
        // the client never needs to know its own user id just to render
        // "In progress by You" instead of its own name.
        qcSessions: s ? [{ ...s, qcUser: { name: holderNameById.get(s.qcUserId) ?? null, isYou: s.qcUserId === session.sub } }] : [],
      };
    });
    return NextResponse.json(result);
  }

  const db = (await import("@/lib/db")).getDb();
  const orders = await db.order.findMany({
    where: { warehouseId, status: { in: QC_STATUSES as any } },
    include: {
      customer: true,
      bill: { include: { payment: true } },
      qcSessions: { orderBy: { startedAt: "desc" }, take: 1, include: { qcUser: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const result = orders.map((o) => ({
    ...o,
    qcSessions: o.qcSessions.map((s) => ({ ...s, qcUser: { ...s.qcUser, isYou: s.qcUserId === session.sub } })),
  }));
  return NextResponse.json(result);
}
