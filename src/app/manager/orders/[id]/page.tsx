"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonTable, SkeletonCard } from "@/components/Skeleton";
import { fmtDateTime, fmtQty } from "@/lib/fmt";
import { PaymentAdjustments } from "@/components/PaymentAdjustments";
import { ModifyBill } from "@/components/ModifyBill";
import { collectRemovedLines, isActiveLine } from "@/lib/bill-lines";
import CancelOrderDialog from "@/components/CancelOrderDialog";

type Money = string;
type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  sellingMode: string;
  notes: string | null;
  customer: { shopName: string; mobile: string };
  financeUser: { name: string };
  items: { id: string; productId: string; unitId: string; product: { name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits?: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: Money; wholesalePrice: Money; retailPrice: Money; unit: { id: string; symbol: string } | null }[] }; quantity: Money; unitPrice: Money; lineTotal: Money }[];
  bill: {
    billNumber: string;
    paymentStatus: string;
    currentVersion: number;
    payment: { amountDue: Money; amountPaid: Money } | null;
    versions: {
      versionNumber: number;
      versionType: string;
      total: Money;
      reason: string | null;
      createdAt: string;
      createdByUser: { name: string; role: string } | null;
      items: { id: string; productId: string; unitId: string; product: { name: string; wholesalePrice?: Money; retailPrice?: Money; saleUnits?: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: Money; wholesalePrice: Money; retailPrice: Money; unit: { id: string; symbol: string } | null }[] }; quantity: Money; unitPrice: Money; lineTotal: Money; changeType: string; previousQuantity: Money | null }[];
    }[];
    adjustments: { id: string; previousTotal: Money; newTotal: Money; difference: Money; resolutionType: string | null }[];
  } | null;
};

// Same info Finance sees on their order page, minus payment collection.
// Managers can resolve a payment adjustment (the resolve route allows their
// role), cancel a problem order stuck pre-QC, and refund a completed one.
export default function ManagerOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error: loadError, loading, reload: load } = useApiGet<OrderDetail>(`/api/finance/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-6 w-64" />
        <SkeletonTable rows={4} cols={3} />
        <SkeletonCard lines={2} />
      </div>
    );
  }
  if (loadError && !order) return <ErrorRetry message={loadError} onRetry={load} />;
  if (!order) return null;
  const bill = order.bill;
  const currentVersion = bill?.versions.find((v) => v.versionNumber === bill.currentVersion) ?? bill?.versions.at(-1);
  // Every product ever dropped from this order, newest removal first — not
  // just the current version's, so a line removed two revisions ago is still
  // accounted for on screen.
  const removedLines = bill ? collectRemovedLines(bill.versions, bill.currentVersion) : [];
  const displayTotal = currentVersion ? Number(currentVersion.total) : order.items.reduce((s, i) => s + Number(i.lineTotal), 0);
  const canCancel = ["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID"].includes(order.status);
  // Cancel handles orders whose stock is still only reserved; once it has been
  // deducted, Refund is the undo instead.
  const canRefund = ["READY_FOR_HANDOVER", "COMPLETED", "REFUND_REQUIRED", "ADDITIONAL_PAYMENT_REQUIRED"].includes(order.status);


  async function refundOrder() {
    const reason = prompt("Refund the whole order? Every item goes back into stock and the bill is reversed to ₹0. Reason:");
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/manager/orders/${id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setError(typeof body.error === "string" ? body.error : "Could not refund the order");
    }
    load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {order.orderNumber} {bill && `— ${bill.billNumber}`}
          </h1>
          <p className="text-sm text-muted">
            {order.customer.shopName}{order.customer.mobile ? ` (${order.customer.mobile})` : ""} · {order.sellingMode} · Billed by {order.financeUser.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-line">{order.status}</span>
          {bill && <span className="badge bg-line">{bill.paymentStatus}</span>}
          {canCancel && (
            <button className="btn-danger" disabled={busy} onClick={() => setCancelling(true)}>
              Cancel Order
            </button>
          )}
          {cancelling && <CancelOrderDialog orderId={id} paid={Number(bill?.payment?.amountPaid ?? 0)} onClose={() => setCancelling(false)} onDone={load} />}
          {canRefund && (
            <button className="btn-danger" disabled={busy} onClick={refundOrder}>
              Refund Order
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Items</h2>
          {bill && order.status !== "CANCELLED" && (
            <ModifyBill orderId={id} sellingMode={order.sellingMode} lines={currentVersion?.items ?? order.items} onSaved={load} disabled={busy} />
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(currentVersion?.items ?? order.items).filter(isActiveLine).map((it) => (
              <tr key={it.id}>
                <td>{it.product.name}</td>
                <td>{fmtQty(it.quantity)}</td>
                <td>₹{Number(it.lineTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-right text-base font-semibold">Total: ₹{displayTotal.toFixed(2)}</div>

        {removedLines.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-1 text-xs font-semibold text-muted">Removed from this bill</h3>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Was</th>
                  <th>Removed in</th>
                </tr>
              </thead>
              <tbody>
                {removedLines.map(({ item, versionNumber }) => (
                  <tr key={item.id} className="text-muted">
                    <td className="line-through">{item.product?.name}</td>
                    <td>{fmtQty(item.previousQuantity ?? 0)}</td>
                    <td>v{versionNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bill && bill.versions.length > 1 && (
        <section className="card">
          <h2 className="mb-2 text-sm font-semibold">Bill history</h2>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Type</th>
                <th>Edited by</th>
                <th>Reason</th>
                <th>When</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {bill.versions.map((v) => (
                <tr key={v.versionNumber}>
                  <td>v{v.versionNumber}</td>
                  <td>{v.versionType}</td>
                  <td>{v.createdByUser ? `${v.createdByUser.name} (${v.createdByUser.role})` : "—"}</td>
                  <td>{v.reason ?? "—"}</td>
                  <td>{fmtDateTime(v.createdAt)}</td>
                  <td>₹{Number(v.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bill?.payment && (
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold">Payment</h2>
          {/* amountDue is the bill total, not the outstanding — labelling it
              "Due" made a fully paid bill read as still owing. */}
          <p className="text-sm">
            Bill total: ₹{Number(bill.payment.amountDue).toFixed(2)} · Paid: ₹{Number(bill.payment.amountPaid).toFixed(2)} ·{" "}
            {Number(bill.payment.amountDue) - Number(bill.payment.amountPaid) > 0
              ? `Still due: ₹${(Number(bill.payment.amountDue) - Number(bill.payment.amountPaid)).toFixed(2)}`
              : "Settled"}
          </p>
        </section>
      )}

      {bill && <PaymentAdjustments adjustments={bill.adjustments} onResolved={load} />}

      {order.notes && (
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold">Notes</h2>
          <p className="text-sm">{order.notes}</p>
        </section>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
