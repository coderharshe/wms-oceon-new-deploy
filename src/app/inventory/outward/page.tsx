"use client";

import { useState, useMemo, useEffect } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtTime } from "@/lib/fmt";
import {
  SearchableCustomerSelect,
  QuickProductSearchAdd,
  type BaseProduct,
  type BaseCustomer,
} from "@/components/SearchableSelect";

type InventoryMove = {
  id: string;
  movementType: "DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT" | "TRANSFER_IN";
  referenceType?: string | null;
  movementQty: number;
  beforeQty: number;
  afterQty: number;
  referenceId: string | null;
  timestamp: string;
  product: { id: string; name: string; sku: string; baseUnit: { symbol: string } };
  user: { name: string; staffId: string };
  warehouse: { name: string; code: string };
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category?: string | null;
  brand?: string | null;
  wholesalePrice?: string | number | null;
  baseUnit?: { id?: string; symbol?: string; name?: string } | null;
  saleUnits?: Array<{
    unitId: string;
    unit?: { id?: string; symbol?: string; name?: string } | null;
    factorToBase?: string | number;
  }>;
  available?: number | null;
};

type CustomerOrder = {
  id: string;
  orderNumber: string;
  offlineRef?: string | null;
  createdAt: string;
  bill?: {
    id: string;
    billNumber: string;
    paymentStatus?: string;
  } | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number | string;
    unitPrice: number | string;
    discount?: number | string;
    taxAmount?: number | string;
    lineTotal?: number | string;
    product: {
      id: string;
      name: string;
      sku: string;
      wholesalePrice?: number | string | null;
      baseUnit?: { id?: string; symbol?: string; name?: string } | null;
    };
    unit?: { id?: string; symbol?: string; name?: string } | null;
  }>;
};

type DraftMoveItem = {
  productId: string;
  productName: string;
  productSku: string;
  unitSymbol: string;
  quantity: number;
  originalPrice: number;
  discount: number;
  refundRate: number;
  notes?: string;
  orderNumber?: string;
};

