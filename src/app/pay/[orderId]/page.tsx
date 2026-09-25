"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useLiveEvents } from "@/lib/live-events";

type PayInfo = {
  businessName: string;
  orderNumber: string;
  billNumber: string;
  amountPayable: number;
  paymentStatus: string;
  qrDataUrl: string | null;
};

const PAID_STATES = ["PAID"];

export default function PaymentDisplayPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [info, setInfo] = useState<PayInfo | null>(null);

  const load = useCallback(() => {
    fetch(`/api/pay/${orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo);
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents((data) => {
    if (["resync", "payment:updated", "payment:confirmed", "bill:revised"].includes(data.type)) load();
  }, orderId);

  if (!info) {
    // Dark kiosk display, not the light ERP theme — inline pulse blocks
    // instead of the shared Skeleton (its bg-line would be invisible here).
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-white">
        <div className="h-4 w-40 animate-pulse rounded bg-white/20" />
        <div className="h-14 w-56 animate-pulse rounded bg-white/20" />
        <div className="h-52 w-52 animate-pulse rounded bg-white/20" />
      </div>
    );
  }

  const isPaid = PAID_STATES.includes(info.paymentStatus);

  return (
    <div className={`relative flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center ${isPaid ? "bg-good text-white" : "bg-ink text-white"}`}>
      <h1 className="text-2xl font-semibold tracking-wide">{info.businessName}</h1>

      {isPaid ? (
        <>
          <p className="text-5xl font-bold">✓ PAID</p>
          <p className="text-lg opacity-80">
            Order {info.orderNumber} · {info.billNumber}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm uppercase tracking-widest opacity-70">Total Payable</p>
          <p className="text-6xl font-bold">₹{info.amountPayable.toFixed(2)}</p>

          {info.qrDataUrl && (
            <>
              <p className="mt-2 text-lg">Scan to Pay via UPI</p>
              <img src={info.qrDataUrl} alt="UPI QR" width={280} height={280} className="rounded bg-white p-2" />
            </>
          )}

          <p className="mt-2 text-base opacity-80">
            Order: {info.orderNumber} · Bill: {info.billNumber}
          </p>
          <p className="animate-pulse text-sm uppercase tracking-widest opacity-60">Waiting for payment…</p>
        </>
      )}

      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs opacity-50">OCEON-WMS · © {new Date().getFullYear()} SHP Stacks</p>
    </div>
  );
}
