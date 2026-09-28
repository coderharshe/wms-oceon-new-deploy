import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const where: any = {};
    if (warehouseId && warehouseId !== "all") where.warehouseId = warehouseId;

    // Fetch all purchase bills
    const bills = await db.purchaseBill.findMany({
      where,
      include: {
        supplier: true,
        warehouse: { select: { name: true, code: true } },
        purchaseOrder: { select: { poNumber: true, creditDays: true } },
      },
      orderBy: { billDate: "desc" },
    });

    // Fetch payment vouchers for suppliers to compute exact paid breakdown per bill/supplier
    const paymentVouchers = await db.voucher.findMany({
      where: {
        type: "PAYMENT_VOUCHER",
        partyType: "SUPPLIER",
      },
    });

    // Map vouchers to bills based on referenceNo matching supplierBillNo or grnNumber
    const voucherBillMap = new Map<string, typeof paymentVouchers>();
    for (const v of paymentVouchers) {
      if (v.referenceNo) {
        const ref = v.referenceNo.trim().toLowerCase();
        if (!voucherBillMap.has(ref)) voucherBillMap.set(ref, []);
        voucherBillMap.get(ref)!.push(v);
      }
    }

    const now = new Date().getTime();
    let totalPurchases = 0;
    let totalPaidAll = 0;
    let totalPayables = 0;

    const ageing = {
      notDue: 0,
      overdue0_15: 0,
      overdue16_30: 0,
      overdue30Plus: 0,
    };

    const payablesList = bills.map((b) => {
      const billTotal = Number(b.total);
      totalPurchases += billTotal;

      // Match payment vouchers
      const billKey = b.supplierBillNo.trim().toLowerCase();
      const grnKey = b.grnNumber.trim().toLowerCase();
      const idKey = b.id.trim().toLowerCase();

      const matchedVouchers = [
        ...(voucherBillMap.get(billKey) || []),
        ...(voucherBillMap.get(grnKey) || []),
        ...(voucherBillMap.get(idKey) || []),
      ];

      // Remove duplicate vouchers if matched by multiple keys
      const uniqueVouchers = Array.from(new Map(matchedVouchers.map((v) => [v.id, v])).values());

      let paidBank = 0;
      let paidUpi = 0;
      let paidCheque = 0;
      let paidCash = 0;
      let paidOthers = 0;

      for (const v of uniqueVouchers) {
        const amt = Number(v.amount);
        if (v.paymentMode === "BANK_TRANSFER") paidBank += amt;
        else if (v.paymentMode === "UPI") paidUpi += amt;
        else if (v.paymentMode === "CHEQUE") paidCheque += amt;
        else if (v.paymentMode === "CASH") paidCash += amt;
        else paidOthers += amt;
      }

      // If bill is marked PAID but no voucher exists, count billTotal as paidBank default
      let totalPaid = paidBank + paidUpi + paidCheque + paidCash + paidOthers;
      if (b.paymentStatus === "PAID" && totalPaid === 0) {
        totalPaid = billTotal;
        paidBank = billTotal;
      }

      const balanceDue = Math.max(0, billTotal - totalPaid);
      totalPaidAll += totalPaid;
      totalPayables += balanceDue;

      // Credit days & Due Date
      const creditDays = b.purchaseOrder?.creditDays || b.supplier.creditDays || 30;
      const billTime = new Date(b.billDate).getTime();
      const dueTime = b.dueDate ? new Date(b.dueDate).getTime() : billTime + creditDays * 24 * 60 * 60 * 1000;
      const dueDateStr = new Date(dueTime).toISOString().slice(0, 10);
      const overdueDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));

      if (balanceDue > 0) {
        if (overdueDays <= 0) ageing.notDue += balanceDue;
        else if (overdueDays <= 15) ageing.overdue0_15 += balanceDue;
        else if (overdueDays <= 30) ageing.overdue16_30 += balanceDue;
        else ageing.overdue30Plus += balanceDue;
      }

      return {
        id: b.id,
        supplierId: b.supplierId,
        supplierName: b.supplier.name,
        contactPerson: b.supplier.contactPerson,
        phone: b.supplier.phone,
        email: b.supplier.email,
        gstin: b.supplier.gstin,
        bankDetails: b.supplier.bankDetails,
        paymentTerms: b.supplier.paymentTerms,
        supplierBillNo: b.supplierBillNo,
        grnNumber: b.grnNumber,
        poNumber: b.purchaseOrder?.poNumber || null,
        billDate: new Date(b.billDate).toISOString().slice(0, 10),
        dueDate: dueDateStr,
        creditDays,
        purchaseAmount: billTotal,
        subtotal: Number(b.subtotal),
        gstAmount: Number(b.gstAmount),
        otherCharges: Number(b.otherCharges),
        amountPaid: totalPaid,
        balanceDue,
        overdueDays: Math.max(0, overdueDays),
        isOverdue: overdueDays > 0 && balanceDue > 0,
        paymentStatus: b.paymentStatus,
        tenderBreakdown: {
          bank: paidBank,
          upi: paidUpi,
          cheque: paidCheque,
          cash: paidCash,
          others: paidOthers,
        },
        warehouse: b.warehouse.name,
      };
    });

    // Supplier-wise aggregation
    const supplierGroupMap = new Map<string, {
      supplierId: string;
      supplierName: string;
      contactPerson: string | null;
      phone: string | null;
      email: string | null;
      gstin: string | null;
      bankDetails: string | null;
      creditDays: number;
      creditLimit: number | null;
      totalPurchases: number;
      totalPaid: number;
      totalOutstanding: number;
      invoiceCount: number;
      overdueCount: number;
      oldestOverdueDays: number;
      tenderBreakdown: {
        bank: number;
        upi: number;
        cheque: number;
        cash: number;
        others: number;
      };
      bills: typeof payablesList;
    }>();

    for (const item of payablesList) {
      if (!supplierGroupMap.has(item.supplierId)) {
        supplierGroupMap.set(item.supplierId, {
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          contactPerson: item.contactPerson,
          phone: item.phone,
          email: item.email,
          gstin: item.gstin,
          bankDetails: item.bankDetails,
          creditDays: item.creditDays,
          creditLimit: null,
          totalPurchases: 0,
          totalPaid: 0,
          totalOutstanding: 0,
          invoiceCount: 0,
          overdueCount: 0,
          oldestOverdueDays: 0,
          tenderBreakdown: { bank: 0, upi: 0, cheque: 0, cash: 0, others: 0 },
          bills: [],
        });
      }

      const s = supplierGroupMap.get(item.supplierId)!;
      s.totalPurchases += item.purchaseAmount;
      s.totalPaid += item.amountPaid;
      s.totalOutstanding += item.balanceDue;
      s.invoiceCount += 1;
      if (item.isOverdue) s.overdueCount += 1;
      s.oldestOverdueDays = Math.max(s.oldestOverdueDays, item.overdueDays);
      s.tenderBreakdown.bank += item.tenderBreakdown.bank;
      s.tenderBreakdown.upi += item.tenderBreakdown.upi;
      s.tenderBreakdown.cheque += item.tenderBreakdown.cheque;
      s.tenderBreakdown.cash += item.tenderBreakdown.cash;
      s.tenderBreakdown.others += item.tenderBreakdown.others;
      s.bills.push(item);
    }

    const supplierSummary = Array.from(supplierGroupMap.values()).sort(
      (a, b) => b.totalOutstanding - a.totalOutstanding
    );

    return NextResponse.json({
      totalPayables,
      totalPurchases,
      totalPaid: totalPaidAll,
      ageing,
      payablesList,
      supplierSummary,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load accounts payable" }, { status: 500 });
  }
}

