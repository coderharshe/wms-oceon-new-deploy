import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { PaymentError } from "@/lib/payments";
import { DuplicateRequestError } from "@/lib/idempotency";
import { completeIfQcOff } from "@/lib/complete-without-qc";

const schema = z.object({
  // Exactly one of the two. orderRequestId is the clientRequestId of a bill
  // made offline: cash taken against it is queued before the PC ever learns
  // the real bill id, so the bill is found through its order.
  billId: z.string().optional(),
  orderRequestId: z.string().uuid().optional(),
  amountReceived: z.number().positive(),
  clickedAt: z.string().datetime().optional(),
  // Set when this request came from the offline write-queue being flushed —
  // see src/lib/idempotency.ts.
  clientRequestId: z.string().optional(),
}).refine((b) => !!b.billId !== !!b.orderRequestId, { message: "Send billId or orderRequestId, not both" });

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
      const { recordCashPaymentDrizzle } = await import("@/lib/drizzle-payment-service");
      const db = getDrizzleDb();

      const [b] = parsed.data.billId
        ? await db.select().from(bill).where(eq(bill.id, parsed.data.billId))
        : await db.select({ bill }).from(bill).innerJoin(order, eq(order.id, bill.orderId)).where(eq(order.clientRequestId, parsed.data.orderRequestId!)).then((r) => r.map((x) => x.bill));
      if (!b) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, b.warehouseId);
      if (forbidden) return forbidden;

      const result = await db.transaction((tx) =>
        recordCashPaymentDrizzle(tx, { billId: b.id, amountReceived: new Decimal(parsed.data.amountReceived), userId: session.sub, warehouseId: b.warehouseId, orderId: b.orderId, clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined, clientRequestId: parsed.data.clientRequestId })
      );
      await completeIfQcOff(b.orderId, session.sub);
      return NextResponse.json({ transaction: result.transaction, change: result.change.toString() });
    }

    const db = (await import("@/lib/db")).getDb();
    const { recordCashPayment } = await import("@/lib/payment-service");
    const bill = parsed.data.billId
      ? await db.bill.findUnique({ where: { id: parsed.data.billId } })
      : await db.bill.findFirst({ where: { order: { clientRequestId: parsed.data.orderRequestId } } });
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, bill.warehouseId);
    if (forbidden) return forbidden;

    const result = await db.$transaction((tx) =>
      recordCashPayment(tx, {
        billId: bill.id,
        amountReceived: new Decimal(parsed.data.amountReceived),
        userId: session.sub,
        warehouseId: bill.warehouseId,
        orderId: bill.orderId,
        clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined,
        clientRequestId: parsed.data.clientRequestId,
      })
    );

    await completeIfQcOff(bill.orderId, session.sub);
    return NextResponse.json({
      transaction: result.transaction,
      change: result.change.toString(),
    });
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof DuplicateRequestError) return NextResponse.json({ ok: true, duplicate: true });
    throw err;
  }
}
