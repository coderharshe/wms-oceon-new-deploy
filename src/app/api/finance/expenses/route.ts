import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const category = req.nextUrl.searchParams.get("category") ?? undefined;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (category) where.category = category as any;

    const expenses = await db.expense.findMany({
      where,
      include: {
        warehouse: { select: { name: true, code: true } },
        createdByUser: { select: { name: true, staffId: true } },
        approvedByUser: { select: { name: true, staffId: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    });

    const categorySummary: Record<string, number> = {};
    let totalExpense = 0;

    for (const exp of expenses) {
      const amt = Number(exp.amount);
      totalExpense += amt;
      categorySummary[exp.category] = (categorySummary[exp.category] || 0) + amt;
    }

    return NextResponse.json({
      totalExpense,
      categorySummary,
      expenses,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load expenses" }, { status: 500 });
  }
}

const expenseSchema = z.object({
  warehouseId: z.string().optional(),
  amount: z.number().positive(),
  category: z.enum([
    "RENT",
    "ELECTRICITY",
    "SALARY",
    "TRANSPORT",
    "PACKAGING",
    "MARKETING",
    "SOFTWARE",
    "MAINTENANCE",
    "MISCELLANEOUS",
  ]),
  date: z.string().min(1),
  paymentMode: z.enum(["CASH", "UPI"]).default("CASH"),
  description: z.string().min(2, "Description is required"),
  attachmentKey: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = expenseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const expense = await db.expense.create({
      data: {
        warehouseId,
        amount: parsed.data.amount,
        category: parsed.data.category,
        date: new Date(parsed.data.date),
        paymentMode: parsed.data.paymentMode,
        description: parsed.data.description,
        attachmentKey: parsed.data.attachmentKey,
        createdByUserId: session.sub,
        approvedByUserId: session.sub,
      },
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: "EXPENSE_RECORDED",
      entityType: "Expense",
      entityId: expense.id,
      newValue: { amount: expense.amount, category: expense.category, description: expense.description },
    });

    return NextResponse.json({ success: true, expense });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save expense" }, { status: 500 });
  }
}
