import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const whereWh: any = {};
    if (warehouseId && warehouseId !== "all") whereWh.warehouseId = warehouseId;

    // 1. Pending Supplier Bills (Payables Queue)
    const pendingBills = await db.purchaseBill.findMany({
      where: {
        ...whereWh,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      include: {
        supplier: {
          select: { id: true, name: true, phone: true, contactPerson: true, bankDetails: true, creditDays: true },
        },
        warehouse: { select: { name: true, code: true } },
        purchaseOrder: { select: { poNumber: true, creditDays: true } },
      },
      orderBy: { billDate: "asc" },
    });

    // 2. Payment Requests (Vouchers for Suppliers)
    const vouchers = await db.voucher.findMany({
      where: {
        ...whereWh,
        type: "PAYMENT_VOUCHER",
        partyType: "SUPPLIER",
      },
      include: {
        warehouse: { select: { name: true, code: true } },
        createdByUser: { select: { name: true, staffId: true, role: true } },
        approvedByUser: { select: { name: true, staffId: true, role: true } },
      },
      orderBy: { date: "desc" },
    });

    // 3. Bank Outflows (Bank Transactions for Supplier Payouts)
    const bankOutflows = await db.bankTransaction.findMany({
      where: {
        ...whereWh,
        type: "SUPPLIER_PAYMENT",
        isCredit: false,
      },
      orderBy: { businessDate: "desc" },
      take: 100,
    });

    // Calculate Lifecycle Metrics
    let totalPayableDemand = 0;
    for (const b of pendingBills) totalPayableDemand += Number(b.total);

    let pendingApprovalCount = 0;
    let pendingApprovalAmount = 0;
    let approvedReadyCount = 0;
    let approvedReadyAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;

    for (const v of vouchers) {
      const amt = Number(v.amount);
      if (v.status === "PENDING_APPROVAL") {
        pendingApprovalCount += 1;
        pendingApprovalAmount += amt;
      } else if (v.status === "APPROVED") {
        approvedReadyCount += 1;
        approvedReadyAmount += amt;
      } else if (v.status === "PAID") {
        paidCount += 1;
        paidAmount += amt;
      }
    }

    const reconciledCount = bankOutflows.filter((t) => t.reconciled).length;
    const unreconciledCount = bankOutflows.filter((t) => !t.reconciled).length;

    return NextResponse.json({
      userRole: session.role,
      userId: session.sub,
      metrics: {
        totalPayableDemand,
        pendingBillsCount: pendingBills.length,
        pendingApprovalCount,
        pendingApprovalAmount,
        approvedReadyCount,
        approvedReadyAmount,
        paidCount,
        paidAmount,
        reconciledCount,
        unreconciledCount,
        thresholds: {
          directLimit: 25000,
          managerLimit: 100000,
        },
      },
      pendingBills: pendingBills.map((b) => ({
        id: b.id,
        supplierId: b.supplierId,
        supplierName: b.supplier.name,
        contactPerson: b.supplier.contactPerson,
        phone: b.supplier.phone,
        bankDetails: b.supplier.bankDetails,
        supplierBillNo: b.supplierBillNo,
        grnNumber: b.grnNumber,
        poNumber: b.purchaseOrder?.poNumber || null,
        billDate: new Date(b.billDate).toISOString().slice(0, 10),
        dueDate: b.dueDate ? new Date(b.dueDate).toISOString().slice(0, 10) : null,
        total: Number(b.total),
        paymentStatus: b.paymentStatus,
        warehouse: b.warehouse.name,
      })),
      paymentRequests: vouchers.map((v) => ({
        id: v.id,
        voucherNo: v.voucherNo,
        date: new Date(v.date).toISOString().slice(0, 10),
        partyName: v.partyName,
        amount: Number(v.amount),
        paymentMode: v.paymentMode,
        referenceNo: v.referenceNo,
        notes: v.notes,
        status: v.status,
        requiresApproval: Number(v.amount) > 25000,
        createdBy: v.createdByUser ? { name: v.createdByUser.name, staffId: v.createdByUser.staffId } : null,
        approvedBy: v.approvedByUser ? { name: v.approvedByUser.name, staffId: v.approvedByUser.staffId } : null,
        warehouse: v.warehouse?.name || "Main Warehouse",
      })),
      bankOutflows: bankOutflows.map((t) => ({
        id: t.id,
        businessDate: new Date(t.businessDate).toISOString().slice(0, 10),
        amount: Number(t.amount),
        bankName: t.bankName || "HDFC Bank",
        utrReference: t.utrReference,
        partyName: t.partyName,
        notes: t.notes,
        reconciled: t.reconciled,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load supplier payments data" }, { status: 500 });
  }
}

// POST Handler for Complete Supplier Payment Lifecycle Actions
const requestSchema = z.object({
  action: z.enum(["CREATE_REQUEST", "APPROVE_REQUEST", "REJECT_REQUEST", "EXECUTE_PAYMENT", "RECONCILE_PAYMENT"]),
  // CREATE_REQUEST fields
  supplierName: z.string().optional(),
  supplierBillNo: z.string().optional(),
  purchaseBillId: z.string().optional(),
  warehouseId: z.string().optional(),
  amount: z.number().positive().optional(),
  proposedMethod: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  notes: z.string().optional(),
  // APPROVE / REJECT fields
  voucherId: z.string().optional(),
  approvalNotes: z.string().optional(),
  reason: z.string().optional(),
  // EXECUTE_PAYMENT fields
  paymentMethod: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
  bankName: z.string().optional(),
  referenceNo: z.string().optional(),
  chequeNumber: z.string().optional(),
  chequeBank: z.string().optional(),
  chequeDueDate: z.string().optional(),
  // RECONCILE fields
  bankTransactionId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;

  try {
    // ──────────────────────── 1. CREATE PAYMENT REQUEST ────────────────────────
    if (data.action === "CREATE_REQUEST") {
      if (!data.supplierName || !data.amount) {
        return NextResponse.json({ error: "Supplier name and amount are required" }, { status: 400 });
      }

      const amt = data.amount;
      const targetWarehouseId = data.warehouseId || session.warehouseId || "none";

      // Date & sequence for Voucher
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const count = await db.voucher.count();
      const voucherNo = `PAY-REQ-${dateStr}-${String(count + 1).padStart(4, "0")}`;

      // Approval Matrix:
      // If amount > 25,000 and user is FINANCE -> PENDING_APPROVAL
      // If user is ADMIN or MANAGER -> Auto APPROVED
      // If amount <= 25,000 -> Auto APPROVED
      let status: "APPROVED" | "PENDING_APPROVAL" = "APPROVED";
      let approvedByUserId: string | null = null;

      if (amt > 25000) {
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
          warehouseId: targetWarehouseId !== "none" ? targetWarehouseId : (await db.warehouse.findFirst())?.id || "",
          type: "PAYMENT_VOUCHER",
          date: new Date(),
          partyName: data.supplierName,
          partyType: "SUPPLIER",
          amount: amt,
          paymentMode: (data.proposedMethod as any) || "BANK_TRANSFER",
          referenceNo: data.supplierBillNo || undefined,
          notes: data.notes || `Payment request for ${data.supplierName} (${data.supplierBillNo || "Bill"})`,
          status,
          createdByUserId: session.sub,
          approvedByUserId,
        },
      });

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: voucher.warehouseId,
        action: "SUPPLIER_PAYMENT_REQUEST_CREATED",
        entityType: "Voucher",
        entityId: voucher.id,
        newValue: { voucherNo, amount: amt, status, supplier: data.supplierName },
      });

      return NextResponse.json({ success: true, voucher, status });
    }

    // ──────────────────────── 2. APPROVE REQUEST ────────────────────────
    if (data.action === "APPROVE_REQUEST") {
      if (!data.voucherId) return NextResponse.json({ error: "voucherId required" }, { status: 400 });
      if (session.role !== "ADMIN" && session.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Manager or Admin can approve large supplier payouts" }, { status: 403 });
      }

      const voucher = await db.voucher.update({
        where: { id: data.voucherId },
        data: {
          status: "APPROVED",
          approvedByUserId: session.sub,
          notes: data.approvalNotes ? `${data.approvalNotes}` : undefined,
        },
      });

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: voucher.warehouseId,
        action: "SUPPLIER_PAYMENT_REQUEST_APPROVED",
        entityType: "Voucher",
        entityId: voucher.id,
        newValue: { voucherNo: voucher.voucherNo, amount: voucher.amount, status: "APPROVED" },
      });

      return NextResponse.json({ success: true, voucher });
    }

    // ──────────────────────── 3. REJECT REQUEST ────────────────────────
    if (data.action === "REJECT_REQUEST") {
      if (!data.voucherId) return NextResponse.json({ error: "voucherId required" }, { status: 400 });
      if (session.role !== "ADMIN" && session.role !== "MANAGER") {
        return NextResponse.json({ error: "Only Manager or Admin can reject payment requests" }, { status: 403 });
      }

      const voucher = await db.voucher.update({
        where: { id: data.voucherId },
        data: {
          status: "CANCELLED",
          notes: data.reason ? `Rejected: ${data.reason}` : "Payment request rejected by manager",
        },
      });

      return NextResponse.json({ success: true, voucher });
    }

    // ──────────────────────── 4. EXECUTE PAYMENT ────────────────────────
    if (data.action === "EXECUTE_PAYMENT") {
      if (!data.voucherId) return NextResponse.json({ error: "voucherId required" }, { status: 400 });

      const voucher = await db.voucher.findUnique({
        where: { id: data.voucherId },
      });

      if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
      if (voucher.status === "PENDING_APPROVAL") {
        return NextResponse.json({ error: "Cannot execute payment: Approval is still pending" }, { status: 400 });
      }

      const method = data.paymentMethod || voucher.paymentMode;
      const amount = Number(voucher.amount);
      const refNo = data.referenceNo || data.chequeNumber || voucher.referenceNo || `TX-${Date.now()}`;

      // Update Voucher to PAID
      await db.voucher.update({
        where: { id: voucher.id },
        data: {
          status: "PAID",
          paymentMode: method,
          referenceNo: refNo,
          notes: data.notes || voucher.notes,
        },
      });

      // Record BankTransaction Outflow if Bank/UPI/Cheque
      let bankTx = null;
      if (method === "BANK_TRANSFER" || method === "UPI" || method === "CHEQUE") {
        bankTx = await db.bankTransaction.create({
          data: {
            warehouseId: voucher.warehouseId,
            businessDate: new Date(),
            type: "SUPPLIER_PAYMENT",
            amount,
            isCredit: false, // Outflow
            bankName: data.bankName || (method === "UPI" ? "UPI Clearing" : "HDFC Current"),
            utrReference: data.referenceNo || data.chequeNumber || null,
            partyName: voucher.partyName,
            notes: `Supplier Payout: ${voucher.partyName} (Voucher ${voucher.voucherNo})`,
            reconciled: false, // Awaits bank statement reconciliation
            recordedByUserId: session.sub,
          },
        });
      }

      // If supplierBillNo exists, check and update PurchaseBill payment status
      if (voucher.referenceNo) {
        const bill = await db.purchaseBill.findFirst({
          where: {
            OR: [
              { supplierBillNo: voucher.referenceNo },
              { grnNumber: voucher.referenceNo },
            ],
          },
        });

        if (bill) {
          const totalBill = Number(bill.total);
          // Check other paid vouchers
          const paidVouchers = await db.voucher.findMany({
            where: {
              partyType: "SUPPLIER",
              referenceNo: voucher.referenceNo,
              status: "PAID",
            },
          });
          const totalPaid = paidVouchers.reduce((s, v) => s + Number(v.amount), 0);
          await db.purchaseBill.update({
            where: { id: bill.id },
            data: {
              paymentStatus: totalPaid >= totalBill - 0.05 ? "PAID" : "PARTIAL",
            },
          });
        }
      }

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: voucher.warehouseId,
        action: "SUPPLIER_PAYMENT_EXECUTED",
        entityType: "Voucher",
        entityId: voucher.id,
        newValue: { voucherNo: voucher.voucherNo, amount, method, refNo, bankTxId: bankTx?.id },
      });

      return NextResponse.json({ success: true, voucherNo: voucher.voucherNo, status: "PAID", bankTx });
    }

    // ──────────────────────── 5. RECONCILE PAYMENT ────────────────────────
    if (data.action === "RECONCILE_PAYMENT") {
      if (!data.bankTransactionId) return NextResponse.json({ error: "bankTransactionId required" }, { status: 400 });

      const tx = await db.bankTransaction.update({
        where: { id: data.bankTransactionId },
        data: { reconciled: true },
      });

      return NextResponse.json({ success: true, transaction: tx });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process supplier payment action" }, { status: 500 });
  }
}
