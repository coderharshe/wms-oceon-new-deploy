import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "QC"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const {
      qcSession: qcSessionT,
      order: orderT,
      customer: customerT,
      warehouse: warehouseT,
      bill: billT,
      payment: paymentT,
      billVersion: billVersionT,
      billItem: billItemT,
      product: productT,
      unit: unitT,
      qcAdjustment: qcAdjustmentT,
      productUnit: productUnitT,
    } = await import("@/generated/drizzle/schema");
    const { eq, inArray, asc } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const [qcSession] = await db.select().from(qcSessionT).where(eq(qcSessionT.id, id));
    if (!qcSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [order] = await db.select().from(orderT).where(eq(orderT.id, qcSession.orderId));
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, order.warehouseId);
    if (forbidden) return forbidden;

    const [customer] = await db.select().from(customerT).where(eq(customerT.id, order.customerId));
    const [warehouse] = await db.select().from(warehouseT).where(eq(warehouseT.id, order.warehouseId));
    const [bill] = await db.select().from(billT).where(eq(billT.orderId, order.id));

    let billOut: any = null;
    if (bill) {
      const [payment] = await db.select().from(paymentT).where(eq(paymentT.billId, bill.id));
      const versions = await db.select().from(billVersionT).where(eq(billVersionT.billId, bill.id)).orderBy(asc(billVersionT.versionNumber));
      const versionIds = versions.map((v) => v.id);
      const items = versionIds.length ? await db.select().from(billItemT).where(inArray(billItemT.billVersionId, versionIds)) : [];
      const itemProductIds = [...new Set(items.map((i) => i.productId))];
      const products = itemProductIds.length ? await db.select().from(productT).where(inArray(productT.id, itemProductIds)) : [];
      const productMap = new Map(products.map((p) => [p.id, p]));
      const unitIds = [...new Set(items.map((i) => i.unitId))];
      const units = unitIds.length ? await db.select().from(unitT).where(inArray(unitT.id, unitIds)) : [];
      const unitMap = new Map(units.map((u) => [u.id, u]));
      // `finalQty` on the QC screen is entered in the billItem's own sale
      // unit (e.g. boxes), but `availability` below is base-unit stock — the
      // client needs each product's saleUnits (factorToBase) to compare like
      // with like, same shape as Finance's New Order screen.
      const productUnitRows = itemProductIds.length
        ? await db.select().from(productUnitT).where(inArray(productUnitT.productId, itemProductIds))
        : [];
      const saleUnitsByProduct = new Map<string, any[]>();
      for (const pu of productUnitRows) saleUnitsByProduct.set(pu.productId, [...(saleUnitsByProduct.get(pu.productId) ?? []), pu]);
      const itemsByVersion = new Map<string, any[]>();
      for (const it of items) {
        const product = productMap.get(it.productId);
        itemsByVersion.set(it.billVersionId, [
          ...(itemsByVersion.get(it.billVersionId) ?? []),
          { ...it, product: product ? { ...product, saleUnits: saleUnitsByProduct.get(product.id) ?? [] } : null, unit: unitMap.get(it.unitId) ?? null },
        ]);
      }
      billOut = {
        ...bill,
        payment: payment ?? null,
        versions: versions.map((v) => ({ ...v, items: itemsByVersion.get(v.id) ?? [] })),
      };
    }

    const adjustments = await db.select().from(qcAdjustmentT).where(eq(qcAdjustmentT.qcSessionId, id));

    return NextResponse.json({
      ...qcSession,
      order: { ...order, customer: customer ?? null, warehouse: warehouse ?? null, bill: billOut },
      adjustments,
    });
  }

  const db = (await import("@/lib/db")).getDb();
  const qcSession = await db.qcSession.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          customer: true,
          warehouse: true,
          bill: {
            include: {
              payment: true,
              versions: {
                include: { items: { include: { product: { include: { saleUnits: true } }, unit: true } } },
                orderBy: { versionNumber: "asc" },
              },
            },
          },
        },
      },
      adjustments: true,
    },
  });
  if (!qcSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, qcSession.order.warehouseId);
  if (forbidden) return forbidden;

  return NextResponse.json(qcSession);
}
