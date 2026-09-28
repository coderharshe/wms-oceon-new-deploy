import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getSetting } from "@/lib/settings";
import { isGstin, isInterState, stateCodeOfGstin, STATE_CODES } from "@/lib/gst";
import { buildRegister, GST_ISSUED } from "@/lib/gst-register";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(guard)) return guard;

  const prisma = getDb();
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "thisMonth";
  const monthParam = url.searchParams.get("month") || "";
  const warehouseId = guard.role === "ADMIN" ? url.searchParams.get("warehouseId") || undefined : guard.warehouseId || undefined;

  const now = new Date();
  let startDate: Date;
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const parts = monthParam.split("-");
    const y = parseInt(parts[0] ?? "2026", 10);
    const m = parseInt(parts[1] ?? "1", 10) - 1;
    startDate = new Date(y, m, 1, 0, 0, 0, 0);
    endDate = new Date(y, m + 1, 0, 23, 59, 59, 999);
  } else {
    switch (range) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "prevMonth": {
        const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        startDate = new Date(prevM.getFullYear(), prevM.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(prevM.getFullYear(), prevM.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      }
      case "quarter": {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), currentQuarter * 3, 1, 0, 0, 0, 0);
        break;
      }
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
      case "thisMonth":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
    }
  }

  // Fetch Company GSTIN and State
  const [companyGstin, companyLegalName, companyTradeName] = await Promise.all([
    getSetting("GSTIN").catch(() => ""),
    getSetting("COMPANY_NAME").catch(() => "Oceon WMS Enterprise"),
    getSetting("TRADE_NAME").catch(() => "Oceon Wholesale & Distribution"),
  ]);

  const sellerGstin = (companyGstin || "").trim().toUpperCase();
  const sellerStateCode = (isGstin(sellerGstin) ? stateCodeOfGstin(sellerGstin) : null) || "27"; // Default Maharashtra if unset

  // 1. Fetch Outward Supplies (Orders with Final Bills)
  const billedOrders = await prisma.order.findMany({
    where: {
      status: { notIn: ["CANCELLED", "DRAFT"] },
      createdAt: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
          unit: true,
        },
      },
      bill: {
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: {
              items: {
                include: {
                  product: true,
                  unit: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // 2. Fetch Standalone GST Invoices from AuditLog
  const gstInvoiceLogs = await prisma.auditLog.findMany({
    where: {
      action: GST_ISSUED,
      timestamp: { gte: startDate, lte: endDate },
    },
    include: {
      user: {
        select: { id: true, name: true },
      },
    },
    orderBy: { timestamp: "desc" },
  });

  const userMap = new Map<string, string>();
  for (const l of gstInvoiceLogs) {
    if (l.user) userMap.set(l.user.id, l.user.name);
  }
  const gstInvoiceRegister = buildRegister(
    gstInvoiceLogs.map((l: (typeof gstInvoiceLogs)[number]) => ({
      entityId: l.entityId,
      timestamp: l.timestamp,
      newValue: l.newValue,
      userId: l.userId,
      action: l.action,
    })),
    userMap
  );

  // 3. Fetch Inward Procurement (Purchase Bills from Suppliers)
  const purchaseBills = await prisma.purchaseBill.findMany({
    where: {
      billDate: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
          unit: true,
        },
      },
    },
    orderBy: { billDate: "desc" },
  });

  // 4. Fetch Operating Expenses with tax implications
  const expenses = await prisma.expense.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: { date: "desc" },
  });

  // 5. Fetch Credit Notes / Refunds / Adjustments
  const adjustments = await prisma.paymentAdjustment.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      bill: {
        include: {
          order: {
            include: {
              customer: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Calculate Outward Tax Breakdown (B2B vs B2C & Rates) ──
  type B2BInvoiceRow = {
    invoiceNo: string;
    invoiceDate: string;
    customerName: string;
    customerGstin: string;
    placeOfSupply: string;
    isInterState: boolean;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    invoiceTotal: number;
    itemsCount: number;
  };

  type B2CInvoiceRow = {
    invoiceNo: string;
    invoiceDate: string;
    customerName: string;
    sellingMode: string;
    placeOfSupply: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    invoiceTotal: number;
  };

  type RateWiseBreakdown = {
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
  };

  type HsnSummaryRow = {
    hsn: string;
    description: string;
    uqc: string;
    totalQty: number;
    taxRate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
  };

  const b2bInvoices: B2BInvoiceRow[] = [];
  const b2cInvoices: B2CInvoiceRow[] = [];
  const rateMap = new Map<number, RateWiseBreakdown>();
  const hsnMap = new Map<string, HsnSummaryRow>();

  function addRateWise(rate: number, taxable: number, cgst: number, sgst: number, igst: number) {
    const existing = rateMap.get(rate) || { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    existing.taxable += taxable;
    existing.cgst += cgst;
    existing.sgst += sgst;
    existing.igst += igst;
    existing.totalTax += cgst + sgst + igst;
    rateMap.set(rate, existing);
  }

  function addHsn(hsnRaw: string, desc: string, uqc: string, qty: number, taxRate: number, taxable: number, cgst: number, sgst: number, igst: number) {
    const hsn = hsnRaw.trim() || "MISC";
    const key = `${hsn}@${taxRate}`;
    const existing = hsnMap.get(key) || {
      hsn,
      description: desc || "Goods",
      uqc: uqc || "NOS",
      totalQty: 0,
      taxRate,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
    };
    existing.totalQty += qty;
    existing.taxable += taxable;
    existing.cgst += cgst;
    existing.sgst += sgst;
    existing.igst += igst;
    existing.totalTax += cgst + sgst + igst;
    hsnMap.set(key, existing);
  }

  let totalB2bTaxable = 0;
  let totalB2bCgst = 0;
  let totalB2bSgst = 0;
  let totalB2bIgst = 0;

  let totalB2cTaxable = 0;
  let totalB2cCgst = 0;
  let totalB2cSgst = 0;
  let totalB2cIgst = 0;

  // Process Billed Orders
  for (const order of billedOrders) {
    const cust = order.customer;
    const isRegistered = isGstin(cust.gstin);
    const buyerState = cust.gstin ? stateCodeOfGstin(cust.gstin) : sellerStateCode;
    const interState = isInterState(sellerGstin, buyerState);
    const pos = buyerState || sellerStateCode || "27";

    const latestVersion = order.bill?.versions[0];
    const items = latestVersion?.items?.length ? latestVersion.items : order.items;

    let orderTaxable = 0;
    let orderCgst = 0;
    let orderSgst = 0;
    let orderIgst = 0;
    let orderTotal = 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      const taxPct = Number(item.product.taxPercent) || 0;
      const unitPrice = "unitPrice" in item ? Number((item as any).unitPrice) : Number((item as any).rate ?? 0);
      const lineTaxable = Math.round(qty * unitPrice * 100) / 100;
      const lineCgst = interState ? 0 : Math.round((lineTaxable * (taxPct / 2)) / 100 * 100) / 100;
      const lineSgst = interState ? 0 : lineCgst;
      const lineIgst = interState ? Math.round((lineTaxable * taxPct) / 100 * 100) / 100 : 0;
      const lineTotal = lineTaxable + lineCgst + lineSgst + lineIgst;

      orderTaxable += lineTaxable;
      orderCgst += lineCgst;
      orderSgst += lineSgst;
      orderIgst += lineIgst;
      orderTotal += lineTotal;

      addRateWise(taxPct, lineTaxable, lineCgst, lineSgst, lineIgst);
      addHsn(
        item.product.sku,
        item.product.name,
        item.unit.symbol || item.unit.name || "UNT",
        qty,
        taxPct,
        lineTaxable,
        lineCgst,
        lineSgst,
        lineIgst
      );
    }

    if (isRegistered) {
      totalB2bTaxable += orderTaxable;
      totalB2bCgst += orderCgst;
      totalB2bSgst += orderSgst;
      totalB2bIgst += orderIgst;

      b2bInvoices.push({
        invoiceNo: order.bill?.billNumber || order.orderNumber,
        invoiceDate: order.createdAt.toISOString().slice(0, 10),
        customerName: cust.shopName || cust.ownerName || "Registered Customer",
        customerGstin: cust.gstin!.toUpperCase(),
        placeOfSupply: `${pos} - ${STATE_CODES[pos] || "State"}`,
        isInterState: interState,
        taxableValue: Math.round(orderTaxable * 100) / 100,
        cgst: Math.round(orderCgst * 100) / 100,
        sgst: Math.round(orderSgst * 100) / 100,
        igst: Math.round(orderIgst * 100) / 100,
        totalTax: Math.round((orderCgst + orderSgst + orderIgst) * 100) / 100,
        invoiceTotal: Math.round(orderTotal * 100) / 100,
        itemsCount: items.length,
      });
    } else {
      totalB2cTaxable += orderTaxable;
      totalB2cCgst += orderCgst;
      totalB2cSgst += orderSgst;
      totalB2cIgst += orderIgst;

      b2cInvoices.push({
        invoiceNo: order.bill?.billNumber || order.orderNumber,
        invoiceDate: order.createdAt.toISOString().slice(0, 10),
        customerName: cust.shopName || "Walk-in Retail Buyer",
        sellingMode: order.sellingMode,
        placeOfSupply: `${pos} - ${STATE_CODES[pos] || "Local"}`,
        taxableValue: Math.round(orderTaxable * 100) / 100,
        cgst: Math.round(orderCgst * 100) / 100,
        sgst: Math.round(orderSgst * 100) / 100,
        igst: Math.round(orderIgst * 100) / 100,
        totalTax: Math.round((orderCgst + orderSgst + orderIgst) * 100) / 100,
        invoiceTotal: Math.round(orderTotal * 100) / 100,
      });
    }
  }

  // Process Standalone GST Tax Invoices
  for (const reg of gstInvoiceRegister) {
    const isInter = Boolean(reg.interState);
    const pos = reg.placeOfSupply || sellerStateCode || "27";
    const taxable = Number(reg.taxable) || 0;
    const tax = Number(reg.tax) || 0;
    const total = Number(reg.total) || (taxable + tax);
    const cgst = isInter ? 0 : Math.round((tax / 2) * 100) / 100;
    const sgst = isInter ? 0 : cgst;
    const igst = isInter ? tax : 0;

    totalB2bTaxable += taxable;
    totalB2bCgst += cgst;
    totalB2bSgst += sgst;
    totalB2bIgst += igst;

    b2bInvoices.push({
      invoiceNo: reg.invoiceNo,
      invoiceDate: reg.issuedAt.slice(0, 10),
      customerName: reg.customerName || "B2B GST Client",
      customerGstin: "GST-REGISTERED",
      placeOfSupply: `${pos} - ${STATE_CODES[pos] || "State"}`,
      isInterState: isInter,
      taxableValue: taxable,
      cgst,
      sgst,
      igst,
      totalTax: tax,
      invoiceTotal: total,
      itemsCount: reg.items?.length || 1,
    });

    if (Array.isArray(reg.items)) {
      for (const it of reg.items) {
        const itTaxPct = Number(it.taxPercent) || 0;
        const itTaxable = Math.round(Number(it.quantity) * Number(it.rate) * 100) / 100;
        const itCgst = isInter ? 0 : Math.round((itTaxable * (itTaxPct / 2)) / 100 * 100) / 100;
        const itSgst = isInter ? 0 : itCgst;
        const itIgst = isInter ? Math.round((itTaxable * itTaxPct) / 100 * 100) / 100 : 0;

        addRateWise(itTaxPct, itTaxable, itCgst, itSgst, itIgst);
        addHsn(
          it.hsn || it.productId,
          it.name,
          it.unit || "UNT",
          Number(it.quantity),
          itTaxPct,
          itTaxable,
          itCgst,
          itSgst,
          itIgst
        );
      }
    }
  }

  // ── Calculate Inward Procurement & Input Tax Credit (ITC) ──
  type InwardPurchaseRow = {
    grnNumber: string;
    supplierBillNo: string;
    billDate: string;
    supplierName: string;
    supplierGstin: string;
    isRegisteredSupplier: boolean;
    taxableValue: number;
    gstAmount: number;
    otherCharges: number;
    total: number;
    paymentStatus: string;
    itcEligible: boolean;
    cgst: number;
    sgst: number;
    igst: number;
  };

  const inwardPurchases: InwardPurchaseRow[] = [];
  let totalPurchasesTaxable = 0;
  let totalPurchasesCgst = 0;
  let totalPurchasesSgst = 0;
  let totalPurchasesIgst = 0;
  let totalPurchasesGst = 0;
  let eligibleGoodsItc = 0;

  for (const pb of purchaseBills) {
    const isSuppGst = isGstin(pb.supplier.gstin);
    const suppState = pb.supplier.gstin ? stateCodeOfGstin(pb.supplier.gstin) : sellerStateCode;
    const isInter = isInterState(sellerGstin, suppState);

    const taxable = Number(pb.subtotal) || 0;
    const gstAmt = Number(pb.gstAmount) || 0;
    const other = Number(pb.otherCharges) || 0;
    const total = Number(pb.total) || 0;

    const cgst = isInter ? 0 : Math.round((gstAmt / 2) * 100) / 100;
    const sgst = isInter ? 0 : cgst;
    const igst = isInter ? gstAmt : 0;

    totalPurchasesTaxable += taxable;
    totalPurchasesGst += gstAmt;
    totalPurchasesCgst += cgst;
    totalPurchasesSgst += sgst;
    totalPurchasesIgst += igst;

    if (isSuppGst) {
      eligibleGoodsItc += gstAmt;
    }

    inwardPurchases.push({
      grnNumber: pb.grnNumber,
      supplierBillNo: pb.supplierBillNo,
      billDate: pb.billDate.toISOString().slice(0, 10),
      supplierName: pb.supplier.name,
      supplierGstin: pb.supplier.gstin || "UNREGISTERED",
      isRegisteredSupplier: isSuppGst,
      taxableValue: taxable,
      gstAmount: gstAmt,
      otherCharges: other,
      total,
      paymentStatus: pb.paymentStatus,
      itcEligible: isSuppGst,
      cgst,
      sgst,
      igst,
    });
  }

  // Calculate Services/OPEX ITC (Assume 18% GST on eligible invoices like Software, Transport, Marketing if bill attached)
  let opexItcEstimated = 0;
  for (const exp of expenses) {
    if (exp.attachmentKey && ["SOFTWARE", "TRANSPORT", "MARKETING", "PACKAGING"].includes(exp.category)) {
      const expAmt = Number(exp.amount);
      const taxPart = Math.round((expAmt * 18 / 118) * 100) / 100;
      opexItcEstimated += taxPart;
    }
  }

  const totalEligibleItc = Math.round((eligibleGoodsItc + opexItcEstimated) * 100) / 100;

  // ── Calculate Adjustments & Credit Notes ──
  type CreditNoteRow = {
    id: string;
    date: string;
    billNumber: string;
    customerName: string;
    adjustedAmount: number;
    reversalTax: number;
    reason: string;
    resolutionType: string;
  };

  const creditNotes: CreditNoteRow[] = [];
  let totalSalesReturnTaxReversal = 0;

  for (const adj of adjustments) {
    const adjAmt = Math.abs(Number(adj.difference));
    // Approximate average 5% GST reversal on sales return adjustment
    const revTax = Math.round((adjAmt * 0.05 / 1.05) * 100) / 100;
    totalSalesReturnTaxReversal += revTax;

    creditNotes.push({
      id: adj.id,
      date: adj.createdAt.toISOString().slice(0, 10),
      billNumber: adj.bill?.billNumber || "BILL-ADJ",
      customerName: adj.bill?.order?.customer?.shopName || "Customer",
      adjustedAmount: adjAmt,
      reversalTax: revTax,
      reason: adj.notes || "QC / Return Adjustment",
      resolutionType: adj.resolutionType || "CREDIT_NOTE",
    });
  }

  // ── Overall Summary Totals & GSTR-3B Computation ──
  const totalOutwardTaxable = Math.round((totalB2bTaxable + totalB2cTaxable) * 100) / 100;
  const totalOutputCgst = Math.round((totalB2bCgst + totalB2cCgst) * 100) / 100;
  const totalOutputSgst = Math.round((totalB2bSgst + totalB2cSgst) * 100) / 100;
  const totalOutputIgst = Math.round((totalB2bIgst + totalB2cIgst) * 100) / 100;
  const totalOutputTax = Math.round((totalOutputCgst + totalOutputSgst + totalOutputIgst) * 100) / 100;

  const netOutputTaxAfterReturns = Math.max(0, Math.round((totalOutputTax - totalSalesReturnTaxReversal) * 100) / 100);
  const netGstPayable = Math.max(0, Math.round((netOutputTaxAfterReturns - totalEligibleItc) * 100) / 100);
  const itcClosingBalance = Math.max(0, Math.round((totalEligibleItc - netOutputTaxAfterReturns) * 100) / 100);

  // Format GSTR-3B Table Structure
  const gstr3b = {
    outwardSupplies: {
      taxableValue: totalOutwardTaxable,
      igst: totalOutputIgst,
      cgst: totalOutputCgst,
      sgst: totalOutputSgst,
      totalTax: totalOutputTax,
    },
    eligibleItc: {
      inwardGoodsItc: eligibleGoodsItc,
      inwardServicesItc: opexItcEstimated,
      totalEligibleItc,
      cgst: Math.round((totalPurchasesCgst) * 100) / 100,
      sgst: Math.round((totalPurchasesSgst) * 100) / 100,
      igst: Math.round((totalPurchasesIgst) * 100) / 100,
    },
    adjustments: {
      salesReturnTaxReversal: totalSalesReturnTaxReversal,
      creditNotesCount: creditNotes.length,
    },
    offsetCalculation: {
      grossOutputLiability: totalOutputTax,
      lessSalesReturnTax: totalSalesReturnTaxReversal,
      netOutputLiability: netOutputTaxAfterReturns,
      lessItcUtilized: Math.min(netOutputTaxAfterReturns, totalEligibleItc),
      netGstPayableCash: netGstPayable,
      itcCarriedForward: itcClosingBalance,
    },
  };

  return NextResponse.json({
    period: {
      range,
      monthParam,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    company: {
      legalName: companyLegalName,
      tradeName: companyTradeName,
      gstin: sellerGstin || "UNCONFIGURED (Configure in Admin Settings)",
      stateCode: sellerStateCode,
      stateName: STATE_CODES[sellerStateCode] || "Maharashtra",
    },
    kpi: {
      totalGstCollected: totalOutputTax,
      totalGstPaidItc: totalEligibleItc,
      netGstPayable,
      itcClosingBalance,
      totalTaxableSales: totalOutwardTaxable,
      totalTaxablePurchases: totalPurchasesTaxable,
      totalSalesReturnTaxReversal,
      b2bInvoicesCount: b2bInvoices.length,
      b2cInvoicesCount: b2cInvoices.length,
      purchaseBillsCount: inwardPurchases.length,
      creditNotesCount: creditNotes.length,
    },
    gstr3b,
    rateWiseBreakdown: Array.from(rateMap.values()).sort((a, b) => a.rate - b.rate),
    hsnSummary: Array.from(hsnMap.values()).sort((a, b) => b.taxable - a.taxable),
    b2bInvoices,
    b2cInvoices,
    inwardPurchases,
    creditNotes,
  });
}
