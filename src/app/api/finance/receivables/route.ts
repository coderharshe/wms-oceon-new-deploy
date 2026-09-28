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

    // Fetch unpaid or partially paid orders
    const unpaidOrders = await db.order.findMany({
      where: {
        ...where,
        status: { in: ["BILLED", "PAYMENT_PENDING", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER", "COMPLETED"] },
        bill: {
          paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PENDING", "PAYMENT_ADJUSTMENT_REQUIRED"] },
        },
      },
      include: {
        customer: true,
        warehouse: { select: { name: true, code: true } },
        bill: {
          include: {
            payment: {
              include: {
                transactions: true,
              },
            },
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date().getTime();
    let totalReceivables = 0;
    const ageing = {
      bucket0_7: 0,
      bucket8_15: 0,
      bucket16_30: 0,
      bucket31_60: 0,
      bucket60Plus: 0,
    };

    // Calculate customer overall outstanding for credit exposure
    const customerDebtMap = new Map<string, number>();
    for (const ord of unpaidOrders) {
      const billVersion = ord.bill?.versions[0];
      const billTotal = billVersion ? Number(billVersion.total) : 0;
      const amountPaid = ord.bill?.payment ? Number(ord.bill.payment.amountPaid) : 0;
      const bal = Math.max(0, billTotal - amountPaid);
      customerDebtMap.set(ord.customerId, (customerDebtMap.get(ord.customerId) || 0) + bal);
    }

    const receivablesList = unpaidOrders.map((ord) => {
      const billVersion = ord.bill?.versions[0];
      const billTotal = billVersion ? Number(billVersion.total) : 0;
      const payment = ord.bill?.payment;
      const amountPaid = payment ? Number(payment.amountPaid) : 0;
      const balanceDue = Math.max(0, billTotal - amountPaid);

      totalReceivables += balanceDue;

      const invoiceDate = ord.createdAt;
      const billAgeDays = Math.floor((now - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24));

      // Credit terms: standard 15 days credit if not specified
      const creditDays = 15;
      const dueDate = new Date(new Date(invoiceDate).getTime() + creditDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const daysOverdue = Math.max(0, billAgeDays - creditDays);

      if (billAgeDays <= 7) ageing.bucket0_7 += balanceDue;
      else if (billAgeDays <= 15) ageing.bucket8_15 += balanceDue;
      else if (billAgeDays <= 30) ageing.bucket16_30 += balanceDue;
      else if (billAgeDays <= 60) ageing.bucket31_60 += balanceDue;
      else ageing.bucket60Plus += balanceDue;

      // Payment tender breakdown
      const txs = payment?.transactions || [];
      let paidCash = 0;
      let paidBank = 0;
      let paidCheque = 0;
      let paidUpi = 0;

      for (const t of txs) {
        if (t.status === "CONFIRMED") {
          const amt = Number(t.amount);
          if (t.method === "CASH") paidCash += amt;
          else if (t.method === "BANK_TRANSFER") paidBank += amt;
          else if (t.method === "CHEQUE") paidCheque += amt;
          else if (t.method === "UPI") paidUpi += amt;
        }
      }

      const creditLimit = ord.customer.creditLimit ? Number(ord.customer.creditLimit) : null;
      const totalCustomerDebt = customerDebtMap.get(ord.customerId) || balanceDue;
      const creditUsedPercent = creditLimit && creditLimit > 0 ? (totalCustomerDebt / creditLimit) * 100 : null;

      return {
        id: ord.id,
        orderNumber: ord.orderNumber,
        billId: ord.bill?.id,
        billNumber: ord.bill?.billNumber,
        customerId: ord.customerId,
        retailerName: ord.customer.shopName,
        ownerName: ord.customer.ownerName,
        mobile: ord.customer.mobile,
        gstin: ord.customer.gstin,
        invoiceDate: new Date(invoiceDate).toISOString().split("T")[0],
        dueDate,
        billTotal,
        amountPaid,
        balanceDue,
        ageDays: billAgeDays,
        daysOverdue,
        creditLimit,
        totalCustomerDebt,
        creditUsedPercent,
        tenderBreakdown: {
          cash: paidCash,
          bank: paidBank,
          cheque: paidCheque,
          upi: paidUpi,
        },
        warehouse: ord.warehouse.name,
      };
    });

    // Aggregate retailer-wise summary
    const retailerGroupMap = new Map<string, {
      customerId: string;
      retailerName: string;
      ownerName: string | null;
      mobile: string | null;
      gstin: string | null;
      creditLimit: number | null;
      totalBilled: number;
      totalPaid: number;
      totalOutstanding: number;
      invoiceCount: number;
      oldestInvoiceDays: number;
      invoices: any[];
    }>();

    for (const r of receivablesList) {
      if (!retailerGroupMap.has(r.customerId)) {
        retailerGroupMap.set(r.customerId, {
          customerId: r.customerId,
          retailerName: r.retailerName,
          ownerName: r.ownerName,
          mobile: r.mobile,
          gstin: r.gstin,
          creditLimit: r.creditLimit,
          totalBilled: 0,
          totalPaid: 0,
          totalOutstanding: 0,
          invoiceCount: 0,
          oldestInvoiceDays: 0,
          invoices: [],
        });
      }
      const grp = retailerGroupMap.get(r.customerId)!;
      grp.totalBilled += r.billTotal;
      grp.totalPaid += r.amountPaid;
      grp.totalOutstanding += r.balanceDue;
      grp.invoiceCount += 1;
      grp.oldestInvoiceDays = Math.max(grp.oldestInvoiceDays, r.ageDays);
      grp.invoices.push(r);
    }

    const retailerSummary = Array.from(retailerGroupMap.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    return NextResponse.json({
      totalReceivables,
      ageing,
      receivablesList,
      retailerSummary,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load receivables" }, { status: 500 });
  }
}

// Quick Payment Collection POST endpoint
const collectPaymentSchema = z.object({
  orderId: z.string(),
  billId: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "UPI"]),
  bankAccountId: z.string().optional(),
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
  const parsed = collectPaymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { orderId, amount, paymentMethod, bankName, referenceNo, chequeNumber, chequeBank, chequeDueDate, notes } = parsed.data;

  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        bill: {
          include: {
            payment: true,
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        },
      },
    });

    if (!order || !order.bill) {
      return NextResponse.json({ error: "Order or Bill not found" }, { status: 404 });
    }

    let payment = order.bill.payment;
    const billTotal = order.bill.versions[0] ? Number(order.bill.versions[0].total) : 0;

    if (!payment) {
      payment = await db.payment.create({
        data: {
          billId: order.bill.id,
          amountDue: billTotal,
          amountPaid: 0,
        },
      });
    }

    // 1. Create PaymentTransaction
    const tx = await db.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        type: "PAYMENT",
        method: paymentMethod as any,
        amount,
        upiReference: paymentMethod === "UPI" ? referenceNo : null,
        bankReference: paymentMethod === "BANK_TRANSFER" ? referenceNo : null,
        chequeNumber: paymentMethod === "CHEQUE" ? chequeNumber : null,
        chequeBank: paymentMethod === "CHEQUE" ? chequeBank : null,
        chequeDueDate: chequeDueDate ? new Date(chequeDueDate) : null,
        chequeStatus: paymentMethod === "CHEQUE" ? "PENDING" : null,
        notes: notes || `Collection against Order ${order.orderNumber}`,
        status: "CONFIRMED",
        recordedByUserId: session.sub,
      },
    });

    // 2. Update payment total paid & bill payment status
    const newPaid = Number(payment.amountPaid) + amount;
    const isFullyPaid = newPaid >= billTotal - 0.05;

    await db.payment.update({
      where: { id: payment.id },
      data: {
        amountPaid: newPaid,
      },
    });

    await db.bill.update({
      where: { id: order.bill.id },
      data: {
        paymentStatus: isFullyPaid ? "PAID" : "PARTIALLY_PAID",
      },
    });

    // 3. Post Receipt Voucher
    await db.voucher.create({
      data: {
        voucherNo: `VOU-${Date.now().toString().slice(-6)}`,
        warehouseId: order.warehouseId,
        type: "RECEIPT_VOUCHER",
        date: new Date(),
        partyName: order.customer.shopName,
        partyType: "CUSTOMER",
        amount,
        paymentMode: paymentMethod as any,
        referenceNo: referenceNo || chequeNumber || order.orderNumber,
        notes: `Receipt from ${order.customer.shopName} against ${order.orderNumber}`,
        status: "APPROVED",
        createdByUserId: session.sub,
      },
    });

    // 4. If Bank Transfer / Cheque, post BankTransaction
    if (paymentMethod === "BANK_TRANSFER") {
      await db.bankTransaction.create({
        data: {
          warehouseId: order.warehouseId,
          businessDate: new Date(),
          type: "CUSTOMER_TRANSFER",
          amount,
          isCredit: true,
          utrReference: referenceNo || null,
          bankName: bankName || null,
          partyName: order.customer.shopName,
          notes: `NEFT/RTGS collection from ${order.customer.shopName} (Order ${order.orderNumber})`,
          reconciled: true,
          recordedByUserId: session.sub,
        },
      });
    }

    return NextResponse.json({ success: true, transaction: tx, newPaid, isFullyPaid });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to collect payment" }, { status: 500 });
  }
}