// Supplier Payout Collection Endpoint
const paySupplierSchema = z.object({
  purchaseBillId: z.string(),
  supplierId: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["BANK_TRANSFER", "UPI", "CHEQUE", "CASH"]),
  bankName: z.string().optional(),
  referenceNo: z.string().optional(),
  chequeNumber: z.string().optional(),
  chequeBank: z.string().optional(),
  chequeDueDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const parsed = paySupplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { purchaseBillId, supplierId, amount, paymentMethod, bankName, referenceNo, chequeNumber, chequeBank, chequeDueDate, notes } = parsed.data;

  try {
    const bill = await db.purchaseBill.findUnique({
      where: { id: purchaseBillId },
      include: { supplier: true },
    });

    if (!bill) {
      return NextResponse.json({ error: "Purchase Bill not found" }, { status: 404 });
    }

    // 1. Create Payment Voucher
    const voucher = await db.voucher.create({
      data: {
        voucherNo: `VOU-PAY-${Date.now().toString().slice(-6)}`,
        warehouseId: bill.warehouseId,
        type: "PAYMENT_VOUCHER",
        date: new Date(),
        partyName: bill.supplier.name,
        partyType: "SUPPLIER",
        amount,
        paymentMode: paymentMethod as any,
        referenceNo: bill.supplierBillNo,
        notes: notes || `Supplier payment for bill ${bill.supplierBillNo} (${bill.supplier.name})`,
        status: "APPROVED",
        createdByUserId: session.sub,
      },
    });

    // 2. Post Bank Outflow if Bank Transfer or UPI
    if (paymentMethod === "BANK_TRANSFER" || paymentMethod === "UPI") {
      await db.bankTransaction.create({
        data: {
          warehouseId: bill.warehouseId,
          businessDate: new Date(),
          type: "SUPPLIER_PAYMENT",
          amount,
          isCredit: false, // Outflow
          utrReference: referenceNo || null,
          bankName: bankName || (paymentMethod === "UPI" ? "UPI Clearing" : "HDFC Current"),
          partyName: bill.supplier.name,
          notes: `Supplier Payout: ${bill.supplier.name} (Bill ${bill.supplierBillNo})`,
          reconciled: true,
          recordedByUserId: session.sub,
        },
      });
    }

    // 3. Check existing total paid and update bill status
    const existingVouchers = await db.voucher.findMany({
      where: {
        type: "PAYMENT_VOUCHER",
        partyType: "SUPPLIER",
        referenceNo: bill.supplierBillNo,
      },
    });

    const sumPaid = existingVouchers.reduce((s, v) => s + Number(v.amount), 0);
    const billTotal = Number(bill.total);
    const isFullyPaid = sumPaid >= billTotal - 0.05;

    await db.purchaseBill.update({
      where: { id: bill.id },
      data: {
        paymentStatus: isFullyPaid ? "PAID" : "PARTIAL",
      },
    });

    return NextResponse.json({
      success: true,
      voucher,
      totalPaid: sumPaid,
      balanceDue: Math.max(0, billTotal - sumPaid),
      isFullyPaid,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to record supplier payout" }, { status: 500 });
  }
}
