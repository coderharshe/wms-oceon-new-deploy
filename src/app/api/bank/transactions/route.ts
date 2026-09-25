import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";

const createBankTxSchema = z.object({
  warehouseId: z.string().optional(),
  businessDate: z.string().optional(),
  type: z.enum([
    "DIRECT_DEPOSIT",
    "CUSTOMER_TRANSFER",
    "UPI_COLLECTION",
    "CHEQUE_CLEARANCE",
    "SUPPLIER_PAYMENT",
    "EXPENSE_PAYOUT",
    "BANK_CHARGES",
    "ADJUSTMENT",
  ]).default("ADJUSTMENT"),
  amount: z.number().positive(),
  isCredit: z.boolean().optional(), // Inflow (+) vs Outflow (-)
  utrReference: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  partyName: z.string().optional(),
  notes: z.string().optional(),
  reconciled: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const url = new URL(req.url);
  const warehouseId = session.role === "ADMIN" ? url.searchParams.get("warehouseId") || session.warehouseId : session.warehouseId;
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const type = url.searchParams.get("type");

  if (!warehouseId) {
    return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  }
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  const db = (await import("@/lib/db")).getDb();

  const where: any = { warehouseId };
  if (type) where.type = type;
  if (since || until) {
    where.businessDate = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lte: new Date(until) } : {}),
    };
  }

  const transactions = await db.bankTransaction.findMany({
    where,
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  // Calculate summary totals
  let totalCredits = new Decimal(0);
  let totalDebits = new Decimal(0);
  for (const t of transactions) {
    if (t.isCredit) totalCredits = totalCredits.add(t.amount);
    else totalDebits = totalDebits.add(t.amount);
  }

  return NextResponse.json({
    warehouseId,
    transactions,
    summary: {
      totalCredits: totalCredits.toString(),
      totalDebits: totalDebits.toString(),
      netMovement: totalCredits.sub(totalDebits).toString(),
      count: transactions.length,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = createBankTxSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const warehouseId = session.role === "ADMIN" ? input.warehouseId || session.warehouseId : session.warehouseId;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  const db = (await import("@/lib/db")).getDb();

  // Determine default isCredit if not explicitly set
  const defaultCreditTypes = ["DIRECT_DEPOSIT", "CUSTOMER_TRANSFER", "UPI_COLLECTION", "CHEQUE_CLEARANCE"];
  const isCredit = input.isCredit !== undefined ? input.isCredit : defaultCreditTypes.includes(input.type);

  const tx = await db.bankTransaction.create({
    data: {
      warehouseId,
      businessDate: input.businessDate ? new Date(input.businessDate) : new Date(),
      type: input.type,
      amount: new Decimal(input.amount),
      isCredit,
      utrReference: input.utrReference?.trim() || null,
      bankName: input.bankName?.trim() || null,
      accountNumber: input.accountNumber?.trim() || null,
      partyName: input.partyName?.trim() || null,
      notes: input.notes?.trim() || null,
      reconciled: input.reconciled !== undefined ? input.reconciled : true,
      recordedByUserId: session.sub,
    },
  });

  return NextResponse.json({ ok: true, transaction: tx });
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const body = await req.json().catch(() => ({}));
  const { id, reconciled, notes, utrReference } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = (await import("@/lib/db")).getDb();
  const existing = await db.bankTransaction.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const forbidden = assertWarehouseAccess(session, existing.warehouseId);
  if (forbidden) return forbidden;

  const updated = await db.bankTransaction.update({
    where: { id },
    data: {
      ...(reconciled !== undefined ? { reconciled: Boolean(reconciled) } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
      ...(utrReference !== undefined ? { utrReference: utrReference ? String(utrReference).trim() : null } : {}),
    },
  });

  return NextResponse.json({ ok: true, transaction: updated });
}
