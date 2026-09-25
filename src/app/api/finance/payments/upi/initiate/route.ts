import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { buildUpiLink, upiQrDataUrl, UpiNotConfiguredError } from "@/lib/upi";
import { PaymentError } from "@/lib/payments";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({ billId: z.string() });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { bill, order } = await import("@/generated/drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { initiateUpiPaymentDrizzle } = await import("@/lib/drizzle-payment-service");
      const db = getDrizzleDb();

      const [b] = await db.select().from(bill).where(eq(bill.id, parsed.data.billId));
      if (!b) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, b.warehouseId);
      if (forbidden) return forbidden;
      const [ord] = await db.select().from(order).where(eq(order.id, b.orderId));

      const transaction = await db.transaction((tx) => initiateUpiPaymentDrizzle(tx, { billId: b.id, userId: session.sub, warehouseId: b.warehouseId, orderId: b.orderId }));
      const link = await buildUpiLink({ amount: transaction.amount.toString(), orderNumber: ord!.orderNumber, transactionId: transaction.id });
      const qrDataUrl = await upiQrDataUrl(link);
      return NextResponse.json({ transaction, link, qrDataUrl });
    }

    const db = (await import("@/lib/db")).getDb();
    const { initiateUpiPayment } = await import("@/lib/payment-service");
    const bill = await db.bill.findUnique({ where: { id: parsed.data.billId }, include: { order: true } });
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, bill.warehouseId);
    if (forbidden) return forbidden;

    const transaction = await db.$transaction((tx) =>
      initiateUpiPayment(tx, { billId: bill.id, userId: session.sub, warehouseId: bill.warehouseId, orderId: bill.orderId })
    );

    const link = await buildUpiLink({ amount: transaction.amount.toString(), orderNumber: bill.order.orderNumber, transactionId: transaction.id });
    const qrDataUrl = await upiQrDataUrl(link);

    return NextResponse.json({ transaction, link, qrDataUrl });
  } catch (err) {
    // The PENDING transaction survives — initiate reuses it once the VPA is set.
    if (err instanceof UpiNotConfiguredError) {
      return NextResponse.json({ error: "UPI is not configured — set the UPI VPA in Settings before taking UPI payments" }, { status: 400 });
    }
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
