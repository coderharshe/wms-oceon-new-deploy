import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { isWorkersRuntime } from "@/lib/cf-env";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const [cashMoves, upiSettlements, expenses] = await Promise.all([
      db.cashTransaction.findMany({
        where: {
          type: "BANK_DEPOSIT",
          ...(warehouseId ? { cashSession: { warehouseId } } : {}),
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
      db.uPISettlement.findMany({
        where: warehouseId ? { warehouseId } : {},
        orderBy: { collectionDate: "desc" },
        take: 50,
      }),
      db.expense.findMany({
        where: warehouseId ? { warehouseId } : {},
        orderBy: { date: "desc" },
        take: 50,
      }),
    ]);

    const totalDeposits = cashMoves.reduce((s, m) => s + Number(m.amount), 0);
    const totalUpi = upiSettlements.reduce((s, u) => s + Number(u.collectedAmount || 0), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const bankBalance = totalDeposits + totalUpi - totalExpenses;

    return NextResponse.json({
      summary: {
        bankBalance: Math.max(0, bankBalance),
        totalDeposits,
        totalUpi,
        totalExpenses,
        unreconciledCount: cashMoves.length,
      },
      deposits: cashMoves.map((c) => ({
        id: c.id,
        amount: String(c.amount),
        note: c.note,
        createdAt: c.timestamp.toISOString(),
      })),
      upiSettlements: upiSettlements.map((u) => ({
        id: u.id,
        amount: String(u.collectedAmount),
        status: u.status,
        gatewayRef: u.notes || null,
        createdAt: u.collectionDate.toISOString(),
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        amount: String(e.amount),
        category: e.category,
        description: e.description,
        createdAt: e.date.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load bank records" }, { status: 500 });
  }
}

const entrySchema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "INTEREST", "CHARGES", "OTHER"]).default("DEPOSIT"),
  amount: z.coerce.number().positive("Amount must be positive"),
  accountNumber: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  status: z.enum(["RECONCILED", "PENDING"]).default("RECONCILED"),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const body = await req.json().catch(() => null);
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const audit = {
    userId: session.sub,
    role: session.role,
    warehouseId: session.warehouseId,
    action: "BANK_ENTRY_RECORDED",
    entityType: "BankStatement",
    entityId: crypto.randomUUID(),
    newValue: parsed.data,
  };

  if (!isWorkersRuntime()) {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit(audit);
  }

  return NextResponse.json(
    {
      success: true,
      entry: {
        id: audit.entityId,
        ...parsed.data,
        createdAt: parsed.data.date ? new Date(parsed.data.date).toISOString() : new Date().toISOString(),
      },
    },
    { status: 201 }
  );
}
