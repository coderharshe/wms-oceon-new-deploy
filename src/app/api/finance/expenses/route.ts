import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const categoryFilter = req.nextUrl.searchParams.get("category");
  const range = req.nextUrl.searchParams.get("range") || "thisMonth";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    const now = new Date();
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (range === "today") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else if (range === "7d") {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
    } else if (range === "thisMonth") {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    if (fromDate) {
      where.date = {
        gte: fromDate,
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    const expenses = await db.expense.findMany({
      where,
      include: {
        warehouse: { select: { name: true, code: true } },
        createdByUser: { select: { id: true, name: true, staffId: true, role: true } },
        approvedByUser: { select: { id: true, name: true, staffId: true, role: true } },
      },
      orderBy: { date: "desc" },
      take: 200,
    });

    const categorySummary: Record<string, number> = {
      RENT: 0,
      ELECTRICITY: 0,
      SALARY: 0,
      DELIVERY: 0,
      PACKAGING: 0,
      MARKETING: 0,
      SOFTWARE: 0,
      REPAIRS: 0,
      TRANSPORT: 0,
      MISCELLANEOUS: 0,
      OTHERS: 0,
    };

    const paymentModeSummary: Record<string, number> = {
      CASH: 0,
      BANK_TRANSFER: 0,
      UPI: 0,
      CHEQUE: 0,
    };

    let totalExpense = 0;
    let pendingApprovalCount = 0;
    let pendingApprovalAmount = 0;

    const parsedExpenses = expenses.map((exp) => {
      const amt = Number(exp.amount);
      totalExpense += amt;

      // Map Prisma category to UI display category
      let displayCat = exp.category as string;
      const descLower = exp.description.toLowerCase();
      if (exp.category === "TRANSPORT" && descLower.includes("delivery")) {
        displayCat = "DELIVERY";
      } else if (exp.category === "MAINTENANCE") {
        displayCat = "REPAIRS";
      }

      categorySummary[displayCat] = (categorySummary[displayCat] || 0) + amt;

      const mode = exp.paymentMode as string;
      paymentModeSummary[mode] = (paymentModeSummary[mode] || 0) + amt;

      if (!exp.approvedByUserId) {
        pendingApprovalCount += 1;
        pendingApprovalAmount += amt;
      }

      // Parse metadata from description (e.g. "Vendor: ABC | Invoice: INV-123 | Account: HDFC | Notes: text")
      let vendor = "General Vendor";
      let invoiceProof = exp.attachmentKey || "—";
      let account = exp.paymentMode === "CASH" ? "Cash Drawer" : "HDFC Current";
      let notes = exp.description;

      const parts = exp.description.split("|").map((p) => p.trim());
      for (const p of parts) {
        if (p.toLowerCase().startsWith("vendor:")) {
          vendor = p.slice(7).trim();
        } else if (p.toLowerCase().startsWith("invoice:") || p.toLowerCase().startsWith("proof:")) {
          invoiceProof = p.slice(p.indexOf(":") + 1).trim();
        } else if (p.toLowerCase().startsWith("account:")) {
          account = p.slice(8).trim();
        } else if (p.toLowerCase().startsWith("notes:")) {
          notes = p.slice(6).trim();
        }
      }

      return {
        id: exp.id,
        amount: amt,
        category: exp.category,
        displayCategory: displayCat,
        date: new Date(exp.date).toISOString().slice(0, 10),
        paymentMode: exp.paymentMode,
        account,
        vendor,
        invoiceProof,
        description: exp.description,
        notes,
        attachmentKey: exp.attachmentKey,
        isApproved: !!exp.approvedByUserId,
        createdByUser: exp.createdByUser ? { name: exp.createdByUser.name, staffId: exp.createdByUser.staffId } : null,
        approvedByUser: exp.approvedByUser ? { name: exp.approvedByUser.name, staffId: exp.approvedByUser.staffId } : null,
        warehouse: exp.warehouse?.name || "Main Warehouse",
      };
    });

    // Apply client category filter if specified
    const filteredList = categoryFilter
      ? parsedExpenses.filter((e) => e.displayCategory === categoryFilter || e.category === categoryFilter)
      : parsedExpenses;

    return NextResponse.json({
      userRole: session.role,
      userId: session.sub,
      totalExpense,
      pendingApprovalCount,
      pendingApprovalAmount,
      categorySummary,
      paymentModeSummary,
      expenses: filteredList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load expenses" }, { status: 500 });
  }
}

const expenseCreateSchema = z.object({
  action: z.enum(["RECORD", "APPROVE"]).optional().default("RECORD"),
  expenseId: z.string().optional(),
  warehouseId: z.string().optional(),
  amount: z.number().positive().optional(),
  category: z.enum([
    "RENT",
    "ELECTRICITY",
    "SALARY",
    "DELIVERY",
    "PACKAGING",
    "MARKETING",
    "SOFTWARE",
    "REPAIRS",
    "TRANSPORT",
    "MISCELLANEOUS",
    "OTHERS",
  ]).optional(),
  date: z.string().optional(),
  paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  account: z.string().optional(),
  vendor: z.string().optional(),
  invoiceProof: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = expenseCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;
  const db = getDb();

  try {
    // ──────────────────────── ACTION: APPROVE EXPENSE ────────────────────────
    if (data.action === "APPROVE") {
      if (!data.expenseId) return NextResponse.json({ error: "expenseId required" }, { status: 400 });
      if (session.role !== "ADMIN" && session.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Managers or Admins can approve expenses" }, { status: 403 });
      }

      const expense = await db.expense.update({
        where: { id: data.expenseId },
        data: { approvedByUserId: session.sub },
      });

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: expense.warehouseId,
        action: "EXPENSE_APPROVED",
        entityType: "Expense",
        entityId: expense.id,
        newValue: { amount: expense.amount, category: expense.category, approvedBy: session.sub },
      });

      return NextResponse.json({ success: true, expense });
    }

    // ──────────────────────── ACTION: RECORD EXPENSE ────────────────────────
    const targetWarehouseId = data.warehouseId || session.warehouseId || "none";
    const resolvedWarehouseId = targetWarehouseId !== "none" ? targetWarehouseId : (await db.warehouse.findFirst())?.id || "";

    if (!data.amount || !data.category || !data.date) {
      return NextResponse.json({ error: "Amount, category, and date are required" }, { status: 400 });
    }

    // Map UI category to Prisma Enum
    let prismaCategory: "RENT" | "ELECTRICITY" | "SALARY" | "TRANSPORT" | "PACKAGING" | "MARKETING" | "SOFTWARE" | "MAINTENANCE" | "MISCELLANEOUS" = "MISCELLANEOUS";
    if (data.category === "RENT") prismaCategory = "RENT";
    else if (data.category === "ELECTRICITY") prismaCategory = "ELECTRICITY";
    else if (data.category === "SALARY") prismaCategory = "SALARY";
    else if (data.category === "TRANSPORT" || data.category === "DELIVERY") prismaCategory = "TRANSPORT";
    else if (data.category === "PACKAGING") prismaCategory = "PACKAGING";
    else if (data.category === "MARKETING") prismaCategory = "MARKETING";
    else if (data.category === "SOFTWARE") prismaCategory = "SOFTWARE";
    else if (data.category === "REPAIRS") prismaCategory = "MAINTENANCE";
    else prismaCategory = "MISCELLANEOUS";

    const vendorStr = data.vendor?.trim() || "General Vendor";
    const invoiceProofStr = data.invoiceProof?.trim() || "—";
    const accountStr = data.account?.trim() || (data.paymentMode === "CASH" ? "Cash Drawer" : "HDFC Current");
    const notesStr = data.notes?.trim() || `${data.category} expense`;

    // Composite description for rich storage
    const compositeDescription = `Vendor: ${vendorStr} | Invoice: ${invoiceProofStr} | Account: ${accountStr} | Notes: ${notesStr}`;

    // Tiered Approval:
    // Expenses <= ₹10,000 or entered by Manager/Admin are auto-approved
    // Expenses > ₹10,000 entered by Finance require Manager sign-off
    const amt = data.amount;
    const isAutoApproved = amt <= 10000 || session.role === "ADMIN" || session.role === "MANAGER";
    const approvedByUserId = isAutoApproved ? session.sub : null;

    const expense = await db.expense.create({
      data: {
        warehouseId: resolvedWarehouseId,
        amount: amt,
        category: prismaCategory,
        date: new Date(data.date),
        paymentMode: (data.paymentMode as any) || "CASH",
        description: compositeDescription,
        attachmentKey: data.invoiceProof || undefined,
        createdByUserId: session.sub,
        approvedByUserId,
      },
    });

    // If Bank Transfer / UPI, create a BankTransaction entry so Bank Management tracks the debit!
    if (data.paymentMode === "BANK_TRANSFER" || data.paymentMode === "UPI" || data.paymentMode === "CHEQUE") {
      await db.bankTransaction.create({
        data: {
          warehouseId: resolvedWarehouseId,
          businessDate: new Date(data.date),
          type: "EXPENSE_PAYOUT",
          amount: amt,
          isCredit: false, // Outflow
          bankName: accountStr,
          utrReference: data.invoiceProof || null,
          partyName: vendorStr,
          notes: `Expense [${data.category}]: ${notesStr}`,
          reconciled: false,
          recordedByUserId: session.sub,
        },
      });
    }

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId: resolvedWarehouseId,
      action: "EXPENSE_RECORDED",
      entityType: "Expense",
      entityId: expense.id,
      newValue: {
        amount: amt,
        category: data.category,
        vendor: vendorStr,
        account: accountStr,
        paymentMode: data.paymentMode,
        isApproved: isAutoApproved,
      },
    });

    return NextResponse.json({ success: true, expense, isApproved: isAutoApproved });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save expense" }, { status: 500 });
  }
}
