import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({ transactionId: z.string() });

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { paymentTransaction, payment, bill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { failUpiPaymentDrizzle } = await import("@/lib/drizzle-payment-service");
    const db = getDrizzleDb();

    const [transaction] = await db.select().from(paymentTransaction).where(eq(paymentTransaction.id, parsed.data.transactionId));
    if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    const [pay] = await db.select().from(payment).where(eq(payment.id, transaction.paymentId));
    const [b] = await db.select().from(bill).where(eq(bill.id, pay!.billId));
    const forbidden = assertWarehouseAccess(session, b!.warehouseId);
    if (forbidden) return forbidden;

    await db.transaction((tx) => failUpiPaymentDrizzle(tx, { transactionId: transaction.id, orderId: b!.orderId }));
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const { failUpiPayment } = await import("@/lib/payment-service");
  const transaction = await db.paymentTransaction.findUnique({
    where: { id: parsed.data.transactionId },
    include: { payment: { include: { bill: true } } },
  });
  if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, transaction.payment.bill.warehouseId);
  if (forbidden) return forbidden;

  await db.$transaction((tx) => failUpiPayment(tx, { transactionId: transaction.id, orderId: transaction.payment.bill.orderId }));
  return NextResponse.json({ ok: true });
}
