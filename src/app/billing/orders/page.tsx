"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";
import { cacheOrderDetail, getCachedOrderDetail } from "@/lib/offline-catalog";
import { listLocalBills, subscribeSync, type LocalBill } from "@/lib/offline-bills";
import { filterSavedRows, unsyncedLocalRows, type ListRow as OrderRow } from "@/lib/offline-screens";
import { LocalBillOverlay } from "@/components/LocalBillView";
import CancelOrderDialog from "@/components/CancelOrderDialog";

type ExtendedOrderRow = Omit<OrderRow, "customer"> & {
  customer: { shopName: string; ownerName?: string | null; mobile?: string | null; type?: string | null } | null;
  sellingMode?: string;
  items?: { id: string; quantity: string; unitPrice: string; lineTotal: string; product: { name: string; sku: string } }[];
  bill?: {
    id: string;
    billNumber: string;
    paymentStatus: string;
    currentVersion: number;
    payment?: {
      id: string;
      amountDue: string;
      amountPaid: string;
      transactions?: { id: string; method: string; amount: string; status: string }[];
    } | null;
    versions?: { total: string; subtotal: string; discountTotal: string; taxTotal: string }[];
  } | null;
};

type SavedList = { rows: ExtendedOrderRow[]; savedAt: number };
const listKey = (params: string) => `orders-list:${params}`;

type InvoiceStatusTab = "ALL" | "PAID" | "UNPAID" | "PARTIAL" | "CANCELLED" | "RETURNED" | "REFUNDED";

