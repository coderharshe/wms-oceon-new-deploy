import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const [purchaseOrders, discountApprovals, stockVariances, vouchers] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: {
        supplier: { select: { name: true, phone: true } },
        warehouse: { select: { name: true } },
        createdByUser: { select: { name: true, staffId: true } },
        items: { include: { product: { select: { name: true, sku: true } }, unit: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.discountApproval.findMany({
      where: { status: "PENDING" },
      include: {
        warehouse: { select: { name: true } },
        requestedByUser: { select: { name: true, staffId: true } },
        order: { select: { orderNumber: true, customer: { select: { shopName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.stockAdjustmentRequest.findMany({
      where: { status: "PENDING" },
      include: {
        product: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
        requestedByUser: { select: { name: true, staffId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.voucher.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: {
        warehouse: { select: { name: true } },
        createdByUser: { select: { name: true, staffId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    purchaseOrders: purchaseOrders.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      supplier: p.supplier.name,
      warehouse: p.warehouse.name,
      total: Number(p.total),
      creditDays: p.creditDays,
      createdAt: p.createdAt,
      requestedBy: `${p.createdByUser.name} (${p.createdByUser.staffId})`,
      notes: p.notes,
      itemCount: p.items.length,
      items: p.items.map((i) => ({
        product: i.product.name,
        sku: i.product.sku,
        qty: Number(i.quantity),
        unit: i.unit.symbol,
        rate: Number(i.purchaseRate),
        lineTotal: Number(i.lineTotal),
      })),
    })),
    discountApprovals: discountApprovals.map((d) => ({
      id: d.id,
      orderNumber: d.order?.orderNumber ?? "Draft Bill",
      customer: d.order?.customer?.shopName ?? "Retail Walk-in",
      warehouse: d.warehouse.name,
      discountPercent: Number(d.discountPercent),
      discountAmount: Number(d.discountAmount),
      billAmount: Number(d.billAmount),
      reason: d.reason,
      createdAt: d.createdAt,
      requestedBy: `${d.requestedByUser.name} (${d.requestedByUser.staffId})`,
    })),
    stockVariances: stockVariances.map((s) => ({
      id: s.id,
      product: s.product.name,
      sku: s.product.sku,
      warehouse: s.warehouse.name,
      systemQty: Number(s.systemQty),
      physicalQty: Number(s.physicalQty),
      varianceQty: Number(s.varianceQty),
      reason: s.reason,
      createdAt: s.createdAt,
      requestedBy: `${s.requestedByUser.name} (${s.requestedByUser.staffId})`,
    })),
    vouchers: vouchers.map((v) => ({
      id: v.id,
      voucherNo: v.voucherNo,
      type: v.type,
      partyName: v.partyName,
      partyType: v.partyType,
      amount: Number(v.amount),
      paymentMode: v.paymentMode,
      referenceNo: v.referenceNo,
      notes: v.notes,
      warehouse: v.warehouse.name,
      createdAt: v.createdAt,
      requestedBy: `${v.createdByUser.name} (${v.createdByUser.staffId})`,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN"]);
  if (isErrorResponse(session)) return session;

  const body = await req.json().catch(() => null);
  if (!body || !body.type || !body.id || !body.action) {
    return NextResponse.json({ error: "Missing required parameters (type, id, action)" }, { status: 400 });
  }

  const { type, id, action, notes } = body;
  if (!["APPROVE", "REJECT"].includes(action)) {
    return NextResponse.json({ error: "Action must be APPROVE or REJECT" }, { status: 400 });
  }

  const db = getDb();
  const isApproved = action === "APPROVE";

  try {
    if (type === "PO") {
      const po = await db.purchaseOrder.findUnique({ where: { id } });
      if (!po) return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 });

      await db.purchaseOrder.update({
        where: { id },
        data: {
          status: isApproved ? "APPROVED" : "CANCELLED",
          approvedByUserId: session.sub,
          approvalNotes: notes ?? null,
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.sub,
          role: session.role,
          warehouseId: po.warehouseId,
          action: isApproved ? "PO_APPROVED_BY_ADMIN" : "PO_REJECTED_BY_ADMIN",
          entityType: "PurchaseOrder",
          entityId: id,
          reason: notes ?? `${action} by Admin`,
          oldValue: { status: po.status },
          newValue: { status: isApproved ? "APPROVED" : "CANCELLED" },
        },
      });

      return NextResponse.json({ success: true, message: `PO ${po.poNumber} ${isApproved ? "Approved" : "Rejected"}` });
    }

    if (type === "DISCOUNT") {
      const disc = await db.discountApproval.findUnique({ where: { id } });
      if (!disc) return NextResponse.json({ error: "Discount approval request not found" }, { status: 404 });

      await db.discountApproval.update({
        where: { id },
        data: {
          status: isApproved ? "APPROVED" : "REJECTED",
          approvedByUserId: session.sub,
          approvalNotes: notes ?? null,
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.sub,
          role: session.role,
          warehouseId: disc.warehouseId,
          action: isApproved ? "DISCOUNT_APPROVED_BY_ADMIN" : "DISCOUNT_REJECTED_BY_ADMIN",
          entityType: "DiscountApproval",
          entityId: id,
          reason: notes ?? `${action} by Admin`,
          oldValue: { status: disc.status },
          newValue: { status: isApproved ? "APPROVED" : "REJECTED" },
        },
      });

      return NextResponse.json({ success: true, message: `Discount ${isApproved ? "Approved" : "Rejected"}` });
    }

    if (type === "STOCK_VARIANCE") {
      const adj = await db.stockAdjustmentRequest.findUnique({ where: { id } });
      if (!adj) return NextResponse.json({ error: "Stock adjustment request not found" }, { status: 404 });

      if (isApproved) {
        const inv = await db.inventory.findUnique({
          where: { productId_warehouseId: { productId: adj.productId, warehouseId: adj.warehouseId } },
        });
        const currentQty = inv ? Number(inv.quantityOnHand) : 0;
        const newQty = Math.max(0, currentQty + Number(adj.varianceQty));

        await db.$transaction([
          db.inventory.upsert({
            where: { productId_warehouseId: { productId: adj.productId, warehouseId: adj.warehouseId } },
            create: { productId: adj.productId, warehouseId: adj.warehouseId, quantityOnHand: newQty },
            update: { quantityOnHand: newQty },
          }),
          db.inventoryMovement.create({
            data: {
              productId: adj.productId,
              warehouseId: adj.warehouseId,
              beforeQty: currentQty,
              movementQty: adj.varianceQty,
              afterQty: newQty,
              movementType: "STOCK_COUNT_ADJUSTMENT",
              referenceType: "STOCK_ADJUSTMENT_REQUEST",
              referenceId: adj.id,
              userId: session.sub,
            },
          }),
          db.stockAdjustmentRequest.update({
            where: { id },
            data: {
              status: "APPROVED",
              approvedByUserId: session.sub,
              approvalNotes: notes ?? null,
            },
          }),
        ]);
      } else {
        await db.stockAdjustmentRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
            approvedByUserId: session.sub,
            approvalNotes: notes ?? null,
          },
        });
      }

      await db.auditLog.create({
        data: {
          userId: session.sub,
          role: session.role,
          warehouseId: adj.warehouseId,
          action: isApproved ? "STOCK_VARIANCE_APPROVED" : "STOCK_VARIANCE_REJECTED",
          entityType: "StockAdjustmentRequest",
          entityId: id,
          reason: notes ?? `${action} by Admin`,
          oldValue: { status: adj.status },
          newValue: { status: isApproved ? "APPROVED" : "REJECTED" },
        },
      });

      return NextResponse.json({ success: true, message: `Stock variance ${isApproved ? "Approved & stock adjusted" : "Rejected"}` });
    }

    if (type === "VOUCHER") {
      const v = await db.voucher.findUnique({ where: { id } });
      if (!v) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

      await db.voucher.update({
        where: { id },
        data: {
          status: isApproved ? "APPROVED" : "CANCELLED",
          approvedByUserId: session.sub,
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.sub,
          role: session.role,
          warehouseId: v.warehouseId,
          action: isApproved ? "VOUCHER_APPROVED" : "VOUCHER_REJECTED",
          entityType: "Voucher",
          entityId: id,
          reason: notes ?? `${action} by Admin`,
          oldValue: { status: v.status },
          newValue: { status: isApproved ? "APPROVED" : "CANCELLED" },
        },
      });

      return NextResponse.json({ success: true, message: `Voucher ${v.voucherNo} ${isApproved ? "Approved" : "Rejected"}` });
    }

    return NextResponse.json({ error: "Invalid approval type" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process approval" }, { status: 500 });
  }
}
