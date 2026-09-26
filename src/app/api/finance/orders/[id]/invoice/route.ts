import { NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { buildInvoiceHtml } from "@/lib/invoice";
import { invoiceStamp } from "@/lib/fmt";
import { putFile } from "@/lib/r2";
import { getSetting } from "@/lib/settings";
import { isWorkersRuntime } from "@/lib/cf-env";

// A revision records the lines it dropped as REMOVED at quantity 0, so the
// bill's history shows what left. Those rows are not part of the goods the
// customer is receiving, and printing them put a ghost line at Rs 0.00 on
// every revised bill. The version's stored totals already exclude them.
const isPrintable = (it: { changeType?: string | null; quantity: unknown }) =>
  it.changeType !== "REMOVED" && Number(it.quantity) > 0;

// Generates (or regenerates) the invoice document for the order's current
// bill version and stores it in R2 — deterministic key from billNumber, so
// no extra DB column is needed to remember where it lives.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  let businessName: string, billNumber: string, orderNumber: string, date: string, time: string, customerName: string, customerMobile: string | null, sellingMode: string, notes: string | null;
  let items: { name: string; quantity: string; unit: string; unitPrice: string; lineTotal: string }[];
  let subtotal: string, discountTotal: string, taxTotal: string, total: string;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, customer, bill, billVersion, billItem, product, unit } = await import("@/generated/drizzle/schema");
    const { eq, inArray } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const [ord] = await db.select().from(order).where(eq(order.id, id));
    if (!ord) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, ord.warehouseId);
    if (forbidden) return forbidden;
    const [cust] = await db.select().from(customer).where(eq(customer.id, ord.customerId));
    const [b] = await db.select().from(bill).where(eq(bill.orderId, id));
    if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const versions = await db.select().from(billVersion).where(eq(billVersion.billId, b.id));
    const version = versions.find((v) => v.versionNumber === b.currentVersion) ?? versions[versions.length - 1]!;
    const versionItems = await db.select().from(billItem).where(eq(billItem.billVersionId, version.id));
    const productIds = [...new Set(versionItems.map((i) => i.productId))];
    const unitIds = [...new Set(versionItems.map((i) => i.unitId))];
    const [products, units] = await Promise.all([
      productIds.length ? db.select().from(product).where(inArray(product.id, productIds)) : Promise.resolve([]),
      unitIds.length ? db.select().from(unit).where(inArray(unit.id, unitIds)) : Promise.resolve([]),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const unitMap = new Map(units.map((u) => [u.id, u]));

    businessName = (await getSetting("BUSINESS_NAME")) || "Hub";
    billNumber = b.billNumber;
    orderNumber = ord.orderNumber;
    ({ date, time } = invoiceStamp(ord.createdAt));
    customerName = cust!.ownerName || cust!.shopName;
    notes = ord.notes;
    customerMobile = cust!.mobile;
    sellingMode = ord.sellingMode;
    items = versionItems.filter(isPrintable).map((it) => ({
      name: productMap.get(it.productId)?.name ?? "",
      quantity: it.quantity,
      unit: unitMap.get(it.unitId)?.symbol ?? "",
      unitPrice: Number(it.unitPrice).toFixed(2),
      lineTotal: Number(it.lineTotal).toFixed(2),
    }));
    subtotal = Number(version.subtotal).toFixed(2);
    discountTotal = Number(version.discountTotal).toFixed(2);
    taxTotal = Number(version.taxTotal).toFixed(2);
    total = Number(version.total).toFixed(2);
  } else {
    const db = (await import("@/lib/db")).getDb();
    const order = await db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        bill: { include: { versions: { include: { items: { include: { product: true, unit: true } } } } } },
      },
    });
    if (!order || !order.bill) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, order.warehouseId);
    if (forbidden) return forbidden;

    const version = order.bill.versions.find((v) => v.versionNumber === order.bill!.currentVersion) ?? order.bill.versions.at(-1)!;
    businessName = (await getSetting("BUSINESS_NAME")) || "Hub";
    billNumber = order.bill.billNumber;
    orderNumber = order.orderNumber;
    ({ date, time } = invoiceStamp(order.createdAt));
    customerName = order.customer.ownerName || order.customer.shopName;
    notes = order.notes;
    customerMobile = order.customer.mobile;
    sellingMode = order.sellingMode;
    items = version.items.filter(isPrintable).map((it) => ({
      name: it.product.name,
      quantity: it.quantity.toString(),
      unit: it.unit.symbol,
      unitPrice: Number(it.unitPrice).toFixed(2),
      lineTotal: Number(it.lineTotal).toFixed(2),
    }));
    subtotal = Number(version.subtotal).toFixed(2);
    discountTotal = Number(version.discountTotal).toFixed(2);
    taxTotal = Number(version.taxTotal).toFixed(2);
    total = Number(version.total).toFixed(2);
  }

  const html = buildInvoiceHtml({ businessName, billNumber, orderNumber, date, time, customerName, customerMobile, sellingMode: sellingMode as any, notes, items, subtotal, discountTotal, taxTotal, total });

  const key = `invoices/${billNumber}.html`;
  await putFile(key, html, "text/html");

  return NextResponse.json({ key, url: `/api/files/${key}` });
}
