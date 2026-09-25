import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { PaymentError } from "@/lib/payments";

const schema = z.object({
  resolutionType: z.enum(["CASH_REFUND", "UPI_REFUND", "CUSTOMER_CREDIT", "MANAGER_ADJUSTMENT", "ADDITIONAL_PAYMENT"]),
  notes: z.string().optional(),
  clickedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "FINANCE", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { paymentAdjustment, bill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { resolvePaymentAdjustmentDrizzle } = await import("@/lib/drizzle-payment-service");
    const db = getDrizzleDb();

    const [adjustment] = await db.select().from(paymentAdjustment).where(eq(paymentAdjustment.id, id));
    if (!adjustment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [b] = await db.select().from(bill).where(eq(bill.id, adjustment.billId));
    const forbidden = assertWarehouseAccess(session, b!.warehouseId);
    if (forbidden) return forbidden;

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    try {
      await db.transaction((tx) => resolvePaymentAdjustmentDrizzle(tx, { adjustmentId: id, resolutionType: parsed.data.resolutionType, userId: session.sub, notes: parsed.data.notes, clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined }));
    } catch (err) {
      if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
      throw err;
    }
    return NextResponse.json({ ok: true });
  }

  const db = (await import("@/lib/db")).getDb();
  const { resolvePaymentAdjustment } = await import("@/lib/payment-service");
  const adjustment = await db.paymentAdjustment.findUnique({ where: { id }, include: { bill: true } });
  if (!adjustment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, adjustment.bill.warehouseId);
  if (forbidden) return forbidden;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await db.$transaction((tx) =>
      resolvePaymentAdjustment(tx, { adjustmentId: id, resolutionType: parsed.data.resolutionType, userId: session.sub, notes: parsed.data.notes, clickedAt: parsed.data.clickedAt ? new Date(parsed.data.clickedAt) : undefined })
    );
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ ok: true });
}
