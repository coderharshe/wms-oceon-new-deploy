import { NextResponse } from "next/server";
import { buildUpiLink, upiQrDataUrl, UpiNotConfiguredError } from "@/lib/upi";
import { getSetting } from "@/lib/settings";
import { isWorkersRuntime } from "@/lib/cf-env";

// Public, unauthenticated (kiosk screen at the counter). Deliberately returns
// only what PRD §16 lists — never customer contact info, staff names, cost
// prices, or anything else from the order.
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  let orderNumber: string, billNumber: string, paymentStatus: string, due: number, paid: number;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, bill, payment } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const [ord] = await db.select().from(order).where(eq(order.id, orderId));
    if (!ord) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [b] = await db.select().from(bill).where(eq(bill.orderId, orderId));
    if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [pay] = await db.select().from(payment).where(eq(payment.billId, b.id));
    if (!pay) return NextResponse.json({ error: "Not found" }, { status: 404 });

    orderNumber = ord.orderNumber;
    billNumber = b.billNumber;
    paymentStatus = b.paymentStatus;
    due = Number(pay.amountDue);
    paid = Number(pay.amountPaid);
  } else {
    const db = (await import("@/lib/db")).getDb();
    const order = await db.order.findUnique({ where: { id: orderId }, include: { bill: { include: { payment: true } } } });
    if (!order || !order.bill || !order.bill.payment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    orderNumber = order.orderNumber;
    billNumber = order.bill.billNumber;
    paymentStatus = order.bill.paymentStatus;
    due = Number(order.bill.payment.amountDue);
    paid = Number(order.bill.payment.amountPaid);
  }

  const balance = Math.max(0, due - paid);
  // A missing UPI_VPA must not take the counter's payment display down with
  // it — buildUpiLink now refuses to mint a QR against an unconfigured payee
  // (it would have sent the customer's money to whoever owns the
  // placeholder). Degrade to "no QR" and let the screen show the amount due
  // so staff can still collect cash.
  let qrDataUrl: string | null = null;
  let upiConfigured = true;
  if (balance > 0) {
    try {
      const link = await buildUpiLink({ amount: balance.toFixed(2), orderNumber });
      qrDataUrl = await upiQrDataUrl(link);
    } catch (err) {
      if (!(err instanceof UpiNotConfiguredError)) throw err;
      upiConfigured = false;
    }
  }

  return NextResponse.json({
    businessName: (await getSetting("BUSINESS_NAME")) || "Store",
    orderNumber,
    billNumber,
    amountPayable: balance,
    paymentStatus,
    qrDataUrl,
    upiConfigured,
  });
}