export default function InventoryOutwardAndReturnsPage() {
  const { data, loading, error, reload } = useApiGet<InventoryMove[]>("/api/inventory/outward");
  const { data: productsData, loading: productsLoading } = useApiGet<Product[]>("/api/admin/products?limit=1000");
  const products = productsData || [];
  const { data: customersData, loading: customersLoading } = useApiGet<BaseCustomer[]>("/api/customers?limit=500");
  const customers = customersData || [];

  // Modal states
  const [modalMode, setModalMode] = useState<"INWARD_RETURN" | "OUTWARD_ISSUE" | null>(null);
  const [movementType, setMovementType] = useState<"DAMAGE" | "EXPIRY" | "RETURN" | "TRANSFER_OUT">("RETURN");

  // Customer & Reference states
  const [customerId, setCustomerId] = useState("");
  const [isCashCustomer, setIsCashCustomer] = useState(false);
  const [customCustomerName, setCustomCustomerName] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [reason, setReason] = useState("");

  // Orders for selected customer
  const { data: customerOrders, loading: ordersLoading } = useApiGet<CustomerOrder[]>(
    customerId ? `/api/finance/orders?customerId=${customerId}` : null
  );

  // Multi-item rows
  const [items, setItems] = useState<DraftMoveItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Filter & Search states
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Lock body scroll + Escape to close modal, F2 shortcut
  useEffect(() => {
    document.body.style.overflow = modalMode ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalMode]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && modalMode) {
        closeModal();
      }
      if (e.key === "F2" && !modalMode) {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
        if (!isTyping) {
          e.preventDefault();
          openInwardReturnModal();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalMode]);

  function addItemFromCatalog(prod: BaseProduct) {
    const p = products.find((x) => x.id === prod.id) || prod;
    const basePrice = Number(p.wholesalePrice || 0);
    const unitSym = p.baseUnit?.symbol || "Units";

    const existingIdx = items.findIndex((it) => it.productId === prod.id);
    if (existingIdx >= 0 && items[existingIdx]) {
      updateItemRow(existingIdx, {
        quantity: Number(items[existingIdx]?.quantity || 1) + 1,
      });
    } else {
      setItems((prev) => [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          productSku: prod.sku,
          unitSymbol: unitSym,
          quantity: 1,
          originalPrice: basePrice,
          discount: 0,
          refundRate: basePrice,
          notes: "",
        },
      ]);
    }
  }

  function addItemFromOrder(
    order: CustomerOrder,
    orderItem: CustomerOrder["items"][0]
  ) {
    const billedQty = Number(orderItem.quantity) || 1;
    const billedUnitPrice = Number(orderItem.unitPrice) || 0;
    const itemDiscount = Number(orderItem.discount) || 0;
    const netUnitPrice = Math.max(0, billedUnitPrice - itemDiscount / billedQty);
    const unitSym = orderItem.unit?.symbol || orderItem.product.baseUnit?.symbol || "Units";
    const billRef = order.bill?.billNumber || order.orderNumber;

    setOrderReference(billRef);

    const existingIdx = items.findIndex((it) => it.productId === orderItem.productId);
    if (existingIdx >= 0 && items[existingIdx]) {
      updateItemRow(existingIdx, {
        quantity: Number(items[existingIdx]?.quantity || 1) + 1,
        refundRate: netUnitPrice,
        originalPrice: billedUnitPrice,
        discount: itemDiscount / billedQty,
        orderNumber: billRef,
      });
    } else {
      setItems((prev) => [
        ...prev,
        {
          productId: orderItem.productId,
          productName: orderItem.product.name,
          productSku: orderItem.product.sku,
          unitSymbol: unitSym,
          quantity: billedQty > 1 ? 1 : billedQty,
          originalPrice: billedUnitPrice,
          discount: itemDiscount / billedQty,
          refundRate: netUnitPrice,
          notes: `Returned from Bill ${billRef}`,
          orderNumber: billRef,
        },
      ]);
    }
  }

  function addAllItemsFromOrder(order: CustomerOrder) {
    const billRef = order.bill?.billNumber || order.orderNumber;
    setOrderReference(billRef);

    const newRows: DraftMoveItem[] = order.items.map((it) => {
      const billedQty = Number(it.quantity) || 1;
      const billedUnitPrice = Number(it.unitPrice) || 0;
      const itemDiscount = Number(it.discount) || 0;
      const netUnitPrice = Math.max(0, billedUnitPrice - itemDiscount / billedQty);
      const unitSym = it.unit?.symbol || it.product.baseUnit?.symbol || "Units";

      return {
        productId: it.productId,
        productName: it.product.name,
        productSku: it.product.sku,
        unitSymbol: unitSym,
        quantity: billedQty,
        originalPrice: billedUnitPrice,
        discount: itemDiscount / billedQty,
        refundRate: netUnitPrice,
        notes: `Returned from Bill ${billRef}`,
        orderNumber: billRef,
      };
    });

    setItems(newRows);
  }

  function updateItemRow(index: number, patch: Partial<DraftMoveItem>) {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  function removeItemRow(index: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  }

  function openInwardReturnModal() {
    setModalMode("INWARD_RETURN");
    setMovementType("RETURN");
    setCustomerId("");
    setIsCashCustomer(false);
    setCustomCustomerName("");
    setOrderReference("");
    setSelectedOrderId("");
    setReason("");
    setFormError(null);
    setItems([]);
  }

  function openOutwardIssueModal() {
    setModalMode("OUTWARD_ISSUE");
    setMovementType("DAMAGE");
    setCustomerId("");
    setIsCashCustomer(false);
    setCustomCustomerName("");
    setOrderReference("");
    setSelectedOrderId("");
    setReason("");
    setFormError(null);
    setItems([]);
  }

  function closeModal() {
    setModalMode(null);
    setFormError(null);
    setItems([]);
    setSelectedOrderId("");
  }

  const totalQuantity = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
  }, [items]);

  const totalRefundValue = useMemo(() => {
    return items.reduce(
      (acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.refundRate) || 0),
      0
    );
  }, [items]);

  async function handleSubmitMovement(e: React.FormEvent) {
    e.preventDefault();

    if (items.length === 0) {
      return setFormError("Please add at least one product item to process");
    }

    for (const it of items) {
      if (!it.productId) {
        return setFormError("All items must have a valid product selected");
      }
      const q = Number(it.quantity);
      if (isNaN(q) || q <= 0) {
        return setFormError("All item quantities must be greater than 0");
      }
    }

    if (!reason.trim()) {
      return setFormError("Mandatory reason/audit remarks are required");
    }

    const isCustomerReturn = modalMode === "INWARD_RETURN";

    // Resolve customer description string
    let resolvedCustomerName = "";
    if (isCashCustomer) {
      resolvedCustomerName = customCustomerName.trim()
        ? `Cash / Walk-in: ${customCustomerName.trim()}`
        : "Cash / Walk-in Customer";
    } else if (customerId) {
      const cust = customers.find((c) => c.id === customerId);
      if (cust) {
        resolvedCustomerName = `${cust.shopName}${cust.ownerName ? ` (${cust.ownerName})` : ""}${cust.mobile ? ` - ${cust.mobile}` : ""
          }`;
      }
    }

    if (isCustomerReturn && !customerId && !isCashCustomer) {
      return setFormError("Please select a registered customer or choose the Cash / Walk-in option");
    }

    setSaving(true);
    setFormError(null);

    const payload = {
      direction: isCustomerReturn ? "INWARD" : "OUTWARD",
      movementType: isCustomerReturn ? "RETURN" : movementType,
      customerId: !isCashCustomer && customerId ? customerId : undefined,
      customerName: resolvedCustomerName || undefined,
      orderReference: orderReference.trim() || undefined,
      reason: `${reason.trim()}${isCustomerReturn && totalRefundValue > 0
          ? ` | Total Return Value: ₹${totalRefundValue.toFixed(2)}`
          : ""
        }`,
      items: items.map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        notes: [
          it.refundRate > 0 ? `Rate: ₹${it.refundRate.toFixed(2)}` : "",
          it.orderNumber ? `Ref: ${it.orderNumber}` : "",
          it.notes || "",
        ]
          .filter(Boolean)
          .join(" | "),
      })),
    };

    try {
      const res = await fetch("/api/inventory/outward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setSaving(false);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        return setFormError(b.error || "Failed to process inventory movement");
      }

      closeModal();
      reload();
    } catch (err: any) {
      setSaving(false);
      setFormError(err.message || "Network error while saving movement");
    }
  }

  const filteredMoves = useMemo(() => {
    let result = data ?? [];

    if (typeFilter !== "ALL") {
      if (typeFilter === "CUSTOMER_RETURN") {
        result = result.filter(
          (m) =>
            m.referenceType === "CUSTOMER_RETURN" ||
            (m.movementType === "RETURN" && Number(m.movementQty) > 0)
        );
      } else if (typeFilter === "SUPPLIER_RETURN") {
        result = result.filter(
          (m) =>
            m.movementType === "RETURN" &&
            (m.referenceType === "SUPPLIER_RETURN" || Number(m.movementQty) < 0)
        );
      } else {
        result = result.filter((m) => m.movementType === typeFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) =>
          m.product.name.toLowerCase().includes(q) ||
          m.product.sku.toLowerCase().includes(q) ||
          (m.referenceId && m.referenceId.toLowerCase().includes(q)) ||
          m.user.name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [data, typeFilter, searchQuery]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            Inventory Issue & Customer Returns
          </h1>
          <p className="text-xs text-muted mt-0.5">
            Record customer returns with order rate validation or deduct damaged, expired, and dispatched outward items.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary text-xs font-semibold px-3.5 py-1.5 flex items-center gap-1.5 shadow-sm bg-emerald-700 hover:bg-emerald-800 text-white"
            onClick={openInwardReturnModal}
          >
            <span>📥</span>
            <span>+ Inward Customer Return</span>
          </button>
          <button
            className="btn-secondary text-xs font-semibold px-3.5 py-1.5 flex items-center gap-1.5 shadow-xs border-line text-ink"
            onClick={openOutwardIssueModal}
          >
            <span>📤</span>
            <span>+ Record Outward Issue</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-surface-2/70 p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search SKU, name, customer, remarks…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input text-xs w-full py-1.5 pl-7 pr-2"
            />
            <span className="absolute left-2.5 top-2 text-muted text-xs">🔍</span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1.5 text-muted hover:text-ink text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setTypeFilter("ALL")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${typeFilter === "ALL"
                  ? "bg-accent text-white"
                  : "bg-surface text-ink hover:bg-surface-hi border border-line"
                }`}
            >
              All Movements
            </button>
            <button
              onClick={() => setTypeFilter("CUSTOMER_RETURN")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${typeFilter === "CUSTOMER_RETURN"
                  ? "bg-emerald-700 text-white"
                  : "bg-surface text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border border-line"
                }`}
            >
              📥 Customer Returns
            </button>
            <button
              onClick={() => setTypeFilter("DAMAGE")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${typeFilter === "DAMAGE"
                  ? "bg-rose-700 text-white"
                  : "bg-surface text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border border-line"
                }`}
            >
              ⚠️ Damaged Goods
            </button>
            <button
              onClick={() => setTypeFilter("EXPIRY")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${typeFilter === "EXPIRY"
                  ? "bg-amber-700 text-white"
                  : "bg-surface text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 border border-line"
                }`}
            >
              ⏳ Expired Goods
            </button>
            <button
              onClick={() => setTypeFilter("SUPPLIER_RETURN")}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${typeFilter === "SUPPLIER_RETURN"
                  ? "bg-purple-700 text-white"
                  : "bg-surface text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/20 border border-line"
                }`}
            >
              ↩️ Supplier Returns
            </button>
          </div>
        </div>

        <button
          onClick={reload}
          className="btn text-xs px-2.5 py-1.5 font-medium flex items-center gap-1"
          title="Refresh table"
        >
          🔄 Refresh
        </button>
      </div>

      {loading && <SkeletonTable rows={6} cols={7} />}
      {error && !data && <ErrorRetry message={error} onRetry={reload} />}

      {/* Modal: Customer Return OR Outward Issue */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs animate-fadeIn"
          onClick={closeModal}
        >
          <div
            className="card w-full max-w-5xl max-h-[92vh] flex flex-col p-0 shadow-2xl border-line rounded-xl overflow-hidden bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Sticky Header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-3 bg-surface-2/80 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">
                    {modalMode === "INWARD_RETURN" ? "📥" : "📤"}
                  </span>
                  <h2 className="text-sm font-bold text-ink">
                    {modalMode === "INWARD_RETURN"
                      ? "Record Inward Customer Return"
                      : "Record Outward Inventory Issue"}
                  </h2>
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  {modalMode === "INWARD_RETURN"
                    ? "Verify past customer order bills, retrieve discounted sale prices, and credit returned goods."
                    : "Deduct damaged, expired, transferred, or returned stock from active warehouse inventory."}
                </p>
              </div>
              <button
                className="text-muted hover:text-ink text-base p-1 rounded-md hover:bg-surface-hi transition-colors"
                onClick={closeModal}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Modal Body with Single Smooth Scroll */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-bad/10 text-bad border border-bad/20 text-xs font-medium">
                  {formError}
                </div>
              )}

              <form id="movement-form" onSubmit={handleSubmitMovement} className="space-y-4 text-xs">
                {/* Section 1: Customer Selection & Order Linking */}
                {modalMode === "INWARD_RETURN" ? (
                  <div className="space-y-3 bg-emerald-50/40 dark:bg-emerald-950/20 p-3.5 rounded-lg border border-emerald-500/20">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Customer Selector */}
                      <div>
                        <label className="mb-1 block font-semibold text-ink">
                          Select Customer <span className="text-rose-500">*</span>
                        </label>
                        <SearchableCustomerSelect
                          customers={customers}
                          selectedId={customerId}
                          isCashSelected={isCashCustomer}
                          onSelect={(c) => {
                            if (c) {
                              setCustomerId(c.id);
                              setIsCashCustomer(false);
                              setSelectedOrderId("");
                            } else {
                              setCustomerId("");
                              setIsCashCustomer(false);
                              setSelectedOrderId("");
                            }
                          }}
                          onSelectCash={() => {
                            setIsCashCustomer(true);
                            setCustomerId("");
                            setSelectedOrderId("");
                          }}
                          allowCashOption={true}
                          placeholder={customersLoading ? "Loading registered customers…" : "Search customer name, mobile, GSTIN…"}
                        />
                      </div>

                      {/* Invoice / Order Reference */}
                      <div>
                        <label className="mb-1 block font-semibold text-ink">
                          Invoice / Order Ref No.
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. BILL-2026-0042 / ORD-9812"
                          className="input w-full font-mono text-xs"
                          value={orderReference}
                          onChange={(e) => setOrderReference(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Cash Customer Custom Name Box */}
                    {isCashCustomer && (
                      <div className="p-2.5 bg-amber-50/90 dark:bg-amber-950/30 rounded border border-amber-300/50 flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-xs font-bold text-amber-900 dark:text-amber-300 whitespace-nowrap">
                          💵 Cash Buyer Info:
                        </span>
                        <input
                          type="text"
                          placeholder="Enter walk-in buyer name or counter note (optional)"
                          className="input flex-1 text-xs py-1"
                          value={customCustomerName}
                          onChange={(e) => setCustomCustomerName(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Past Invoices / Orders for Selected Customer */}
                    {customerId && (
                      <div className="pt-2 border-t border-emerald-500/20">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-xs text-ink flex items-center gap-1.5">
                            <span>🧾</span> Past Invoices for this Customer
                          </span>
                          {ordersLoading && (
                            <span className="text-[10px] text-muted animate-pulse">Loading orders…</span>
                          )}
                        </div>

                        {customerOrders && customerOrders.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1 bg-surface rounded-lg border border-line">
                            {customerOrders.map((ord) => {
                              const billRef = ord.bill?.billNumber || ord.orderNumber;
                              const isSelected = selectedOrderId === ord.id;
                              const itemCount = ord.items?.length || 0;

                              return (
                                <div
                                  key={ord.id}
                                  onClick={() => {
                                    setSelectedOrderId(ord.id);
                                    setOrderReference(billRef);
                                  }}
                                  className={`p-2 rounded-md border text-xs cursor-pointer transition-all ${isSelected
                                      ? "bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-500 ring-1 ring-emerald-500/50"
                                      : "bg-surface-2/60 hover:bg-surface-2 border-line"
                                    }`}
                                >
                                  <div className="flex items-center justify-between font-mono font-bold text-ink">
                                    <span className="text-accent">{billRef}</span>
                                    <span className="text-[10px] text-muted font-normal">
                                      {new Date(ord.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-muted mt-1">
                                    <span>{itemCount} billed product{itemCount > 1 ? "s" : ""}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        addAllItemsFromOrder(ord);
                                      }}
                                      className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
                                    >
                                      + Add all items
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : !ordersLoading ? (
                          <div className="p-2 bg-surface text-center rounded border border-line text-[11px] text-muted">
                            No prior billed orders found for this customer. You can add items directly below.
                          </div>
                        ) : null}

                        {/* Selected Order Item Breakdown */}
                        {selectedOrderId && (
                          <div className="mt-2.5 p-2.5 bg-surface rounded-lg border border-emerald-500/30 space-y-1.5">
                            <div className="font-semibold text-xs text-ink flex items-center justify-between">
                              <span>Available items in selected invoice:</span>
                              <span className="text-[11px] text-muted">
                                Click &quot;+ Return&quot; to import item at exact billed price
                              </span>
                            </div>
                            <div className="divide-y divide-line/60">
                              {customerOrders
                                ?.find((o) => o.id === selectedOrderId)
                                ?.items.map((it) => {
                                  const billedQty = Number(it.quantity) || 1;
                                  const billedUnitPrice = Number(it.unitPrice) || 0;
                                  const itemDiscount = Number(it.discount) || 0;
                                  const netPrice = Math.max(
                                    0,
                                    billedUnitPrice - itemDiscount / billedQty
                                  );

                                  return (
                                    <div
                                      key={it.id}
                                      className="py-1.5 flex items-center justify-between gap-2 text-xs"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="font-medium text-ink truncate">
                                          {it.product.name}
                                        </div>
                                        <div className="text-[10px] text-muted flex items-center gap-2">
                                          <span className="font-mono bg-surface-2 px-1 rounded">
                                            {it.product.sku}
                                          </span>
                                          <span>Billed Qty: {billedQty} {it.unit?.symbol || "Units"}</span>
                                          <span>Billed Rate: ₹{billedUnitPrice.toFixed(2)}</span>
                                          {itemDiscount > 0 && (
                                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                                              Discount: ₹{(itemDiscount / billedQty).toFixed(2)}/unit
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <div className="text-right font-mono">
                                          <div className="font-bold text-emerald-700 dark:text-emerald-400">
                                            ₹{netPrice.toFixed(2)}
                                          </div>
                                          <div className="text-[9px] text-muted">net unit rate</div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const ord = customerOrders.find(
                                              (o) => o.id === selectedOrderId
                                            );
                                            if (ord) addItemFromOrder(ord, it);
                                          }}
                                          className="btn text-xs py-1 px-2 bg-emerald-700 text-white hover:bg-emerald-800 font-semibold"
                                        >
                                          + Return
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 bg-surface-2/60 p-3.5 rounded-lg border border-line">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block font-semibold text-ink">
                          Outward Category <span className="text-rose-500">*</span>
                        </label>
                        <select
                          className="input w-full font-medium text-xs"
                          value={movementType}
                          onChange={(e) => setMovementType(e.target.value as any)}
                        >
                          <option value="DAMAGE">⚠️ Damaged Goods</option>
                          <option value="EXPIRY">⏳ Expired Stock</option>
                          <option value="RETURN">↩️ Supplier Return</option>
                          <option value="TRANSFER_OUT">🚚 Inter-FC Transfer</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block font-semibold text-ink">
                          Recipient / Customer (Optional)
                        </label>
                        <SearchableCustomerSelect
                          customers={customers}
                          selectedId={customerId}
                          isCashSelected={isCashCustomer}
                          onSelect={(c) => {
                            if (c) {
                              setCustomerId(c.id);
                              setIsCashCustomer(false);
                            } else {
                              setCustomerId("");
                              setIsCashCustomer(false);
                            }
                          }}
                          onSelectCash={() => {
                            setIsCashCustomer(true);
                            setCustomerId("");
                          }}
                          allowCashOption={true}
                          placeholder="Search customer / recipient…"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block font-semibold text-ink">
                          Ref No. / Dispatch Docket
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. DC-9841 / DMG-012"
                          className="input w-full font-mono text-xs"
                          value={orderReference}
                          onChange={(e) => setOrderReference(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 2: Items List & Rates (Clean Table with NO Scroll Traps) */}
                <div className="space-y-2 border-t border-line pt-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                        <span>📦</span> Items to {modalMode === "INWARD_RETURN" ? "Inward (Customer Return)" : "Outward (Deduct)"}
                      </h3>
                      <p className="text-[11px] text-muted">
                        Use the search bar below to add products directly into the return list.
                      </p>
                    </div>
                  </div>

                  {/* Clean Quick Product Search Bar */}
                  <QuickProductSearchAdd
                    products={products as BaseProduct[]}
                    placeholder="🔍 Type SKU or product name to add to table… (↑↓ Enter Esc)"
                    onAddProduct={(prod: BaseProduct) => addItemFromCatalog(prod)}
                  />

                  {/* Clean Responsive Table without Inner Scroll Trap */}
                  <div className="border border-line rounded-lg bg-surface">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-surface-2 border-b border-line text-[10px] text-muted uppercase">
                          <th className="py-2.5 px-3 min-w-[220px]">Product SKU / Name</th>
                          <th className="py-2.5 px-2 w-20 text-center">Unit</th>
                          {modalMode === "INWARD_RETURN" && (
                            <>
                              <th className="py-2.5 px-2 w-28 text-right">Billed Rate (₹)</th>
                              <th className="py-2.5 px-2 w-28 text-right">Return Rate (₹)</th>
                            </>
                          )}
                          <th className="py-2.5 px-2 w-24 text-right">Quantity</th>
                          {modalMode === "INWARD_RETURN" && (
                            <th className="py-2.5 px-3 w-32 text-right">Refund Total (₹)</th>
                          )}
                          <th className="py-2.5 px-3 min-w-[140px]">Item Note / Remarks</th>
                          <th className="py-2.5 px-2 text-center w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {items.length === 0 ? (
                          <tr>
                            <td
                              colSpan={modalMode === "INWARD_RETURN" ? 8 : 5}
                              className="text-center py-8 text-muted text-xs"
                            >
                              {productsLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                  <span className="animate-spin">⏳</span> Loading catalog…
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  <div className="font-medium text-ink">No items in the list yet</div>
                                  <div className="text-[11px] text-muted">
                                    Search for a product above or import from customer&apos;s past orders.
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : (
                          items.map((item, idx) => {
                            const lineTotalRefund =
                              (Number(item.quantity) || 0) * (Number(item.refundRate) || 0);

                            return (
                              <tr key={idx} className="hover:bg-surface-2/40 transition-colors">
                                <td className="py-2 px-3">
                                  <div className="font-semibold text-ink">{item.productName}</div>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted">
                                    <span className="font-mono bg-surface-2 px-1 rounded border border-line">
                                      {item.productSku}
                                    </span>
                                    {item.orderNumber && (
                                      <span className="text-emerald-700 dark:text-emerald-400 font-mono">
                                        Order: {item.orderNumber}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <span className="badge bg-surface-2 text-ink border border-line font-mono text-[11px]">
                                    {item.unitSymbol}
                                  </span>
                                </td>
                                {modalMode === "INWARD_RETURN" && (
                                  <>
                                    <td className="py-2 px-2 text-right font-mono text-muted text-xs">
                                      ₹{Number(item.originalPrice || 0).toFixed(2)}
                                      {item.discount > 0 && (
                                        <div className="text-[10px] text-amber-600">
                                          -₹{Number(item.discount).toFixed(2)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-right">
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={item.refundRate}
                                        onChange={(e) =>
                                          updateItemRow(idx, {
                                            refundRate: parseFloat(e.target.value) || 0,
                                          })
                                        }
                                        className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono font-bold text-xs"
                                        title="Adjust return price per unit"
                                      />
                                    </td>
                                  </>
                                )}
                                <td className="py-2 px-2 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      updateItemRow(idx, {
                                        quantity: parseFloat(e.target.value) || 0,
                                      })
                                    }
                                    className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono font-bold text-xs"
                                    required
                                  />
                                </td>
                                {modalMode === "INWARD_RETURN" && (
                                  <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400 text-xs">
                                    ₹{lineTotalRefund.toFixed(2)}
                                  </td>
                                )}
                                <td className="py-2 px-3">
                                  <input
                                    type="text"
                                    placeholder="e.g. Seal intact / Expired / Damaged"
                                    value={item.notes || ""}
                                    onChange={(e) => updateItemRow(idx, { notes: e.target.value })}
                                    className="w-full py-1 px-2 rounded border border-line bg-surface text-ink text-xs"
                                  />
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeItemRow(idx)}
                                    className="text-bad hover:text-red-700 font-bold p-1 transition-colors text-xs"
                                    title="Remove row"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Bar */}
                  {items.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                      <span className="text-muted">
                        Total Items: <strong>{items.length}</strong> product line{items.length > 1 ? "s" : ""}
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="bg-surface-2 px-3 py-1 rounded-md border border-line font-mono font-bold text-xs">
                          <span className="text-muted font-normal mr-1">Total Quantity:</span>
                          <span className="text-accent">{totalQuantity.toFixed(2)}</span>
                        </div>
                        {modalMode === "INWARD_RETURN" && (
                          <div className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 px-3.5 py-1 rounded-md border border-emerald-300 dark:border-emerald-800 font-mono font-bold text-xs">
                            <span className="font-normal mr-1">Total Refund Value:</span>
                            <span className="text-sm">₹{totalRefundValue.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 3: Mandatory Reason */}
                <div>
                  <label className="mb-1 block font-semibold text-ink">
                    Mandatory Reason / Audit Remarks <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder={
                      modalMode === "INWARD_RETURN"
                        ? "e.g. Customer returned unopened surplus stock with original packing"
                        : "e.g. Broken glass bottle during forklift movement in Aisle 3"
                    }
                    className="input w-full text-xs"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </div>
              </form>
            </div>

            {/* Modal Sticky Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-line bg-surface-2/80 shrink-0">
              <div className="text-xs text-muted">
                {modalMode === "INWARD_RETURN" && totalRefundValue > 0 && (
                  <span>
                    Net Return Value: <strong className="text-emerald-700 dark:text-emerald-300 font-mono">₹{totalRefundValue.toFixed(2)}</strong>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs px-3.5 py-1.5"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="movement-form"
                  className={`btn font-semibold text-xs px-4 py-1.5 text-white ${modalMode === "INWARD_RETURN"
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "btn-primary"
                    }`}
                  disabled={saving || items.length === 0}
                >
                  {saving
                    ? "Processing…"
                    : modalMode === "INWARD_RETURN"
                      ? `✓ Confirm Inward Return (${items.length} items)`
                      : `✓ Confirm Outward Deduction (${items.length} items)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Movements Table */}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2.5">Date & Time</th>
                <th className="py-2.5">Product SKU</th>
                <th className="py-2.5">Movement Type</th>
                <th className="py-2.5">Quantity Change</th>
                <th className="py-2.5">Stock After Move</th>
                <th className="py-2.5">Reason & Customer Info</th>
                <th className="py-2.5">Hub / Warehouse</th>
                <th className="py-2.5">Logged By</th>
              </tr>
            </thead>
            <tbody>
              {filteredMoves.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted text-xs">
                    No inventory movements found matching the current filter.
                  </td>
                </tr>
              ) : (
                filteredMoves.map((m) => {
                  const numQty = Number(m.movementQty);
                  const isInward =
                    numQty > 0 || m.referenceType === "CUSTOMER_RETURN";

                  return (
                    <tr
                      key={m.id}
                      className="border-b border-line/50 hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="py-2.5 text-muted font-mono whitespace-nowrap">
                        {fmtTime(m.timestamp)}
                      </td>
                      <td className="py-2.5 font-medium">
                        <div className="font-semibold text-ink">{m.product.name}</div>
                        <div className="text-[10px] text-muted font-mono">{m.product.sku}</div>
                      </td>
                      <td className="py-2.5">
                        {isInward ? (
                          <span className="badge text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            📥 CUSTOMER RETURN
                          </span>
                        ) : m.movementType === "DAMAGE" ? (
                          <span className="badge text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                            ⚠️ DAMAGE
                          </span>
                        ) : m.movementType === "EXPIRY" ? (
                          <span className="badge text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            ⏳ EXPIRY
                          </span>
                        ) : m.movementType === "RETURN" ? (
                          <span className="badge text-[11px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                            ↩️ SUPPLIER RETURN
                          </span>
                        ) : (
                          <span className="badge text-[11px] font-semibold bg-surface-2 text-ink border border-line">
                            🚚 {m.movementType}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-bold font-mono">
                        {isInward ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{Math.abs(numQty).toFixed(2)} {m.product.baseUnit.symbol}
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-400">
                            -{Math.abs(numQty).toFixed(2)} {m.product.baseUnit.symbol}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 font-medium font-mono">
                        {Number(m.afterQty).toFixed(2)} {m.product.baseUnit.symbol}
                      </td>
                      <td className="py-2.5 text-xs text-ink max-w-xs">
                        {m.referenceId || "—"}
                      </td>
                      <td className="py-2.5 text-muted font-mono text-[11px]">
                        {m.warehouse.name} ({m.warehouse.code})
                      </td>
                      <td className="py-2.5 text-muted text-[11px]">
                        {m.user.name}{" "}
                        <span className="font-mono text-[10px]">({m.user.staffId})</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
