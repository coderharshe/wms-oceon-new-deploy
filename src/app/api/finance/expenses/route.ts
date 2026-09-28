import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";

export type ExpenseCategoryDef = {
  key: string;
  label: string;
  color: string;
  isCustom?: boolean;
};

const DEFAULT_CATEGORIES: ExpenseCategoryDef[] = [
  { key: "RENT", label: "🏢 Rent", color: "bg-indigo-500/10 text-indigo-700 border-indigo-500/30" },
  { key: "ELECTRICITY", label: "💡 Electricity", color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { key: "SALARY", label: "👥 Salary", color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  { key: "DELIVERY", label: "🚚 Delivery", color: "bg-cyan-500/10 text-cyan-700 border-cyan-500/30" },
  { key: "PACKAGING", label: "📦 Packaging", color: "bg-orange-500/10 text-orange-700 border-orange-500/30" },
  { key: "MARKETING", label: "📢 Marketing", color: "bg-pink-500/10 text-pink-700 border-pink-500/30" },
  { key: "SOFTWARE", label: "💻 Software", color: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { key: "REPAIRS", label: "🔧 Repairs", color: "bg-rose-500/10 text-rose-700 border-rose-500/30" },
  { key: "TRANSPORT", label: "🚛 Transport", color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { key: "MISCELLANEOUS", label: "📋 Miscellaneous", color: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  { key: "OTHERS", label: "📌 Others", color: "bg-zinc-500/10 text-zinc-700 border-zinc-500/30" },
];

async function getCustomCategories(): Promise<ExpenseCategoryDef[]> {
  try {
    const raw = await getSetting("CUSTOM_EXPENSE_TYPES");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

async function saveCustomCategory(name: string, icon = "⚡"): Promise<ExpenseCategoryDef> {
  const customCats = await getCustomCategories();
  const trimmed = name.trim();
  const key = trimmed.toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");

  const existing = customCats.find((c) => c.key === key || c.label.toLowerCase().includes(trimmed.toLowerCase()));
  if (existing) return existing;

  const colorPalettes = [
    "bg-teal-500/10 text-teal-700 border-teal-500/30",
    "bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/30",
    "bg-sky-500/10 text-sky-700 border-sky-500/30",
    "bg-lime-500/10 text-lime-700 border-lime-500/30",
    "bg-violet-500/10 text-violet-700 border-violet-500/30",
    "bg-amber-600/10 text-amber-800 border-amber-600/30",
  ];
  const color = colorPalettes[customCats.length % colorPalettes.length] ?? "bg-teal-500/10 text-teal-700 border-teal-500/30";

  const newCat: ExpenseCategoryDef = {
    key: key || `EXP_${Date.now()}`,
    label: `${icon} ${trimmed}`,
    color,
    isCustom: true,
  };

  const updated = [...customCats, newCat];
  await setSetting("CUSTOM_EXPENSE_TYPES", JSON.stringify(updated));
  return newCat;
}

async function getCustomPaymentModes(): Promise<string[]> {
  try {
    const raw = await getSetting("CUSTOM_PAYMENT_MODES");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

async function saveCustomPaymentMode(mode: string): Promise<string> {
  const modes = await getCustomPaymentModes();
  const trimmed = mode.trim();
  if (!trimmed || modes.some((m) => m.toLowerCase() === trimmed.toLowerCase())) return trimmed;
  const updated = [...modes, trimmed];
  await setSetting("CUSTOM_PAYMENT_MODES", JSON.stringify(updated));
  return trimmed;
}

async function saveCustomBankAccount(accountName: string): Promise<void> {
  const raw = await getSetting("BANK_ACCOUNTS_CONFIG");
  let accounts: any[] = [];
  try {
    if (raw) accounts = JSON.parse(raw) || [];
  } catch {}
  const trimmed = accountName.trim();
  if (accounts.some((a) => a.name?.toLowerCase() === trimmed.toLowerCase())) return;

  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString().slice(-4);
  const newAcc = {
    id,
    name: trimmed,
    bankName: trimmed,
    accountNumber: "Custom",
    accountType: "CURRENT",
    openingBalance: 0,
    openingDate: new Date().toISOString().split("T")[0],
    active: true,
  };
  const filtered = accounts.filter((a) => a.id !== "hdfc-current" && a.id !== "sbi-current" && a.id !== "other-bank");
  const updated = [...filtered, newAcc];
  await setSetting("BANK_ACCOUNTS_CONFIG", JSON.stringify(updated));
}

async function getBankAccounts(): Promise<{ id: string; name: string; bankName: string; accountNumber: string; isDefault?: boolean }[]> {
  try {
    const raw = await getSetting("BANK_ACCOUNTS_CONFIG");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((a: any) => {
        if (!a || a.active === false) return false;
        if (a.id === "hdfc-current" && a.accountNumber === "50200088991122") return false;
        if (a.id === "sbi-current" && a.accountNumber === "38912345678") return false;
        if (a.id === "other-bank" && a.accountNumber === "987654321098") return false;
        return true;
      });
    }
    return [];
  } catch {
    return [];
  }
}

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

    const [expenses, customCategories, bankAccounts, customPaymentModes] = await Promise.all([
      db.expense.findMany({
        where,
        include: {
          warehouse: { select: { name: true, code: true } },
          createdByUser: { select: { id: true, name: true, staffId: true, role: true } },
          approvedByUser: { select: { id: true, name: true, staffId: true, role: true } },
        },
        orderBy: { date: "desc" },
        take: 200,
      }),
      getCustomCategories(),
      getBankAccounts(),
      getCustomPaymentModes(),
    ]);

    const allCategories: ExpenseCategoryDef[] = [...DEFAULT_CATEGORIES, ...customCategories];

    const categorySummary: Record<string, number> = {};
    for (const cat of allCategories) {
      categorySummary[cat.key] = 0;
    }

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

      // Parse metadata from description (e.g. "Category: ABC | Mode: XYZ | Vendor: ... | Account: ...")
      let vendor = "General Vendor";
      let invoiceProof = exp.attachmentKey || "—";
      let account = exp.paymentMode === "CASH" ? "Cash Drawer" : (bankAccounts[0]?.name || "Bank Account");
      let notes = exp.description;
      let explicitCategory: string | null = null;
      let explicitMode: string | null = null;

      const parts = exp.description.split("|").map((p) => p.trim());
      for (const p of parts) {
        if (p.toLowerCase().startsWith("category:")) {
          explicitCategory = p.slice(9).trim();
        } else if (p.toLowerCase().startsWith("mode:")) {
          explicitMode = p.slice(5).trim();
        } else if (p.toLowerCase().startsWith("vendor:")) {
          vendor = p.slice(7).trim();
        } else if (p.toLowerCase().startsWith("invoice:") || p.toLowerCase().startsWith("proof:")) {
          invoiceProof = p.slice(p.indexOf(":") + 1).trim();
        } else if (p.toLowerCase().startsWith("account:")) {
          account = p.slice(8).trim();
        } else if (p.toLowerCase().startsWith("notes:")) {
          notes = p.slice(6).trim();
        }
      }

      // Map to UI display category
      let displayCat = explicitCategory || (exp.category as string);
      const descLower = exp.description.toLowerCase();
      if (!explicitCategory) {
        if (exp.category === "TRANSPORT" && descLower.includes("delivery")) {
          displayCat = "DELIVERY";
        } else if (exp.category === "MAINTENANCE") {
          displayCat = "REPAIRS";
        }
      }

      categorySummary[displayCat] = (categorySummary[displayCat] || 0) + amt;

      const mode = exp.paymentMode as string;
      paymentModeSummary[mode] = (paymentModeSummary[mode] || 0) + amt;

      if (!exp.approvedByUserId) {
        pendingApprovalCount += 1;
        pendingApprovalAmount += amt;
      }

      return {
        id: exp.id,
        amount: amt,
        category: exp.category,
        displayCategory: displayCat,
        date: new Date(exp.date).toISOString().slice(0, 10),
        paymentMode: exp.paymentMode,
        displayPaymentMode: explicitMode || exp.paymentMode,
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
      categories: allCategories,
      accounts: bankAccounts,
      customPaymentModes,
      expenses: filteredList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load expenses" }, { status: 500 });
  }
}

const expenseActionSchema = z.object({
  action: z.enum(["RECORD", "APPROVE", "ADD_CATEGORY", "DELETE_CATEGORY"]).optional().default("RECORD"),
  expenseId: z.string().optional(),
  warehouseId: z.string().optional(),
  amount: z.number().positive().optional(),
  category: z.string().optional(),
  customCategoryName: z.string().optional(),
  customCategoryIcon: z.string().optional(),
  categoryKey: z.string().optional(),
  date: z.string().optional(),
  paymentMode: z.string().optional(),
  customPaymentMode: z.string().optional(),
  account: z.string().optional(),
  customAccount: z.string().optional(),
  vendor: z.string().optional(),
  invoiceProof: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = expenseActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;
  const db = getDb();

  try {
    // ──────────────────────── ACTION: ADD CUSTOM EXPENSE CATEGORY ────────────────────────
    if (data.action === "ADD_CATEGORY") {
      const catName = data.customCategoryName?.trim();
      if (!catName) {
        return NextResponse.json({ error: "Category name is required" }, { status: 400 });
      }
      const icon = data.customCategoryIcon?.trim() || "⚡";
      const createdCat = await saveCustomCategory(catName, icon);
      return NextResponse.json({ success: true, category: createdCat });
    }

    // ──────────────────────── ACTION: DELETE CUSTOM CATEGORY ────────────────────────
    if (data.action === "DELETE_CATEGORY") {
      const key = data.categoryKey?.trim();
      if (!key) return NextResponse.json({ error: "categoryKey required" }, { status: 400 });
      const customCats = await getCustomCategories();
      const updated = customCats.filter((c) => c.key !== key);
      await setSetting("CUSTOM_EXPENSE_TYPES", JSON.stringify(updated));
      return NextResponse.json({ success: true, categories: [...DEFAULT_CATEGORIES, ...updated] });
    }

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

    let finalCategoryKey = data.category;
    let isCustomCategory = false;

    // Check if custom category name was specified
    if (data.customCategoryName && data.customCategoryName.trim()) {
      const icon = data.customCategoryIcon?.trim() || "⚡";
      const customCat = await saveCustomCategory(data.customCategoryName.trim(), icon);
      finalCategoryKey = customCat.key;
      isCustomCategory = true;
    } else {
      const customCats = await getCustomCategories();
      if (customCats.some((c) => c.key === data.category)) {
        isCustomCategory = true;
      }
    }

    // Save custom payment mode if provided
    if (data.customPaymentMode && data.customPaymentMode.trim()) {
      await saveCustomPaymentMode(data.customPaymentMode.trim());
    }

    // Save custom account if provided
    if (data.customAccount && data.customAccount.trim()) {
      await saveCustomBankAccount(data.customAccount.trim());
    }

    // Map UI category to Prisma Enum safely
    let prismaCategory: "RENT" | "ELECTRICITY" | "SALARY" | "TRANSPORT" | "PACKAGING" | "MARKETING" | "SOFTWARE" | "MAINTENANCE" | "MISCELLANEOUS" = "MISCELLANEOUS";
    if (finalCategoryKey === "RENT") prismaCategory = "RENT";
    else if (finalCategoryKey === "ELECTRICITY") prismaCategory = "ELECTRICITY";
    else if (finalCategoryKey === "SALARY") prismaCategory = "SALARY";
    else if (finalCategoryKey === "TRANSPORT" || finalCategoryKey === "DELIVERY") prismaCategory = "TRANSPORT";
    else if (finalCategoryKey === "PACKAGING") prismaCategory = "PACKAGING";
    else if (finalCategoryKey === "MARKETING") prismaCategory = "MARKETING";
    else if (finalCategoryKey === "SOFTWARE") prismaCategory = "SOFTWARE";
    else if (finalCategoryKey === "REPAIRS") prismaCategory = "MAINTENANCE";
    else prismaCategory = "MISCELLANEOUS";

    // Resolve Payment Mode and Custom Mode
    const rawMode = data.paymentMode || "BANK_TRANSFER";
    const customModeStr = data.customPaymentMode?.trim();
    let finalPaymentModeStr = customModeStr || rawMode;
    let prismaPaymentMode: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" = "BANK_TRANSFER";
    if (rawMode === "CASH") prismaPaymentMode = "CASH";
    else if (rawMode === "UPI") prismaPaymentMode = "UPI";
    else if (rawMode === "CHEQUE") prismaPaymentMode = "CHEQUE";
    else prismaPaymentMode = "BANK_TRANSFER";

    // Resolve Account and Custom Account
    const rawAccount = data.account?.trim() || "";
    const customAccStr = data.customAccount?.trim();
    const finalAccountStr = customAccStr || rawAccount || (prismaPaymentMode === "CASH" ? "Cash Drawer" : "Operating Bank Account");

    const vendorStr = data.vendor?.trim() || "General Vendor";
    const invoiceProofStr = data.invoiceProof?.trim() || "—";
    const notesStr = data.notes?.trim() || `${finalCategoryKey} expense`;

    // Composite description for rich storage with all custom attributes
    const tags: string[] = [];
    if (isCustomCategory) tags.push(`Category: ${finalCategoryKey}`);
    if (customModeStr) tags.push(`Mode: ${customModeStr}`);
    tags.push(`Vendor: ${vendorStr}`);
    tags.push(`Invoice: ${invoiceProofStr}`);
    tags.push(`Account: ${finalAccountStr}`);
    tags.push(`Notes: ${notesStr}`);

    const compositeDescription = tags.join(" | ");

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
        paymentMode: prismaPaymentMode,
        description: compositeDescription,
        attachmentKey: data.invoiceProof || undefined,
        createdByUserId: session.sub,
        approvedByUserId,
      },
    });

    // If Bank Transfer / UPI / Cheque, create a BankTransaction entry so Bank Management tracks the debit!
    if (prismaPaymentMode === "BANK_TRANSFER" || prismaPaymentMode === "UPI" || prismaPaymentMode === "CHEQUE") {
      await db.bankTransaction.create({
        data: {
          warehouseId: resolvedWarehouseId,
          businessDate: new Date(data.date),
          type: "EXPENSE_PAYOUT",
          amount: amt,
          isCredit: false, // Outflow
          bankName: finalAccountStr,
          utrReference: data.invoiceProof || null,
          partyName: vendorStr,
          notes: `Expense [${finalCategoryKey} (${finalPaymentModeStr})]: ${notesStr}`,
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
        category: finalCategoryKey,
        vendor: vendorStr,
        account: finalAccountStr,
        paymentMode: finalPaymentModeStr,
        isApproved: isAutoApproved,
      },
    });

    return NextResponse.json({ success: true, expense, isApproved: isAutoApproved, category: finalCategoryKey });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save expense" }, { status: 500 });
  }
}