export default function BillsAndOrdersPage() {
  const [activeTab, setActiveTab] = useState<InvoiceStatusTab>("ALL");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sellingMode, setSellingMode] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [cancelOrderTarget, setCancelOrderTarget] = useState<{ id: string; paid: number; orderNumber: string } | null>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (sellingMode) params.set("sellingMode", sellingMode);
  if (since) params.set("since", new Date(since).toISOString());
  if (until) params.set("until", new Date(until).toISOString());

  // Map active tab to backend query if applicable
  if (activeTab === "PAID") params.set("paymentStatus", "PAID");
  else if (activeTab === "UNPAID") params.set("paymentStatus", "UNPAID");
  else if (activeTab === "PARTIAL") params.set("paymentStatus", "PARTIALLY_PAID");
  else if (activeTab === "CANCELLED") params.set("status", "CANCELLED");
  else if (activeTab === "REFUNDED") params.set("paymentStatus", "REFUNDED");

  const { data, error, loading, reload } = useApiGet<ExtendedOrderRow[]>(`/api/finance/orders?${params}`);
  const [saved, setSaved] = useState<SavedList | null>(null);
  const [local, setLocal] = useState<LocalBill[]>([]);
  const [openLocal, setOpenLocal] = useState<string | null>(null);

  const filterKey = new URLSearchParams(params);
  filterKey.delete("q");
  const savedKey = listKey(String(filterKey));

  useEffect(() => {
    if (data && !q) void cacheOrderDetail(savedKey, { rows: data, savedAt: Date.now() } satisfies SavedList);
  }, [data, q, savedKey]);

  useEffect(() => {
    if (!error) return setSaved(null);
    let live = true;
    (async () => {
      const list = (await getCachedOrderDetail<SavedList>(savedKey)) ?? (await getCachedOrderDetail<SavedList>(listKey("")));
      if (live) setSaved(list && { ...list, rows: filterSavedRows(list.rows as OrderRow[], q, status) as ExtendedOrderRow[] });
    })();
    return () => {
      live = false;
    };
  }, [error, savedKey, q, status]);

  const unsyncedIds = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeSync(() => {
        listLocalBills()
          .then((bills) => {
            const landed = bills.some((b) => b.state === "synced" && unsyncedIds.current.has(b.requestId));
            unsyncedIds.current = new Set(bills.filter((b) => b.state !== "synced").map((b) => b.requestId));
            setLocal(bills);
            if (landed) reload();
          })
          .catch(() => setLocal([]));
      }),
    [reload]
  );

  const showingSaved = !!error && !!saved;
  const orders: ExtendedOrderRow[] = data ?? (showingSaved ? saved.rows : []);
  const waiting = unsyncedLocalRows(orders as OrderRow[], local, q);

  // Tab filtering client-side for immediate responsiveness & tabs like RETURNED
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (activeTab === "ALL") return true;
      if (activeTab === "PAID") return o.bill?.paymentStatus === "PAID";
      if (activeTab === "UNPAID") return o.bill?.paymentStatus === "UNPAID" || o.bill?.paymentStatus === "PENDING";
      if (activeTab === "PARTIAL") return o.bill?.paymentStatus === "PARTIALLY_PAID";
      if (activeTab === "CANCELLED") return o.status === "CANCELLED";
      if (activeTab === "RETURNED") {
        return (
          o.status === "QC_ADJUSTMENT_REQUIRED" ||
          o.status === "REFUND_REQUIRED" ||
          o.bill?.paymentStatus === "PAYMENT_ADJUSTMENT_REQUIRED"
        );
      }
      if (activeTab === "REFUNDED") return o.bill?.paymentStatus === "REFUNDED" || o.bill?.paymentStatus === "REFUND_DUE";
      return true;
    });
  }, [orders, activeTab]);

  // Aggregate KPI metrics
  const metrics = useMemo(() => {
    let totalBills = orders.length + waiting.length;
    let totalGross = 0;
    let totalCollected = 0;
    let totalPending = 0;
    let totalCancelled = 0;
    let totalRefunded = 0;

    for (const o of orders) {
      const due = Number(o.bill?.payment?.amountDue ?? o.bill?.versions?.[0]?.total ?? 0);
      const paid = Number(o.bill?.payment?.amountPaid ?? 0);
      if (o.status === "CANCELLED") {
        totalCancelled += due;
      } else {
        totalGross += due;
        totalCollected += paid;
        if (due > paid) totalPending += due - paid;
      }
      if (o.bill?.paymentStatus === "REFUNDED" || o.bill?.paymentStatus === "REFUND_DUE") {
        totalRefunded += due;
      }
    }

    for (const w of waiting) {
      totalGross += w.display.total;
      const cash = w.cash.reduce((s, c) => s + c.amountReceived, 0);
      totalCollected += Math.min(cash, w.display.total);
      if (w.display.total > cash) totalPending += w.display.total - cash;
    }

    return { totalBills, totalGross, totalCollected, totalPending, totalCancelled, totalRefunded };
  }, [orders, waiting]);

  function setPresetRange(range: "today" | "yesterday" | "week" | "month") {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (range === "today") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (range === "yesterday") {
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (range === "week") {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (range === "month") {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }

    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setSince(fmt(start));
    setUntil(fmt(end));
  }

  return (
    <div className="space-y-4">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-ink">Bills &amp; Invoices</h1>
          </div>

        </div>

        <div className="flex items-center gap-2">
          <Link href="/billing/new" className="btn-primary py-2 px-4 text-sm font-bold shadow-xs">
            ⚡ + New Bill (F10)
          </Link>
          <button type="button" className="btn text-xs font-semibold hover:bg-surface-hi" onClick={reload} title="Refresh records">
            🔄 Refresh
          </button>
        </div>
      </div>

      {showingSaved ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs" role="status">
          <span>⚠️ Showing cached local records from {fmtDateTime(new Date(saved.savedAt))} — Terminal is currently offline</span>
          <button type="button" className="btn text-xs font-semibold" onClick={reload}>
            Try Reconnecting
          </button>
        </div>
      ) : (
        error && <ErrorRetry message={error} onRetry={reload} />
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-muted">Total Bills</div>
          <div className="text-2xl font-black text-ink mt-0.5">{metrics.totalBills}</div>
          <div className="text-[10px] text-muted">Invoices generated</div>
        </div>

        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-muted">Gross Invoiced</div>
          <div className="text-2xl font-black text-ink mt-0.5">₹{metrics.totalGross.toFixed(2)}</div>
          <div className="text-[10px] text-muted">Total sales value</div>
        </div>

        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-good">Total Collected</div>
          <div className="text-2xl font-black text-good mt-0.5">₹{metrics.totalCollected.toFixed(2)}</div>
          <div className="text-[10px] text-good/80 font-medium">Settled tenders</div>
        </div>

        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-bad">Pending Due</div>
          <div className="text-2xl font-black text-bad mt-0.5">₹{metrics.totalPending.toFixed(2)}</div>
          <div className="text-[10px] text-bad/80 font-medium">Credit receivables</div>
        </div>

        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-muted">Cancelled</div>
          <div className="text-2xl font-black text-muted mt-0.5">₹{metrics.totalCancelled.toFixed(2)}</div>
          <div className="text-[10px] text-muted">Voided invoices</div>
        </div>

        <div className="card p-3 border border-line bg-paper shadow-xs">
          <div className="text-[11px] font-bold uppercase text-warn">Refunded</div>
          <div className="text-2xl font-black text-warn mt-0.5">₹{metrics.totalRefunded.toFixed(2)}</div>
          <div className="text-[10px] text-warn/80 font-medium">Customer refunds</div>
        </div>
      </div>

      {/* Invoice Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-2">
        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "ALL" ? "bg-ink text-surface shadow-xs" : "bg-paper text-muted hover:bg-surface-hi hover:text-ink"
            }`}
          onClick={() => setActiveTab("ALL")}
        >
          📑 All Bills ({orders.length + waiting.length})
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "PAID" ? "bg-good text-white shadow-xs" : "bg-paper text-good hover:bg-good/10"
            }`}
          onClick={() => setActiveTab("PAID")}
        >
          🟢 Paid Invoices ({orders.filter((o) => o.bill?.paymentStatus === "PAID").length})
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "UNPAID" ? "bg-bad text-white shadow-xs" : "bg-paper text-bad hover:bg-bad/10"
            }`}
          onClick={() => setActiveTab("UNPAID")}
        >
          🔴 Unpaid / Credit ({orders.filter((o) => o.bill?.paymentStatus === "UNPAID" || o.bill?.paymentStatus === "PENDING").length})
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "PARTIAL" ? "bg-warn text-ink shadow-xs" : "bg-paper text-warn hover:bg-warn/10"
            }`}
          onClick={() => setActiveTab("PARTIAL")}
        >
          🟡 Partial Paid ({orders.filter((o) => o.bill?.paymentStatus === "PARTIALLY_PAID").length})
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "CANCELLED" ? "bg-ink/80 text-surface shadow-xs" : "bg-paper text-muted hover:bg-surface-hi"
            }`}
          onClick={() => setActiveTab("CANCELLED")}
        >
          ⚪ Cancelled ({orders.filter((o) => o.status === "CANCELLED").length})
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "RETURNED" ? "bg-accent text-white shadow-xs" : "bg-paper text-accent hover:bg-accent/10"
            }`}
          onClick={() => setActiveTab("RETURNED")}
        >
          🔄 Returned / Adjustments
        </button>

        <button
          type="button"
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeTab === "REFUNDED" ? "bg-purple-600 text-white shadow-xs" : "bg-paper text-purple-700 hover:bg-purple-50"
            }`}
          onClick={() => setActiveTab("REFUNDED")}
        >
          🟣 Refunded
        </button>
      </div>

      {/* Advanced Search & Filtering Bar */}
      <div className="card p-3.5 space-y-2.5 border border-line bg-paper shadow-xs">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-muted">🔍 Universal Search</label>
            <input
              autoFocus
              className="w-full text-sm font-medium"
              placeholder="Search Invoice #, Order #, Customer, Phone, GSTIN…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">📦 Order Workflow Status</label>
            <select className="w-full text-sm font-medium" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Workflow Statuses</option>
              {[
                { value: "DRAFT", label: "Draft Bill" },
                { value: "BILLED", label: "Billed" },
                { value: "PAYMENT_PENDING", label: "Payment Pending" },
                { value: "PAID", label: "Paid" },
                { value: "READY_FOR_QC", label: "Ready for QC" },
                { value: "QC_IN_PROGRESS", label: "QC In Progress" },
                { value: "ADDITIONAL_PAYMENT_REQUIRED", label: "Additional Payment Needed" },
                { value: "REFUND_REQUIRED", label: "Refund Required" },
                { value: "READY_FOR_HANDOVER", label: "Ready for Handover" },
                { value: "COMPLETED", label: "Completed" },
                { value: "CANCELLED", label: "Cancelled / Void" },
              ].map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">🏷️ Price Mode</label>
            <select className="w-full text-sm font-medium" value={sellingMode} onChange={(e) => setSellingMode(e.target.value)}>
              <option value="">All Price Modes</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="RETAIL">Retail</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">📅 Date Range Presets</label>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn text-xs py-1 px-2 hover:bg-surface-hi" onClick={() => setPresetRange("today")}>
                Today
              </button>
              <button type="button" className="btn text-xs py-1 px-2 hover:bg-surface-hi" onClick={() => setPresetRange("yesterday")}>
                Yesterday
              </button>
              <button type="button" className="btn text-xs py-1 px-2 hover:bg-surface-hi" onClick={() => setPresetRange("week")}>
                7 Days
              </button>
              <button type="button" className="btn text-xs py-1 px-2 hover:bg-surface-hi" onClick={() => setPresetRange("month")}>
                This Month
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line/60 text-xs">
          <span className="font-bold text-muted">Custom Dates:</span>
          <input type="datetime-local" aria-label="From" className="text-xs" value={since} onChange={(e) => setSince(e.target.value)} />
          <span className="text-muted">to</span>
          <input type="datetime-local" aria-label="To" className="text-xs" value={until} onChange={(e) => setUntil(e.target.value)} />
          {(since || until) && (
            <button
              type="button"
              className="text-bad font-semibold hover:underline ml-1"
              onClick={() => {
                setSince("");
                setUntil("");
              }}
            >
              ✕ Clear Dates
            </button>
          )}
        </div>
      </div>

      {/* Orders and Bills Table */}
      {loading && waiting.length === 0 ? (
        <SkeletonTable rows={8} cols={8} />
      ) : (
        <div className="card overflow-x-auto p-0 border border-line shadow-xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-hi text-left text-xs font-bold text-muted uppercase tracking-wider">
                <th className="p-3">Invoice / Bill #</th>
                <th className="p-3">Order #</th>
                <th className="p-3">Customer / Retailer</th>
                <th className="p-3">Date &amp; Time</th>
                <th className="p-3 text-right">Bill Total (₹)</th>
                <th className="p-3 text-right">Paid (₹)</th>
                <th className="p-3 text-right">Due (₹)</th>
                <th className="p-3">Payment Status</th>
                <th className="p-3">Order Status</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {/* Unsynced Local POS Bills */}
              {waiting.map((b) => (
                <tr key={b.requestId} className="border-b border-line bg-amber-50/50 hover:bg-amber-100/50 transition-colors">
                  <td className="p-3 font-mono font-bold text-amber-900">
                    {b.server?.billNumber ?? b.offlineRef}
                    <div className="text-[10px] text-amber-700">Offline Till Slip</div>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted">{b.offlineRef}</td>
                  <td className="p-3">
                    <div className="font-bold text-ink">{b.display.customerName}</div>
                    {b.display.customerMobile && <div className="text-xs text-muted">📞 {b.display.customerMobile}</div>}
                  </td>
                  <td className="p-3 text-xs text-muted">{fmtDateTime(b.billedAt)}</td>
                  <td className="p-3 text-right font-bold text-ink">₹{b.display.total.toFixed(2)}</td>
                  <td className="p-3 text-right text-xs font-semibold text-good">
                    ₹{b.cash.reduce((s, c) => s + c.amountReceived, 0).toFixed(2)}
                  </td>
                  <td className="p-3 text-right text-xs font-semibold text-bad">
                    ₹{Math.max(0, b.display.total - b.cash.reduce((s, c) => s + c.amountReceived, 0)).toFixed(2)}
                  </td>
                  <td className="p-3">
                    <span className={`badge text-xs font-bold ${b.state === "attention" ? "bg-bad/15 text-bad border border-bad/30" : "bg-amber-100 text-amber-900 border border-amber-300"}`}>
                      {b.state === "attention" ? "⚠️ Needs Attention" : "⏳ Waiting Sync"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="badge bg-surface-hi text-muted text-xs">OFFLINE POS</span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      className="btn text-xs font-bold text-accent hover:bg-accent/10 py-1 px-2.5"
                      onClick={() => setOpenLocal(b.requestId)}
                    >
                      Open Slip
                    </button>
                  </td>
                </tr>
              ))}

              {/* Synchronized Server Bills & Orders */}
              {filteredOrders.map((o) => {
                const due = Number(o.bill?.payment?.amountDue ?? o.bill?.versions?.[0]?.total ?? 0);
                const paid = Number(o.bill?.payment?.amountPaid ?? 0);
                const bal = Math.max(0, due - paid);
                const payStatus = o.bill?.paymentStatus ?? (due === 0 ? "PAID" : "UNPAID");

                let payBadgeClass = "bg-bad/15 text-bad border border-bad/30";
                if (payStatus === "PAID") payBadgeClass = "bg-good/15 text-good border border-good/30";
                else if (payStatus === "PARTIALLY_PAID") payBadgeClass = "bg-warn/15 text-warn font-bold border border-warn/30";
                else if (payStatus === "REFUNDED") payBadgeClass = "bg-purple-100 text-purple-800 border border-purple-300";

                return (
                  <tr key={o.id} className="border-b border-line/70 hover:bg-surface-hi/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-ink">
                      {o.bill?.billNumber ? (
                        <Link href={`/billing/orders/${o.id}`} className="hover:text-accent hover:underline">
                          {o.bill.billNumber}
                        </Link>
                      ) : (
                        <span className="text-muted italic">Draft / No Bill</span>
                      )}
                      {o.sellingMode && (
                        <span className="block text-[10px] uppercase font-bold text-muted">{o.sellingMode}</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      <Link href={`/billing/orders/${o.id}`} className="text-accent font-semibold hover:underline">
                        {o.orderNumber}
                      </Link>
                      {o.offlineRef && <div className="text-[10px] text-muted">({o.offlineRef})</div>}
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-ink">{o.customer?.shopName || "Walk-in Customer"}</div>
                      <div className="text-xs text-muted">
                        {o.customer?.mobile ? `📞 ${o.customer.mobile}` : "Cash Sale"}
                        {o.customer?.type && <span className="ml-1 badge text-[10px] bg-surface-hi">{o.customer.type}</span>}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted whitespace-nowrap">{fmtDateTime(o.createdAt)}</td>
                    <td className="p-3 text-right font-bold text-base text-ink">₹{due.toFixed(2)}</td>
                    <td className="p-3 text-right text-xs font-bold text-good">₹{paid.toFixed(2)}</td>
                    <td className="p-3 text-right text-xs font-bold text-bad">
                      {bal > 0 ? `₹${bal.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3">
                      <span className={`badge text-xs font-bold ${payBadgeClass}`}>
                        {payStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`badge text-xs font-semibold ${o.status === "CANCELLED" ? "bg-bad/15 text-bad" : o.status === "COMPLETED" ? "bg-good/15 text-good" : "bg-surface-hi text-muted"}`}>
                        {o.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          href={`/billing/orders/${o.id}`}
                          className="btn text-xs font-bold text-accent hover:bg-accent/10 py-1 px-2.5"
                        >
                          View &amp; Print
                        </Link>
                        {["DRAFT", "BILLED", "PAYMENT_PENDING", "PAID"].includes(o.status) && (
                          <button
                            type="button"
                            className="btn text-xs font-bold text-bad hover:bg-bad/15 py-1 px-2.5 border-bad/40"
                            onClick={() => setCancelOrderTarget({ id: o.id, paid, orderNumber: o.orderNumber })}
                            title="Cancel this order"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredOrders.length === 0 && waiting.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-12 text-center text-muted">
                    <div className="text-3xl mb-2">🧾</div>
                    <div className="text-base font-bold text-ink">No bills or orders found</div>
                    <p className="text-xs mt-1">Try clearing your search query or selecting a different status tab above.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {openLocal && <LocalBillOverlay requestId={openLocal} onClose={() => setOpenLocal(null)} />}

      {cancelOrderTarget && (
        <CancelOrderDialog
          orderId={cancelOrderTarget.id}
          paid={cancelOrderTarget.paid}
          onClose={() => setCancelOrderTarget(null)}
          onDone={() => {
            setCancelOrderTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
