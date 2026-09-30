import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { auditQ, recordCashMovement } from "@/lib/cash";
import { inTransaction } from "@/lib/cash-db";
import { getDb } from "@/lib/db";

// Cash moved by hand, not tied to a bill: taken to the bank (BANK_DEPOSIT —
// the bank reconciliation expects it to arrive there), paid out for an
// expense or to the owner (WITHDRAWAL), or put in (OTHER_RECEIPT).
const schema = z.object({
  type: z.enum(["BANK_DEPOSIT", "WITHDRAWAL", "OTHER_RECEIPT"]),
  amount: z.number().positive().max(1e10),
  note: z.string().trim().min(1, "Say what the cash was for").max(500),
  bankAccountId: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  if (!session.warehouseId && session.role !== "ADMIN") return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const warehouseId = session.warehouseId || req.nextUrl.searchParams.get("warehouseId") || "none";

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const row = await inTransaction(async (q) => {
    const r = await recordCashMovement(q, {
      warehouseId,
      userId: session.sub,
      type: parsed.data.type,
      amount: parsed.data.amount,
      note: parsed.data.note,
    });
    await auditQ(q, {
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: "CASH_TRANSACTION_RECORDED",
      entityType: "CashTransaction",
      entityId: r.id,
      newValue: {
        type: parsed.data.type,
        amount: parsed.data.amount,
        bankName: parsed.data.bankName,
        accountNumber: parsed.data.accountNumber,
      },
      reason: parsed.data.note,
    });
    return r;
  });

  // Automatically record corresponding Bank or Expense ledger entry for proper double-entry accounting!
  try {
    const db = getDb();
    if (parsed.data.type === "BANK_DEPOSIT") {
      await db.bankTransaction.create({
        data: {
          warehouseId,
          businessDate: new Date(),
          type: "DIRECT_DEPOSIT",
          amount: parsed.data.amount,
          isCredit: true, // Cash deposit credited into the bank account
          bankName: parsed.data.bankName || "Bank Account",
          accountNumber: parsed.data.accountNumber || null,
          partyName: "Counter Till Cash",
          notes: parsed.data.note || "Cash Drawer Deposit to Bank",
          reconciled: true,
          recordedByUserId: session.sub,
        },
      });
    } else if (parsed.data.type === "WITHDRAWAL") {
      await db.expense.create({
        data: {
          warehouseId,
          amount: parsed.data.amount,
          category: "MISCELLANEOUS",
          date: new Date(),
          paymentMode: "CASH",
          description: `Cash payout: ${parsed.data.note}`,
          createdByUserId: session.sub,
          approvedByUserId: session.sub,
        },
      });
    }
  } catch (syncErr) {
    console.error("Failed to sync secondary ledger transaction:", syncErr);
  }

  return NextResponse.json(row, { status: 201 });
}
