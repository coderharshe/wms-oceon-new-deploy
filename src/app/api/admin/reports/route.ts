import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { stockLevel } from "@/lib/stock";
import { isWorkersRuntime } from "@/lib/cf-env";

const DAY = 24 * 60 * 60 * 1000;
// A year of bills is already more than any screen renders; anything longer is
// a typo or a scrape, and it is the query that pays for it.
const MAX_SPAN_MS = 366 * DAY;
// Hard ceiling on rows pulled for the sales report, so it degrades into a
// truncated answer instead of a timeout as data accumulates.
const SALES_TAKE = 2000;

// z.coerce.date() rejects an unparseable string instead of silently producing
// an Invalid Date that reaches Prisma and 500s.
const rangeSchema = z.object({ since: z.coerce.date().optional(), until: z.coerce.date().optional() });

// PRD §32 reports, one endpoint switched by `type` rather than five near-
// identical route files.
export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const type = req.nextUrl.searchParams.get("type") ?? "sales";
  const range = rangeSchema.safeParse({
    since: req.nextUrl.searchParams.get("since") ?? undefined,
    until: req.nextUrl.searchParams.get("until") ?? undefined,
  });
  if (!range.success) return NextResponse.json({ error: "since/until must be valid dates" }, { status: 400 });
  const until = range.data.until ?? new Date();
  let since = range.data.since ?? new Date(until.getTime() - 30 * DAY);
  if (since > until) return NextResponse.json({ error: "since must not be after until" }, { status: 400 });
  if (until.getTime() - since.getTime() > MAX_SPAN_MS) since = new Date(until.getTime() - MAX_SPAN_MS);
  const warehouseId = session.role === "MANAGER" ? session.warehouseId! : req.nextUrl.searchParams.get("warehouseId") ?? undefined;

  if (isWorkersRuntime()) return reportsDrizzle(type, since, until, warehouseId);

  const db = (await import("@/lib/db")).getDb();

  if (type === "sales") {
    const rows = await db.bill.findMany({
      // A cancelled order keeps its Bill and its version total; counting it
      // would book revenue for goods that were never sold.
      where: { createdAt: { gte: since, lte: until }, warehouseId, order: { status: { not: "CANCELLED" } } },
      include: {
        order: { include: { customer: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { items: { include: { product: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: SALES_TAKE + 1, // +1 tells us the window overflowed without a second query
    });
    const truncated = rows.length > SALES_TAKE;
    const bills = truncated ? rows.slice(0, SALES_TAKE) : rows;
    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    const byCustomer = new Map<string, { name: string; revenue: number }>();
    let wholesaleTotal = 0;
    let retailTotal = 0;
    for (const b of bills) {
      const total = Number(b.versions[0]?.total ?? 0);
      if (b.order.sellingMode === "WHOLESALE") wholesaleTotal += total;
      else retailTotal += total;
      const cust = byCustomer.get(b.order.customerId) ?? { name: b.order.customer.shopName, revenue: 0 };
      cust.revenue += total;
      byCustomer.set(b.order.customerId, cust);
      for (const item of b.versions[0]?.items ?? []) {
        const p = byProduct.get(item.productId) ?? { name: item.product.name, qty: 0, revenue: 0 };
        p.qty += Number(item.quantity);
        p.revenue += Number(item.lineTotal);
        byProduct.set(item.productId, p);
      }
    }
    return NextResponse.json({
      type,
      since,
      until,
      totalRevenue: wholesaleTotal + retailTotal,
      wholesaleTotal,
      retailTotal,
      billCount: bills.length,
      truncated,
      byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    });
  }

  if (type === "payments") {
    const txs = await db.paymentTransaction.findMany({
      where: {
        timestamp: { gte: since, lte: until },
        ...(warehouseId ? { payment: { bill: { warehouseId } } } : {}),
      },
      include: {
        payment: {
          include: {
            bill: {
              include: {
                order: {
                  include: { customer: { select: { shopName: true } } },
                },
              },
            },
          },
        },
        recordedByUser: { select: { name: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    });
    const sum = (pred: (t: (typeof txs)[number]) => boolean) => txs.filter(pred).reduce((s, t) => s + Number(t.amount), 0);
    const cashCollected = sum((t) => t.method === "CASH" && t.type === "PAYMENT" && t.status === "CONFIRMED");
    const upiCollected = sum((t) => t.method === "UPI" && t.type === "PAYMENT" && t.status === "CONFIRMED");
    const pending = sum((t) => t.status === "PENDING");
    const refunds = sum((t) => t.type === "REFUND" && t.status === "CONFIRMED");
    return NextResponse.json({
      type,
      since,
      until,
      cashCollected,
      upiCollected,
      totalCollected: cashCollected + upiCollected,
      pending,
      refunds,
      transactions: txs.slice(0, 50).map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        method: t.method,
        type: t.type,
        status: t.status,
        timestamp: t.timestamp,
        billNumber: t.payment?.bill?.billNumber ?? "—",
        customerName: t.payment?.bill?.order?.customer?.shopName ?? "Walk-in",
        recordedBy: t.recordedByUser?.name ?? "—",
        upiReference: t.upiReference ?? null,
      })),
    });
  }

  if (type === "inventory") {
    const inventory = await db.inventory.findMany({
      where: warehouseId ? { warehouseId } : {},
      include: { product: true, warehouse: { select: { name: true } } },
      orderBy: { product: { name: "asc" } },
    });
    return NextResponse.json({
      type,
      items: inventory.map((i) => ({
        productId: i.productId,
        sku: i.product.sku,
        product: i.product.name,
        warehouse: i.warehouse.name,
        onHand: i.quantityOnHand.toString(),
        reserved: i.quantityReserved.toString(),
        available: i.quantityOnHand.sub(i.quantityReserved).toString(),
        valuation: (Number(i.quantityOnHand) * Number(i.product.avgCost ?? i.product.wholesalePrice)).toFixed(2),
        costBasis: i.product.avgCost != null ? "AVG_COST" : "WHOLESALE_PRICE",
        minStock: i.product.minStock?.toString() ?? null,
        lowStock: i.product.minStock != null && i.quantityOnHand.lte(i.product.minStock),
        level: stockLevel(Number(i.quantityOnHand), i.product.minStock == null ? null : Number(i.product.minStock)),
      })),
    });
  }

  if (type === "qc") {
    const adjustments = await db.qcAdjustment.findMany({
      where: {
        createdAt: { gte: since, lte: until },
        ...(warehouseId ? { qcSession: { order: { warehouseId } } } : {}),
      },
      include: { product: true, qcSession: { include: { qcUser: { select: { name: true } }, order: { select: { orderNumber: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const total = adjustments.length;
    const byAction: Record<string, number> = {};
    for (const a of adjustments) byAction[a.action] = (byAction[a.action] ?? 0) + 1;
    return NextResponse.json({
      type,
      since,
      until,
      total,
      byAction,
      recent: adjustments.slice(0, 50).map((a) => ({
        order: a.qcSession.order.orderNumber,
        qcUser: a.qcSession.qcUser.name,
        product: a.product.name,
        originalQty: a.originalQty.toString(),
        finalQty: a.finalQty.toString(),
        action: a.action,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
    });
  }

  if (type === "cash") {
    const sessions = await db.cashSession.findMany({
      where: {
        businessDate: { gte: since, lte: until },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { financeUser: { select: { name: true } }, warehouse: { select: { name: true } } },
      orderBy: { businessDate: "desc" },
      take: 200,
    });
    return NextResponse.json({
      type,
      since,
      until,
      sessions: sessions.map((s) => ({
        id: s.id,
        businessDate: s.businessDate,
        warehouse: s.warehouse.name,
        financeUser: s.financeUser.name,
        openingCash: s.openingCash.toString(),
        expectedCash: s.expectedCash?.toString() ?? null,
        actualCash: s.actualCash?.toString() ?? null,
        difference: s.difference?.toString() ?? null,
        status: s.status,
        discrepancyReason: s.discrepancyReason,
        closedAt: s.closedAt,
      })),
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}

async function reportsDrizzle(type: string, since: Date, until: Date, warehouseId: string | undefined) {
  const { getDrizzleDb } = await import("@/lib/drizzle-db");
  const { bill, order, customer, billVersion, billItem, product, paymentTransaction, payment, inventory, warehouse, qcAdjustment, qcSession, user, cashSession } = await import("@/generated/drizzle/schema");
  const { eq, ne, and, gte, lte, inArray, desc } = await import("drizzle-orm");
  const db = getDrizzleDb();
  const sinceStr = since.toISOString();
  const untilStr = until.toISOString();

  if (type === "sales") {
    // Joined to Order purely to drop cancelled orders — their Bill and version
    // total survive cancellation and would otherwise count as revenue.
    const where = and(
      gte(bill.createdAt, sinceStr),
      lte(bill.createdAt, untilStr),
      ne(order.status, "CANCELLED"),
      ...(warehouseId ? [eq(bill.warehouseId, warehouseId)] : [])
    );
    const billRows = await db
      .select({ b: bill })
      .from(bill)
      .innerJoin(order, eq(order.id, bill.orderId))
      .where(where)
      .orderBy(desc(bill.createdAt))
      .limit(SALES_TAKE + 1);
    const truncated = billRows.length > SALES_TAKE;
    const bills = (truncated ? billRows.slice(0, SALES_TAKE) : billRows).map((r) => r.b);
    const orderIds = bills.map((b) => b.orderId);
    const orders = orderIds.length ? await db.select().from(order).where(inArray(order.id, orderIds)) : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const customerIds = [...new Set(orders.map((o) => o.customerId))];
    const customers = customerIds.length ? await db.select().from(customer).where(inArray(customer.id, customerIds)) : [];
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const billIds = bills.map((b) => b.id);
    const versions = billIds.length ? await db.select().from(billVersion).where(inArray(billVersion.billId, billIds)).orderBy(desc(billVersion.versionNumber)) : [];
    const latestVersionByBill = new Map<string, (typeof versions)[number]>();
    for (const v of versions) if (!latestVersionByBill.has(v.billId)) latestVersionByBill.set(v.billId, v);
    const latestVersionIds = [...latestVersionByBill.values()].map((v) => v.id);
    const items = latestVersionIds.length ? await db.select().from(billItem).where(inArray(billItem.billVersionId, latestVersionIds)) : [];
    const itemsByVersion = new Map<string, typeof items>();
    for (const it of items) itemsByVersion.set(it.billVersionId, [...(itemsByVersion.get(it.billVersionId) ?? []), it]);
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = productIds.length ? await db.select().from(product).where(inArray(product.id, productIds)) : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
    const byCustomer = new Map<string, { name: string; revenue: number }>();
    let wholesaleTotal = 0;
    let retailTotal = 0;
    for (const b of bills) {
      const ord = orderMap.get(b.orderId)!;
      const version = latestVersionByBill.get(b.id);
      const total = Number(version?.total ?? 0);
      if (ord.sellingMode === "WHOLESALE") wholesaleTotal += total;
      else retailTotal += total;
      const cust = byCustomer.get(ord.customerId) ?? { name: customerMap.get(ord.customerId)?.shopName ?? "", revenue: 0 };
      cust.revenue += total;
      byCustomer.set(ord.customerId, cust);
      for (const item of version ? itemsByVersion.get(version.id) ?? [] : []) {
        const p = byProduct.get(item.productId) ?? { name: productMap.get(item.productId)?.name ?? "", qty: 0, revenue: 0 };
        p.qty += Number(item.quantity);
        p.revenue += Number(item.lineTotal);
        byProduct.set(item.productId, p);
      }
    }
    return NextResponse.json({
      type,
      since,
      until,
      totalRevenue: wholesaleTotal + retailTotal,
      wholesaleTotal,
      retailTotal,
      billCount: bills.length,
      truncated,
      byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    });
  }

  if (type === "payments") {
    const bills = warehouseId ? await db.select({ id: bill.id }).from(bill).where(eq(bill.warehouseId, warehouseId)) : await db.select({ id: bill.id }).from(bill);
    const billIds = bills.map((b) => b.id);
    const payments = billIds.length ? await db.select({ id: payment.id }).from(payment).where(inArray(payment.billId, billIds)) : [];
    const paymentIds = payments.map((p) => p.id);
    const txs = paymentIds.length ? await db.select().from(paymentTransaction).where(and(gte(paymentTransaction.timestamp, sinceStr), inArray(paymentTransaction.paymentId, paymentIds))) : [];
    const sum = (pred: (t: (typeof txs)[number]) => boolean) => txs.filter(pred).reduce((s, t) => s + Number(t.amount), 0);
    return NextResponse.json({
      type,
      cashCollected: sum((t) => t.method === "CASH" && t.type === "PAYMENT" && t.status === "CONFIRMED"),
      upiCollected: sum((t) => t.method === "UPI" && t.type === "PAYMENT" && t.status === "CONFIRMED"),
      pending: sum((t) => t.status === "PENDING"),
      refunds: sum((t) => t.type === "REFUND" && t.status === "CONFIRMED"),
    });
  }

  if (type === "inventory") {
    const where = warehouseId ? eq(inventory.warehouseId, warehouseId) : undefined;
    const inventoryRows = await db.select().from(inventory).where(where);
    const productIds = [...new Set(inventoryRows.map((i) => i.productId))];
    const warehouseIds = [...new Set(inventoryRows.map((i) => i.warehouseId))];
    const [products, warehouses] = await Promise.all([
      productIds.length ? db.select().from(product).where(inArray(product.id, productIds)) : Promise.resolve([]),
      warehouseIds.length ? db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(inArray(warehouse.id, warehouseIds)) : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    const items = inventoryRows
      .map((i) => {
        const p = productMap.get(i.productId)!;
        return {
          productId: i.productId,
          sku: p?.sku ?? "",
          product: p?.name ?? "",
          warehouse: warehouseMap.get(i.warehouseId)?.name ?? "",
          onHand: i.quantityOnHand.toString(),
          reserved: i.quantityReserved.toString(),
          available: (Number(i.quantityOnHand) - Number(i.quantityReserved)).toString(),
          // See the Prisma branch: cost, not selling price, and say which.
          valuation: (Number(i.quantityOnHand) * Number(p?.avgCost ?? p?.wholesalePrice ?? 0)).toFixed(2),
          costBasis: p?.avgCost != null ? "AVG_COST" : "WHOLESALE_PRICE",
          minStock: p?.minStock?.toString() ?? null,
          lowStock: p?.minStock != null && Number(i.quantityOnHand) <= Number(p.minStock),
          level: stockLevel(Number(i.quantityOnHand), p?.minStock == null ? null : Number(p.minStock)),
          _name: p?.name ?? "",
        };
      })
      .sort((a, b) => a._name.localeCompare(b._name))
      .map(({ _name, ...rest }) => rest);
    return NextResponse.json({ type, items });
  }

  if (type === "qc") {
    let sessionIds: string[] | null = null;
    if (warehouseId) {
      const orders = await db.select({ id: order.id }).from(order).where(eq(order.warehouseId, warehouseId));
      const orderIds = orders.map((o) => o.id);
      const sessions = orderIds.length ? await db.select({ id: qcSession.id }).from(qcSession).where(inArray(qcSession.orderId, orderIds)) : [];
      sessionIds = sessions.map((s) => s.id);
    }
    const where = sessionIds
      ? and(gte(qcAdjustment.createdAt, sinceStr), inArray(qcAdjustment.qcSessionId, sessionIds))
      : gte(qcAdjustment.createdAt, sinceStr);
    const adjustments = await db.select().from(qcAdjustment).where(where).orderBy(desc(qcAdjustment.createdAt)).limit(200);

    const productIds = [...new Set(adjustments.map((a) => a.productId))];
    const adjSessionIds = [...new Set(adjustments.map((a) => a.qcSessionId))];
    const [products, sessions] = await Promise.all([
      productIds.length ? db.select().from(product).where(inArray(product.id, productIds)) : Promise.resolve([]),
      adjSessionIds.length ? db.select().from(qcSession).where(inArray(qcSession.id, adjSessionIds)) : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const orderIds = [...new Set(sessions.map((s) => s.orderId))];
    const qcUserIds = [...new Set(sessions.map((s) => s.qcUserId))];
    const [orders, qcUsers] = await Promise.all([
      orderIds.length ? db.select({ id: order.id, orderNumber: order.orderNumber }).from(order).where(inArray(order.id, orderIds)) : Promise.resolve([]),
      qcUserIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, qcUserIds)) : Promise.resolve([]),
    ]);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const qcUserMap = new Map(qcUsers.map((u) => [u.id, u]));
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    const total = adjustments.length;
    const byAction: Record<string, number> = {};
    for (const a of adjustments) byAction[a.action] = (byAction[a.action] ?? 0) + 1;
    return NextResponse.json({
      type,
      total,
      byAction,
      recent: adjustments.slice(0, 50).map((a) => {
        const s = sessionMap.get(a.qcSessionId);
        return {
          order: s ? orderMap.get(s.orderId)?.orderNumber ?? "" : "",
          qcUser: s ? qcUserMap.get(s.qcUserId)?.name ?? "" : "",
          product: productMap.get(a.productId)?.name ?? "",
          originalQty: a.originalQty.toString(),
          finalQty: a.finalQty.toString(),
          action: a.action,
          reason: a.reason,
          createdAt: a.createdAt,
        };
      }),
    });
  }

  if (type === "cash") {
    const sinceDateStr = sinceStr.slice(0, 10);
    const where = warehouseId ? and(gte(cashSession.businessDate, sinceDateStr), eq(cashSession.warehouseId, warehouseId)) : gte(cashSession.businessDate, sinceDateStr);
    const sessions = await db.select().from(cashSession).where(where).orderBy(desc(cashSession.businessDate)).limit(200);
    const financeUserIds = [...new Set(sessions.map((s) => s.financeUserId))];
    const warehouseIds = [...new Set(sessions.map((s) => s.warehouseId))];
    const [financeUsers, warehouses] = await Promise.all([
      financeUserIds.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, financeUserIds)) : Promise.resolve([]),
      warehouseIds.length ? db.select({ id: warehouse.id, name: warehouse.name }).from(warehouse).where(inArray(warehouse.id, warehouseIds)) : Promise.resolve([]),
    ]);
    const userMap = new Map(financeUsers.map((u) => [u.id, u]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    return NextResponse.json({
      type,
      sessions: sessions.map((s) => ({
        id: s.id,
        businessDate: s.businessDate,
        warehouse: warehouseMap.get(s.warehouseId)?.name ?? "",
        financeUser: userMap.get(s.financeUserId)?.name ?? "",
        openingCash: s.openingCash,
        expectedCash: s.expectedCash,
        actualCash: s.actualCash,
        difference: s.difference,
        status: s.status,
        discrepancyReason: s.discrepancyReason,
        closedAt: s.closedAt,
      })),
    });
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}
