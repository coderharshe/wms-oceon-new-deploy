import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { prismaQ, recordCashMovement } from "@/lib/cash";

const depositSchema = z.object({
  warehouseId: z.string().optional(),
  amount: z.number().positive(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  referenceNo: z.string().optional(),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const parsed = depositSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const warehouseId = session.role === "ADMIN" ? input.warehouseId || session.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  const db = (await import("@/lib/db")).getDb();
  const amount = new Decimal(input.amount);

  const result = await db.$transaction(async (tx) => {
    // 1. Record cash movement (BANK_DEPOSIT: out from physical drawer)
    await recordCashMovement(prismaQ(tx), {
      warehouseId,
      userId: session.sub,
      type: "BANK_DEPOSIT",
      amount,
      referenceId: input.referenceNo,
      note: input.note || (input.bankName ? `Deposited to ${input.bankName}` : "Cash deposited into Bank"),
    });

    // 2. Record bank transaction (DIRECT_DEPOSIT: into bank account)
    const bankTx = await tx.bankTransaction.create({
      data: {
        warehouseId,
        businessDate: new Date(),
        type: "DIRECT_DEPOSIT",
        amount,
        isCredit: true,
        utrReference: input.referenceNo?.trim() || null,
        bankName: input.bankName?.trim() || null,
        accountNumber: input.accountNumber?.trim() || null,
        notes: input.note?.trim() || "Cash Drawer Deposit",
        reconciled: true,
        recordedByUserId: session.sub,
      },
    });

    return bankTx;
  });

  return NextResponse.json({ ok: true, transaction: result });
}
