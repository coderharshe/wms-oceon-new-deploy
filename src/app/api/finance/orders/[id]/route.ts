import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { drizzleQ, prismaQ } from "@/lib/cash";
import { unpaidMarks } from "@/lib/mark-unpaid";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING", "QC"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const {
      order: orderT,
      customer: customerT,
      user: userT,
      orderItem: orderItemT,
      product: productT,
      productUnit: productUnitT,
      unit: unitT,
      bill: billT,
      payment: paymentT,
      paymentTransaction: paymentTransactionT,
      billVersion: billVersionT,
      billItem: billItemT,
      paymentAdjustment: paymentAdjustmentT,
      qcSession: qcSessionT,
      qcAdjustment: qcAdjustmentT,
    } = await import("@/generated/drizzle/schema");
    const { eq, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    // `id` may also be the clientRequestId of a bill made offline: the PC
    // only knows its own id until the sync answer comes back. The real id
    // always wins; the fallback only runs when no order has that id.
    let [order] = await db.select().from(orderT).where(eq(orderT.id, id));
    if (!order) [order] = await db.select().from(orderT).where(eq(orderT.clientRequestId, id));
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, order.warehouseId);
    if (forbidden) return forbidden;

    const [customer, financeUser, items, bill, qcSessions] = await Promise.all([
      db.select().from(customerT).where(eq(customerT.id, order.customerId)).then((r) => r[0] ?? null),
      db.select({ name: userT.name, staffId: userT.staffId }).from(userT).where(eq(userT.id, order.financeUserId)).then((r) => r[0] ?? null),
      db.select().from(orderItemT).where(eq(orderItemT.orderId, order.id)),
      db.select().from(billT).where(eq(billT.orderId, order.id)).then((r) => r[0] ?? null),
      db.select().from(qcSessionT).where(eq(qcSessionT.orderId, order.id)),
    ]);

    // Sale units ride along with every product on the bill: the modify-bill
    // editor lets a line be re-billed in another unit (peti -> loose), and
    // without the unit list there is nothing to offer. Same shape the product
    // search returns, so one accessor reads both.
    const saleUnitsFor = async (productIds: string[]) => {
      if (!productIds.length) return new Map<string, any[]>();
      const rows = await db.select().from(productUnitT).where(inArray(productUnitT.productId, productIds));
      const unitIds = [...new Set(rows.map((r) => r.unitId))];
      const units = unitIds.length ? await db.select().from(unitT).where(inArray(unitT.id, unitIds)) : [];
      const unitMap = new Map(units.map((u) => [u.id, u]));
      const byProduct = new Map<string, any[]>();
      for (const r of rows) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), { ...r, unit: unitMap.get(r.unitId) ?? null }]);
      return byProduct;
    };

    const itemProductIds = [...new Set(items.map((i) => i.productId))];
    const itemProducts = itemProductIds.length ? await db.select().from(productT).where(inArray(productT.id, itemProductIds)) : [];
    const itemSaleUnits = await saleUnitsFor(itemProductIds);
    const itemProductMap = new Map(itemProducts.map((p) => [p.id, { ...p, saleUnits: itemSaleUnits.get(p.id) ?? [] }]));
    const itemsOut = items.map((i) => ({ ...i, product: itemProductMap.get(i.productId) ?? null }));

    let billOut: any = null;
    if (bill) {
      const [payment, versions, adjustments] = await Promise.all([
        db.select().from(paymentT).where(eq(paymentT.billId, bill.id)).then((r) => r[0] ?? null),
        db.select().from(billVersionT).where(eq(billVersionT.billId, bill.id)).orderBy(asc(billVersionT.versionNumber)),
        db.select().from(paymentAdjustmentT).where(eq(paymentAdjustmentT.billId, bill.id)),
      ]);
      let paymentOut: any = null;
      if (payment) {
        const transactions = await db.select().from(paymentTransactionT).where(eq(paymentTransactionT.paymentId, payment.id));
        paymentOut = { ...payment, transactions };
      }
      const versionIds = versions.map((v) => v.id);
      const versionItems = versionIds.length ? await db.select().from(billItemT).where(inArray(billItemT.billVersionId, versionIds)) : [];
      const versionProductIds = [...new Set(versionItems.map((i) => i.productId))];
      const versionProducts = versionProductIds.length ? await db.select().from(productT).where(inArray(productT.id, versionProductIds)) : [];
      const versionSaleUnits = await saleUnitsFor(versionProductIds);
      const versionProductMap = new Map(versionProducts.map((p) => [p.id, { ...p, saleUnits: versionSaleUnits.get(p.id) ?? [] }]));
      const itemsByVersion = new Map<string, any[]>();
      for (const it of versionItems) itemsByVersion.set(it.billVersionId, [...(itemsByVersion.get(it.billVersionId) ?? []), { ...it, product: versionProductMap.get(it.productId) ?? null }]);

      // Who revised a bill is the point of the manager view, so the author
      // rides along with each version rather than needing a second request.
      const authorIds = [...new Set(versions.map((v) => v.createdByUserId))];
      const authors = authorIds.length ? await db.select().from(userT).where(inArray(userT.id, authorIds)) : [];
      const authorMap = new Map(authors.map((u) => [u.id, { name: u.name, role: u.role }]));
      billOut = {
        ...bill,
        payment: paymentOut,
        versions: versions.map((v) => ({ ...v, items: itemsByVersion.get(v.id) ?? [], createdByUser: authorMap.get(v.createdByUserId) ?? null })),
        adjustments,
        unpaidMarks: await unpaidMarks(drizzleQ(db as never), bill.id),
      };
    }

    const sessionIds = qcSessions.map((s) => s.id);
    const qcUserIds = [...new Set(qcSessions.map((s) => s.qcUserId))];
    const [qcAdjustments, qcUsers] = await Promise.all([
      sessionIds.length ? db.select().from(qcAdjustmentT).where(inArray(qcAdjustmentT.qcSessionId, sessionIds)) : Promise.resolve([]),
      qcUserIds.length ? db.select({ id: userT.id, name: userT.name }).from(userT).where(inArray(userT.id, qcUserIds)) : Promise.resolve([]),
    ]);
    const qcUserMap = new Map(qcUsers.map((u) => [u.id, u]));
    const adjustmentsBySession = new Map<string, any[]>();
    for (const a of qcAdjustments) adjustmentsBySession.set(a.qcSessionId, [...(adjustmentsBySession.get(a.qcSessionId) ?? []), a]);
    const qcSessionsOut = qcSessions.map((s) => ({ ...s, adjustments: adjustmentsBySession.get(s.id) ?? [], qcUser: qcUserMap.get(s.qcUserId) ? { name: qcUserMap.get(s.qcUserId)!.name } : null }));

    return NextResponse.json({ ...order, customer, financeUser, items: itemsOut, bill: billOut, qcSessions: qcSessionsOut });
  }

  const db = (await import("@/lib/db")).getDb();
  // Real id first, clientRequestId only as the fallback — see the Workers path.
  const load = (where: { id: string } | { clientRequestId: string }) => db.order.findUnique({
    where,
    include: {
      customer: true,
      financeUser: { select: { name: true, staffId: true } },
      items: { include: { product: { include: { saleUnits: { include: { unit: true } } } } } },
      bill: {
        include: {
          payment: { include: { transactions: true } },
          versions: {
            include: { items: { include: { product: { include: { saleUnits: { include: { unit: true } } } } } }, createdByUser: { select: { name: true, role: true } } },
            orderBy: { versionNumber: "asc" },
          },
          adjustments: true,
        },
      },
      qcSessions: { include: { adjustments: true, qcUser: { select: { name: true } } } },
    },
  });
  const order = (await load({ id })) ?? (await load({ clientRequestId: id }));
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, order.warehouseId);
  if (forbidden) return forbidden;

  if (!order.bill) return NextResponse.json(order);
  return NextResponse.json({ ...order, bill: { ...order.bill, unpaidMarks: await unpaidMarks(prismaQ(db), order.bill.id) } });
}
