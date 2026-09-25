import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { PaymentError } from "@/lib/payments";
import { DuplicateRequestError } from "@/lib/idempotency";
import { completeIfQcOff } from "@/lib/complete-without-qc";

const splitItemSchema = z.object({
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
});

const schema = z.object({
  billId: z.string(),
  method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CREDIT", "SPLIT"]),
  amountReceived: z.number().positive().optional(),
  bankReference: z.string().optional(),
  bankName: z.string().optional(),
  chequeNumber: z.string().optional(),
  chequeBank: z.string().optional(),
  chequeDueDate: z.string().optional(),
  notes: z.string().optional(),
  splitItems: z.array(splitItemSchema).optional(),
  clickedAt: z.string().datetime().optional(),
  clientRequestId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { billId, method, amountReceived, bankReference, bankName, chequeNumber, chequeBank, chequeDueDate, notes, splitItems, clickedAt, clientRequestId } = parsed.data;

  try {
    const db = (await import("@/lib/db")).getDb();
    const { recordMultiTenderPayment } = await import("@/lib/payment-service");

    const bill = await db.bill.findUnique({ where: { id: billId }, include: { payment: true } });
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    const forbidden = assertWarehouseAccess(session, bill.warehouseId);
    if (forbidden) return forbidden;

    if (method === "CREDIT") {
      // Mark as credit / unpaid
      return NextResponse.json({ ok: true, status: "UNPAID", credit: true });
    }

    const due = bill.payment ? Number(bill.payment.amountDue) - Number(bill.payment.amountPaid) : 0;
    const finalAmount = amountReceived ?? due;

    const result = await db.$transaction((tx) =>
      recordMultiTenderPayment(tx, {
        billId: bill.id,
        method,
        amountReceived: new Decimal(finalAmount),
        userId: session.sub,
        warehouseId: bill.warehouseId,
        orderId: bill.orderId,
        bankReference,
        bankName,
        chequeNumber,
        chequeBank,
        chequeDueDate: chequeDueDate ? new Date(chequeDueDate) : undefined,
        notes,
        splitItems: splitItems?.map((s) => ({
          method: s.method,
          amount: new Decimal(s.amount),
          reference: s.reference,
        })),
        clickedAt: clickedAt ? new Date(clickedAt) : undefined,
        clientRequestId,
      })
    );

    await completeIfQcOff(bill.orderId, session.sub);

    return NextResponse.json({
      ok: true,
      transaction: result.transaction,
      change: result.change.toString(),
    });
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof DuplicateRequestError) return NextResponse.json({ ok: true, duplicate: true });
    console.error("Multi-tender payment error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Payment failed" }, { status: 500 });
  }
}
