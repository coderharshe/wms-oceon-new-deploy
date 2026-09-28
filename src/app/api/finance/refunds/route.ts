import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { adjustStock } from "@/lib/inventory";
import { Decimal } from "@prisma/client/runtime/library";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId || "none";

  try {
    const db = getDb();
    const whereWh: any = {};
    if (warehouseId && warehouseId !== "all") whereWh.warehouseId = warehouseId;

    // 1. Pending Payment Adjustments (Awaiting Refund / Credit Note Resolution)
    const pendingAdjustments = await db.paymentAdjustment.findMany({
      where: {
        resolutionType: null,
      },
      include: {
        bill: {
          include: {
            order: {
              include: {
                customer: true,
                warehouse: { select: { id: true, name: true, code: true } },
                items: { include: { product: true, unit: true } },
                qcSessions: {
                  include: {
                    qcUser: { select: { name: true, staffId: true } },
                    adjustments: { include: { product: true } },
                  },
                },
              },
            },
            payment: { include: { transactions: true } },
            versions: { orderBy: { versionNumber: "desc" }, take: 2 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 2. Settled / Resolved Refunds and Credit Notes
    const resolvedAdjustments = await db.paymentAdjustment.findMany({
      where: {
        resolutionType: { not: null },
      },
      include: {
        bill: {
          include: {
            order: {
              include: {
                customer: true,
                warehouse: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // 3. Completed / In-Transit Orders Eligible for Return / Cancellation
    const eligibleOrders = await db.order.findMany({
      where: {
        ...whereWh,
        status: { in: ["COMPLETED", "READY_FOR_HANDOVER", "REFUND_REQUIRED"] },
      },
      include: {
        customer: true,
        warehouse: { select: { name: true, code: true } },
        bill: {
          include: {
            payment: true,
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        },
        items: { include: { product: true, unit: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // 4. Return Inventory Movements
    const returnMovements = await db.inventoryMovement.findMany({
      where: {
        movementType: { in: ["RETURN", "QC_ADJUSTMENT", "DAMAGE"] },
      },
      include: {
        product: { select: { name: true, sku: true } },
        user: { select: { name: true, staffId: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    // Aggregate summary metrics
    let totalRefundedAmount = 0;
    let cashRefundTotal = 0;
    let upiRefundTotal = 0;
    let creditNoteTotal = 0;
    let managerAdjTotal = 0;

    for (const r of resolvedAdjustments) {
      const diff = Math.abs(Number(r.difference));
      totalRefundedAmount += diff;
      if (r.resolutionType === "CASH_REFUND") cashRefundTotal += diff;
      else if (r.resolutionType === "UPI_REFUND") upiRefundTotal += diff;
      else if (r.resolutionType === "CUSTOMER_CREDIT") creditNoteTotal += diff;
      else if (r.resolutionType === "MANAGER_ADJUSTMENT") managerAdjTotal += diff;
    }

    let pendingRefundCount = 0;
    let pendingRefundAmount = 0;
    for (const p of pendingAdjustments) {
      const diff = Math.abs(Number(p.difference));
      pendingRefundCount += 1;
      pendingRefundAmount += diff;
    }

    let restockedUnits = 0;
    let damagedUnits = 0;
    for (const m of returnMovements) {
      const qty = Math.abs(Number(m.movementQty));
      if (m.movementType === "RETURN") restockedUnits += qty;
      else if (m.movementType === "DAMAGE") damagedUnits += qty;
    }

    return NextResponse.json({
      userRole: session.role,
      userId: session.sub,
      summary: {
        totalRefundedAmount,
        cashRefundTotal,
        upiRefundTotal,
        creditNoteTotal,
        managerAdjTotal,
        pendingRefundCount,
        pendingRefundAmount,
        resolvedCount: resolvedAdjustments.length,
        restockedUnits,
        damagedUnits,
      },
      pendingAdjustments: pendingAdjustments.map((adj) => ({
        id: adj.id,
        billId: adj.billId,
        orderId: adj.bill.order.id,
        orderNumber: adj.bill.order.orderNumber,
        billNumber: adj.bill.billNumber,
        customerName: adj.bill.order.customer.shopName,
        customerMobile: adj.bill.order.customer.mobile,
        previousTotal: Number(adj.previousTotal),
        newTotal: Number(adj.newTotal),
        difference: Number(adj.difference),
        refundDue: Math.abs(Number(adj.difference)),
        notes: adj.notes,
        createdAt: adj.createdAt.toISOString(),
        warehouse: adj.bill.order.warehouse.name,
        qcDetails: adj.bill.order.qcSessions[0]
          ? {
              inspector: adj.bill.order.qcSessions[0].qcUser?.name || "QC Inspector",
              adjustments: adj.bill.order.qcSessions[0].adjustments.map((a) => ({
                product: a.product.name,
                originalQty: Number(a.originalQty),
                finalQty: Number(a.finalQty),
                action: a.action,
                reason: a.reason,
              })),
            }
          : null,
      })),
      resolvedRefunds: resolvedAdjustments.map((r) => ({
        id: r.id,
        orderNumber: r.bill.order.orderNumber,
        billNumber: r.bill.billNumber,
        customerName: r.bill.order.customer.shopName,
        customerMobile: r.bill.order.customer.mobile,
        refundAmount: Math.abs(Number(r.difference)),
        resolutionType: r.resolutionType,
        notes: r.notes,
        resolvedAt: r.createdAt.toISOString(),
        warehouse: r.bill.order.warehouse.name,
      })),
      eligibleOrders: eligibleOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        billNumber: o.bill?.billNumber || null,
        customerName: o.customer.shopName,
        mobile: o.customer.mobile,
        status: o.status,
        total: o.bill?.versions[0] ? Number(o.bill.versions[0].total) : 0,
        amountPaid: o.bill?.payment ? Number(o.bill.payment.amountPaid) : 0,
        itemsCount: o.items.length,
        items: o.items.map((it) => ({
          productId: it.productId,
          productName: it.product.name,
          quantity: Number(it.quantity),
          unit: it.unit.name,
          unitPrice: Number(it.unitPrice),
          lineTotal: Number(it.lineTotal),
        })),
        createdAt: o.createdAt.toISOString(),
      })),
      returnMovements: returnMovements.map((m) => ({
        id: m.id,
        productName: m.product.name,
        sku: m.product.sku,
        quantity: Math.abs(Number(m.movementQty)),
        movementType: m.movementType,
        loggedBy: m.user?.name || "QC Staff",
        timestamp: m.timestamp.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load refunds & credit notes data" }, { status: 500 });
  }
}

// POST Handler for Return Initiation, QC Restock, and Refund / Credit Note Issuance
const refundActionSchema = z.object({
  action: z.enum(["INITIATE_RETURN", "RESOLVE_REFUND"]),
  // INITIATE_RETURN fields
  orderId: z.string().optional(),
  returnReason: z.string().optional(),
  restockItems: z.boolean().optional().default(true),
  // RESOLVE_REFUND fields
  adjustmentId: z.string().optional(),
  resolutionType: z.enum(["CASH_REFUND", "UPI_REFUND", "CUSTOMER_CREDIT", "MANAGER_ADJUSTMENT"]).optional(),
  payoutAccount: z.string().optional(),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const parsed = refundActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;

  try {
    // ──────────────────────── 1. INITIATE RETURN & QC RESTOCK ────────────────────────
    if (data.action === "INITIATE_RETURN") {
      if (!data.orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

      const ord = await db.order.findUnique({
        where: { id: data.orderId },
        include: {
          customer: true,
          bill: {
            include: {
              versions: { orderBy: { versionNumber: "desc" }, take: 1 },
              payment: true,
            },
          },
          items: true,
        },
      });

      if (!ord) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      const currentTotal = ord.bill?.versions[0] ? Number(ord.bill.versions[0].total) : 0;
      const amountPaid = ord.bill?.payment ? Number(ord.bill.payment.amountPaid) : 0;

      // 1. Restock items back into inventory if restockItems is true
      if (data.restockItems) {
        for (const item of ord.items) {
          await adjustStock(db, {
            productId: item.productId,
            warehouseId: ord.warehouseId,
            deltaBaseQty: new Decimal(item.quantity), // positive = return to stock
            movementType: "RETURN",
            referenceType: "ORDER",
            referenceId: ord.id,
            userId: session.sub,
          });
        }
      }

      // 2. Create a PaymentAdjustment row representing the refund due
      const adjustment = await db.paymentAdjustment.create({
        data: {
          billId: ord.bill!.id,
          previousTotal: currentTotal,
          newTotal: 0,
          difference: new Decimal(-amountPaid || -currentTotal),
          notes: data.returnReason || "Customer Return / Sale Cancellation",
        },
      });

      // 3. Update order status to REFUND_REQUIRED
      await db.order.update({
        where: { id: ord.id },
        data: { status: "REFUND_REQUIRED" },
      });

      // 4. Append new BillVersion with total 0
      if (ord.bill) {
        await db.billVersion.create({
          data: {
            billId: ord.bill.id,
            versionNumber: ord.bill.currentVersion + 1,
            versionType: "FINAL",
            subtotal: 0,
            total: 0,
            reason: `Return / Cancellation: ${data.returnReason || "Customer Return"}`,
            createdByUserId: session.sub,
          },
        });

        await db.bill.update({
          where: { id: ord.bill.id },
          data: {
            currentVersion: ord.bill.currentVersion + 1,
            paymentStatus: "REFUND_DUE",
          },
        });
      }

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: ord.warehouseId,
        action: "ORDER_RETURN_INITIATED",
        entityType: "Order",
        entityId: ord.id,
        newValue: { orderNumber: ord.orderNumber, reason: data.returnReason, refundDue: amountPaid || currentTotal },
      });

      return NextResponse.json({ success: true, adjustment, orderNumber: ord.orderNumber });
    }

    // ──────────────────────── 2. RESOLVE REFUND / ISSUE CREDIT NOTE ────────────────────────
    if (data.action === "RESOLVE_REFUND") {
      if (!data.adjustmentId || !data.resolutionType) {
        return NextResponse.json({ error: "adjustmentId and resolutionType are required" }, { status: 400 });
      }

      const adj = await db.paymentAdjustment.findUnique({
        where: { id: data.adjustmentId },
        include: {
          bill: {
            include: {
              order: { include: { customer: true } },
              payment: true,
            },
          },
        },
      });

      if (!adj) return NextResponse.json({ error: "Adjustment not found" }, { status: 404 });

      const refundAmount = Math.abs(Number(adj.difference));
      const resType = data.resolutionType;

      // 1. Update PaymentAdjustment
      await db.paymentAdjustment.update({
        where: { id: adj.id },
        data: {
          resolutionType: resType as any,
          resolvedByUserId: session.sub,
          notes: data.notes || `Refund resolved via ${resType}`,
        },
      });

      // 2. Update Bill payment status
      await db.bill.update({
        where: { id: adj.billId },
        data: {
          paymentStatus: resType === "CUSTOMER_CREDIT" ? "PAID" : "REFUNDED",
        },
      });

      // 3. Record PaymentTransaction if payment record exists
      if (adj.bill.payment) {
        let method: "CASH" | "UPI" | "BANK_TRANSFER" | "CREDIT" = "CASH";
        if (resType === "CASH_REFUND") method = "CASH";
        else if (resType === "UPI_REFUND") method = "UPI";
        else if (resType === "CUSTOMER_CREDIT") method = "CREDIT";

        await db.paymentTransaction.create({
          data: {
            paymentId: adj.bill.payment.id,
            type: "REFUND",
            method: method as any,
            amount: refundAmount,
            notes: data.notes || `Refund resolved via ${resType} (${data.referenceNo || "Ref"})`,
            status: "CONFIRMED",
            recordedByUserId: session.sub,
          },
        });
      }

      // 4. If Bank Transfer / UPI Refund, record Bank Transaction Outflow
      if (resType === "UPI_REFUND") {
        await db.bankTransaction.create({
          data: {
            warehouseId: adj.bill.warehouseId,
            businessDate: new Date(),
            type: "EXPENSE_PAYOUT",
            amount: refundAmount,
            isCredit: false,
            bankName: data.payoutAccount || "UPI Settlement",
            utrReference: data.referenceNo || null,
            partyName: adj.bill.order.customer.shopName,
            notes: `UPI Customer Refund for Order ${adj.bill.order.orderNumber}`,
            reconciled: true,
            recordedByUserId: session.sub,
          },
        });
      }

      await writeAudit({
        userId: session.sub,
        role: session.role,
        warehouseId: adj.bill.warehouseId,
        action: `REFUND_RESOLVED_${resType}`,
        entityType: "PaymentAdjustment",
        entityId: adj.id,
        newValue: { refundAmount, resolutionType: resType, orderNumber: adj.bill.order.orderNumber },
      });

      return NextResponse.json({ success: true, refundAmount, resolutionType: resType });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process refund action" }, { status: 500 });
  }
}
