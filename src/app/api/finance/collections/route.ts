import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";
  const range = req.nextUrl.searchParams.get("range") || "30d";
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");

  try {
    const db = getDb();
    const now = new Date();

    // Date range calculation
    let fromDate = new Date();
    let toDate = new Date();

    if (range === "today") {
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);
    } else if (range === "yesterday") {
      fromDate.setDate(fromDate.getDate() - 1);
      fromDate.setHours(0, 0, 0, 0);
      toDate.setDate(toDate.getDate() - 1);
      toDate.setHours(23, 59, 59, 999);
    } else if (range === "7d") {
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
    } else if (range === "thisMonth") {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "custom" && startDateParam && endDateParam) {
      fromDate = new Date(startDateParam);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(endDateParam);
      toDate.setHours(23, 59, 59, 999);
    } else {
      // default 30d
      fromDate.setDate(fromDate.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
    }

    const whereTx: any = {
      type: "PAYMENT",
      status: "CONFIRMED",
      timestamp: {
        gte: fromDate,
        lte: toDate,
      },
    };

    // Fetch all PaymentTransactions with order, customer, warehouse, user
    const transactions = await db.paymentTransaction.findMany({
      where: whereTx,
      include: {
        payment: {
          include: {
            bill: {
              include: {
                order: {
                  include: {
                    customer: true,
                    warehouse: { select: { id: true, name: true, code: true } },
                  },
                },
                versions: {
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
        recordedByUser: {
          select: {
            id: true,
            name: true,
            staffId: true,
            role: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    // Also calculate overall outstanding from current unpaid orders to show retailer debt context
    const allUnpaidBills = await db.order.findMany({
      where: {
        status: { in: ["BILLED", "PAYMENT_PENDING", "READY_FOR_QC", "QC_IN_PROGRESS", "READY_FOR_HANDOVER", "COMPLETED"] },
        bill: { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "PENDING", "PAYMENT_ADJUSTMENT_REQUIRED"] } },
      },
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

    const customerOutstandingMap = new Map<string, number>();
    for (const ord of allUnpaidBills) {
      const billTotal = ord.bill?.versions[0] ? Number(ord.bill.versions[0].total) : 0;
      const paid = ord.bill?.payment ? Number(ord.bill.payment.amountPaid) : 0;
      const bal = Math.max(0, billTotal - paid);
      customerOutstandingMap.set(ord.customerId, (customerOutstandingMap.get(ord.customerId) || 0) + bal);
    }

    let cashCollection = 0;
    let bankCollection = 0;
    let upiCollection = 0;
    let chequeCollection = 0;
    let b2bCollection = 0;
    let outstandingCollection = 0;
    let totalCollected = 0;

    // Aggregations
    const employeeMap = new Map<string, {
      userId: string;
      staffId: string;
      name: string;
      role: string;
      cash: number;
      bank: number;
      upi: number;
      cheque: number;
      total: number;
      txCount: number;
    }>();

    const retailerMap = new Map<string, {
      customerId: string;
      shopName: string;
      ownerName: string | null;
      mobile: string | null;
      gstin: string | null;
      cash: number;
      bank: number;
      upi: number;
      cheque: number;
      total: number;
      currentOutstanding: number;
      lastPaymentDate: string;
      txCount: number;
    }>();

    const collectionList = [];

    for (const tx of transactions) {
      const amt = Number(tx.amount);
      const method = tx.method;
      const ord = tx.payment?.bill?.order;
      const cust = ord?.customer;
      const user = tx.recordedByUser;

      // Filter by warehouse if applied
      if (warehouseId && warehouseId !== "all" && ord?.warehouse?.id && ord.warehouse.id !== warehouseId) {
        continue;
      }

      totalCollected += amt;
      b2bCollection += amt; // B2B orders

      if (method === "CASH") cashCollection += amt;
      else if (method === "BANK_TRANSFER") bankCollection += amt;
      else if (method === "UPI") upiCollection += amt;
      else if (method === "CHEQUE") chequeCollection += amt;

      // Check if recovery (order created > 3 days before payment or specific note)
      const isRecovery = ord?.createdAt
        ? (new Date(tx.timestamp).getTime() - new Date(ord.createdAt).getTime()) > 3 * 24 * 60 * 60 * 1000
        : false;

      if (isRecovery) outstandingCollection += amt;

      // Employee summary
      const empId = user?.id || "unassigned";
      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          userId: empId,
          staffId: user?.staffId || "SYSTEM",
          name: user?.name || "Automated / System",
          role: user?.role || "FINANCE",
          cash: 0,
          bank: 0,
          upi: 0,
          cheque: 0,
          total: 0,
          txCount: 0,
        });
      }
      const emp = employeeMap.get(empId)!;
      emp.total += amt;
      emp.txCount += 1;
      if (method === "CASH") emp.cash += amt;
      else if (method === "BANK_TRANSFER") emp.bank += amt;
      else if (method === "UPI") emp.upi += amt;
      else if (method === "CHEQUE") emp.cheque += amt;

      // Retailer summary
      if (cust) {
        const cId = cust.id;
        if (!retailerMap.has(cId)) {
          retailerMap.set(cId, {
            customerId: cId,
            shopName: cust.shopName,
            ownerName: cust.ownerName,
            mobile: cust.mobile,
            gstin: cust.gstin,
            cash: 0,
            bank: 0,
            upi: 0,
            cheque: 0,
            total: 0,
            currentOutstanding: customerOutstandingMap.get(cId) || 0,
            lastPaymentDate: new Date(tx.timestamp).toISOString(),
            txCount: 0,
          });
        }
        const ret = retailerMap.get(cId)!;
        ret.total += amt;
        ret.txCount += 1;
        if (method === "CASH") ret.cash += amt;
        else if (method === "BANK_TRANSFER") ret.bank += amt;
        else if (method === "UPI") ret.upi += amt;
        else if (method === "CHEQUE") ret.cheque += amt;
        if (new Date(tx.timestamp) > new Date(ret.lastPaymentDate)) {
          ret.lastPaymentDate = new Date(tx.timestamp).toISOString();
        }
      }

      collectionList.push({
        id: tx.id,
        orderId: ord?.id,
        orderNumber: ord?.orderNumber || "—",
        billNumber: tx.payment?.bill?.billNumber || null,
        customerId: cust?.id,
        retailerName: cust?.shopName || "Walk-in Customer",
        ownerName: cust?.ownerName || null,
        mobile: cust?.mobile || null,
        amount: amt,
        method: tx.method,
        referenceNo: tx.upiReference || tx.bankReference || tx.chequeNumber || null,
        chequeBank: tx.chequeBank,
        chequeDueDate: tx.chequeDueDate ? new Date(tx.chequeDueDate).toISOString().slice(0, 10) : null,
        chequeStatus: tx.chequeStatus,
        recordedBy: {
          staffId: user?.staffId || "SYS",
          name: user?.name || "System",
        },
        timestamp: tx.timestamp.toISOString(),
        isRecovery,
        notes: tx.notes,
        warehouse: ord?.warehouse?.name || "Main Hub",
      });
    }

    // Sort employee and retailer aggregations
    const collectionByEmployee = Array.from(employeeMap.values()).sort((a, b) => b.total - a.total);
    const collectionByRetailer = Array.from(retailerMap.values()).sort((a, b) => b.total - a.total);

    return NextResponse.json({
      dateRange: {
        range,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      summary: {
        totalCollected,
        cashCollection,
        bankCollection,
        upiCollection,
        chequeCollection,
        b2bCollection,
        outstandingCollection,
        transactionCount: collectionList.length,
      },
      collectionByEmployee,
      collectionByRetailer,
      recentCollections: collectionList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load collections data" }, { status: 500 });
  }
}
