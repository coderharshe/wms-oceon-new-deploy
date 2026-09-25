import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;
  const type = req.nextUrl.searchParams.get("type") ?? undefined;

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (type) where.type = type as any;

    const vouchers = await db.voucher.findMany({
      where,
      include: {
        warehouse: { select: { name: true, code: true } },
        createdByUser: { select: { name: true, staffId: true } },
        approvedByUser: { select: { name: true, staffId: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    });

    return NextResponse.json(vouchers);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load vouchers" }, { status: 500 });
  }
}

const voucherSchema = z.object({
  warehouseId: z.string().optional(),
  type: z.enum(["RECEIPT_VOUCHER", "PAYMENT_VOUCHER"]),
  date: z.string().min(1),
  partyName: z.string().min(2, "Party name is required"),
  partyType: z.enum(["CUSTOMER", "SUPPLIER", "OTHER"]).default("CUSTOMER"),
  amount: z.number().positive(),
  paymentMode: z.enum(["CASH", "UPI"]).default("CASH"),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = voucherSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const warehouseId = session.role === "ADMIN" ? parsed.data.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });

  const db = getDb();

  try {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await db.voucher.count();
    const prefix = parsed.data.type === "RECEIPT_VOUCHER" ? "RCV" : "PAY";
    const voucherNo = `${prefix}-${dateStr}-${String(count + 1).padStart(4, "0")}`;

    const amt = parsed.data.amount;
    let status: "APPROVED" | "PENDING_APPROVAL" = "APPROVED";
    let approvedByUserId: string | null = null;

    // Voucher Tiered Approval Limits:
    // ₹0 - ₹5,000: Direct Finance approval
    // ₹5,001 - ₹25,000: Requires Manager / Admin
    // ₹25,000+: Requires Sir / Admin
    if (amt > 25000) {
      if (session.role === "ADMIN") {
        status = "APPROVED";
        approvedByUserId = session.sub;
      } else {
        status = "PENDING_APPROVAL";
      }
    } else if (amt > 5000) {
      if (session.role === "ADMIN" || session.role === "MANAGER") {
        status = "APPROVED";
        approvedByUserId = session.sub;
      } else {
        status = "PENDING_APPROVAL";
      }
    } else {
      status = "APPROVED";
      approvedByUserId = session.sub;
    }

    const voucher = await db.voucher.create({
      data: {
        voucherNo,
        warehouseId,
        type: parsed.data.type,
        date: new Date(parsed.data.date),
        partyName: parsed.data.partyName,
        partyType: parsed.data.partyType,
        amount: parsed.data.amount,
        paymentMode: parsed.data.paymentMode,
        referenceNo: parsed.data.referenceNo,
        notes: parsed.data.notes,
        status,
        createdByUserId: session.sub,
        approvedByUserId,
      },
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      warehouseId,
      action: `VOUCHER_${parsed.data.type}_CREATED`,
      entityType: "Voucher",
      entityId: voucher.id,
      newValue: { voucherNo: voucher.voucherNo, amount: voucher.amount, status: voucher.status, party: voucher.partyName },
    });

    return NextResponse.json({ success: true, voucher });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create voucher" }, { status: 500 });
  }
}
