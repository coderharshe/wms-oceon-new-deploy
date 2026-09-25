import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { PaymentError } from "@/lib/payments";
import { completeIfQcOff } from "@/lib/complete-without-qc";

// Manual confirm, standing in for a payment-gateway webhook (PRD §18: "the
// architecture should support a payment gateway/webhook in the future" —
// swap this handler's body for the webhook signature-verify + this same
// confirmUpiPayment() call when a real gateway is wired up).
const schema = z.object({ transactionId: z.string(), upiReference: z.string().optional(), clickedAt: z.string().datetime().optional() });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { paymentTransaction, payment, bill } = await import("@/generated/drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { confirmUpiPaymentDrizzle } = await import("@/lib/drizzle-payment-service");
      const db = getDrizzleDb();

      const [transaction] = await db.select().from(paymentTransaction).where(eq(paymentTransaction.id, parsed.data.transactionId));
      if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      const [pay] = await db.select().from(payment).where(eq(payment.id, transaction.paymentId));
      const [b] = await db.select().from(bill).where(eq(bill.id, pay!.billId));
      const forbidden = assertWarehouseAccess(session, b!.warehouseId);
      if (forbidden) return forbidden;

      const result = await db.transaction((tx) =>
        confirmUpiPaymentDrizzle(tx, { transactionId: transaction.id, userId: session.sub, warehouseId: b!.warehouseId, orderId: b!.orderId, billId: b!.id, upiReference: parsed.data.upiReference, clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined })
      );
      await completeIfQcOff(b!.orderId, session.sub);
      return NextResponse.json(result);
    }

    const db = (await import("@/lib/db")).getDb();
    const { confirmUpiPayment } = await import("@/lib/payment-service");
    const transaction = await db.paymentTransaction.findUnique({
      where: { id: parsed.data.transactionId },
      include: { payment: { include: { bill: true } } },
    });
    if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const bill = transaction.payment.bill;
    const forbidden = assertWarehouseAccess(session, bill.warehouseId);
    if (forbidden) return forbidden;

    const result = await db.$transaction((tx) =>
      confirmUpiPayment(tx, {
        transactionId: transaction.id,
        userId: session.sub,
        warehouseId: bill.warehouseId,
        orderId: bill.orderId,
        billId: bill.id,
        upiReference: parsed.data.upiReference,
        clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined,
      })
    );

    await completeIfQcOff(bill.orderId, session.sub);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
