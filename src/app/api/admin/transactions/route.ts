import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// Admin-only ledger of every cash/UPI transaction (payments and refunds),
// with both the server-recorded time and the client-reported "clicked at"
// time — the latter is what staff can cross-reference against store CCTV
// footage in a dispute. Not a report/aggregate view (that's
// /api/admin/reports?type=payments) — this is the raw per-transaction log.
export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const since = req.nextUrl.searchParams.get("since") ? new Date(req.nextUrl.searchParams.get("since")!) : null;
  const until = req.nextUrl.searchParams.get("until") ? new Date(req.nextUrl.searchParams.get("until")!) : null;
  const method = req.nextUrl.searchParams.get("method") || undefined;
  const type = req.nextUrl.searchParams.get("type") || undefined;
  const warehouseId = req.nextUrl.searchParams.get("warehouseId") || undefined;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { paymentTransaction, payment, bill, order, customer, user } = await import("@/generated/drizzle/schema");
    const { eq, and, gte, lte, inArray, desc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    let billIdsInScope: string[] | null = null;
    if (warehouseId) {
      const bills = await db.select({ id: bill.id }).from(bill).where(eq(bill.warehouseId, warehouseId));
      billIdsInScope = bills.map((b) => b.id);
    }
    let paymentIdsInScope: string[] | null = null;
    if (billIdsInScope) {
      const payments = billIdsInScope.length ? await db.select({ id: payment.id }).from(payment).where(inArray(payment.billId, billIdsInScope)) : [];
      paymentIdsInScope = payments.map((p) => p.id);
    }

    const conditions = [];
    if (since) conditions.push(gte(paymentTransaction.timestamp, since.toISOString()));
    if (until) conditions.push(lte(paymentTransaction.timestamp, until.toISOString()));
    if (method) conditions.push(eq(paymentTransaction.method, method as any));
    if (type) conditions.push(eq(paymentTransaction.type, type as any));
    if (paymentIdsInScope) conditions.push(inArray(paymentTransaction.paymentId, paymentIdsInScope));
    const where = conditions.length ? and(...conditions) : undefined;

    const txs = await db.select().from(paymentTransaction).where(where).orderBy(desc(paymentTransaction.timestamp)).limit(300);
    if (txs.length === 0) return NextResponse.json([]);

    const paymentIds = [...new Set(txs.map((t) => t.paymentId))];
    const payments = await db.select().from(payment).where(inArray(payment.id, paymentIds));
    const billIds = [...new Set(payments.map((p) => p.billId))];
    const bills = billIds.length ? await db.select().from(bill).where(inArray(bill.id, billIds)) : [];
    const orderIds = [...new Set(bills.map((b) => b.orderId))];
    const orders = orderIds.length ? await db.select().from(order).where(inArray(order.id, orderIds)) : [];
    const customerIds = [...new Set(orders.map((o) => o.customerId))];
    const customers = customerIds.length ? await db.select().from(customer).where(inArray(customer.id, customerIds)) : [];
    const userIds = [...new Set(txs.map((t) => t.recordedByUserId))];
    const users = userIds.length ? await db.select({ id: user.id, name: user.name, staffId: user.staffId }).from(user).where(inArray(user.id, userIds)) : [];

    const paymentMap = new Map(payments.map((p) => [p.id, p]));
    const billMap = new Map(bills.map((b) => [b.id, b]));
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json(
      txs.map((t) => {
        const pay = paymentMap.get(t.paymentId);
        const b = pay ? billMap.get(pay.billId) : undefined;
        const o = b ? orderMap.get(b.orderId) : undefined;
        const c = o ? customerMap.get(o.customerId) : undefined;
        return {
          id: t.id,
          type: t.type,
          method: t.method,
          amount: t.amount,
          amountReceived: t.amountReceived,
          changeGiven: t.changeGiven,
          upiReference: t.upiReference,
          status: t.status,
          timestamp: t.timestamp,
          clickedAt: t.clickedAt,
          recordedBy: userMap.get(t.recordedByUserId) ?? null,
          billNumber: b?.billNumber ?? null,
          orderNumber: o?.orderNumber ?? null,
          customerName: c?.shopName ?? null,
        };
      })
    );
  }

  const db = (await import("@/lib/db")).getDb();
  const txs = await db.paymentTransaction.findMany({
    where: {
      timestamp: { gte: since ?? undefined, lte: until ?? undefined },
      method: method as any,
      type: type as any,
      payment: warehouseId ? { bill: { warehouseId } } : undefined,
    },
    include: {
      recordedByUser: { select: { name: true, staffId: true } },
      payment: { include: { bill: { include: { order: { include: { customer: true } } } } } },
    },
    orderBy: { timestamp: "desc" },
    take: 300,
  });

  return NextResponse.json(
    txs.map((t) => ({
      id: t.id,
      type: t.type,
      method: t.method,
      amount: t.amount,
      amountReceived: t.amountReceived,
      changeGiven: t.changeGiven,
      upiReference: t.upiReference,
      status: t.status,
      timestamp: t.timestamp,
      clickedAt: t.clickedAt,
      recordedBy: t.recordedByUser,
      billNumber: t.payment.bill.billNumber,
      orderNumber: t.payment.bill.order.orderNumber,
      customerName: t.payment.bill.order.customer.shopName,
    }))
  );
}
