"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApiGet } from "@/lib/useApiGet";
import { useLiveEvents } from "@/lib/live-events";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonCard } from "@/components/Skeleton";

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  customer: { shopName: string };
  bill: { billNumber: string; paymentStatus: string } | null;
  qcSessions: { qcUserId: string; qcUser: { name: string | null; isYou: boolean } }[];
};

const SECTIONS: { key: string; label: string; statuses: string[] }[] = [
  { key: "waiting", label: "Waiting for QC", statuses: ["READY_FOR_QC"] },
  { key: "progress", label: "In Progress", statuses: ["QC_IN_PROGRESS"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED"] },
];

export default function QcQueuePage() {
  const router = useRouter();
  const { data: ordersData, error, loading, reload } = useApiGet<OrderRow[]>("/api/qc/orders");
  const orders = ordersData ?? [];
  const [tab, setTab] = useState("waiting");

  useLiveEvents((event) => {
    if (["resync", "order:created", "order:ready_for_qc", "qc:started", "qc:completed"].includes(event.type)) reload();
  });

  async function open(orderId: string) {
    const res = await fetch("/api/qc/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    if (res.ok) {
      router.push(`/qc/${orderId}`);
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 423) {
      alert(`Locked: ${body.error}`);
      return;
    }
    alert(body.error ?? "Could not open this order for QC");
  }

  const section = SECTIONS.find((s) => s.key === tab)!;
  const visible = orders.filter((o) => section.statuses.includes(o.status));

  return (
    <div className="space-y-3">
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {/* Tabs: large touch targets, wraps on small screens */}
      <div className="flex flex-wrap gap-1">
        {SECTIONS.map((s) => {
          const count = orders.filter((o) => s.statuses.includes(o.status)).length;
          return (
            <button
              key={s.key}
              onClick={() => setTab(s.key)}
              className={`rounded px-3 py-2 text-sm font-medium ${tab === s.key ? "bg-accent text-white" : "bg-paper border border-line"}`}
            >
              {s.label} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {loading && [0, 1, 2].map((i) => <SkeletonCard key={i} lines={3} />)}
        {!loading && visible.map((o) => (
          <button
            key={o.id}
            onClick={() => open(o.id)}
            className="card flex flex-col items-start gap-1 text-left active:bg-surface-hi"
          >
            <span className="text-base font-semibold">{o.orderNumber}</span>
            <span className="text-sm text-muted">{o.customer.shopName}</span>
            <span className="text-sm">{o.bill?.billNumber}</span>
            <span className="badge bg-line">{o.bill?.paymentStatus}</span>
            {o.status === "QC_IN_PROGRESS" && o.qcSessions[0]?.qcUser.name && (
              <span className="badge bg-amber-200">
                In progress by {o.qcSessions[0].qcUser.isYou ? "You" : o.qcSessions[0].qcUser.name}
              </span>
            )}
          </button>
        ))}
        {!loading && visible.length === 0 && <p className="text-muted">Nothing here</p>}
      </div>
    </div>
  );
}
