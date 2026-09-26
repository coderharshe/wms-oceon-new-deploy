"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";
import { fmtDate } from "@/lib/fmt";

type Supplier = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  contactPerson?: string | null;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  taxPercent: string | number;
  wholesalePrice: string | number;
  baseUnit: { id: string; symbol: string; name: string };
  saleUnits: Array<{
    unitId: string;
    unit: { id: string; symbol: string; name: string };
    factorToBase: string | number;
    wholesalePrice?: string | number | null;
  }>;
};

type PurchaseOrderItem = {
  id: string;
  productId: string;
  product: { id: string; name: string; sku: string };
  quantity: string | number;
  unit: { id: string; name: string; symbol: string };
  purchaseRate: string | number;
  taxPercent: string | number;
  lineTotal: string | number;
};

type PurchaseOrder = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplier: { id: string; name: string; phone?: string | null; contactPerson?: string | null };
  warehouseId: string;
  warehouse: { id: string; name: string; code: string };
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";
  subtotal: string | number;
  gstAmount: string | number;
  freightCharges: string | number;
  otherCharges: string | number;
  schemeDiscount: string | number;
  total: string | number;
  creditDays: number;
  expectedDelivery: string | null;
  notes?: string | null;
  createdAt: string;
  createdByUser?: { id: string; name: string; staffId?: string | null };
  items: PurchaseOrderItem[];
  purchaseBills?: Array<{ id: string; grnNumber: string; total: string | number; createdAt: string }>;
};

type Warehouse = { id: string; name: string; code: string };

export default function InventoryPurchaseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreatingPO, setIsCreatingPO] = useState(false);
  const [viewingPO, setViewingPO] = useState<PurchaseOrder | null>(null);

  // Fetch POs
  const { data: ordersData, error, loading, reload } = useApiGet<PurchaseOrder[]>("/api/procurement/orders");
  const orders = ordersData || [];

  // Fetch Suppliers and Warehouses for creating PO
  const { data: suppliersData } = useApiGet<Supplier[]>("/api/suppliers");
  const suppliers = suppliersData || [];

  const { data: warehousesData } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const warehouses = warehousesData || [];

  const { data: productsData, loading: productsLoading } = useApiGet<Product[]>("/api/admin/products");
  const products = productsData || [];

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let list = orders;
    if (statusFilter !== "ALL") {
      if (statusFilter === "PENDING") {
        list = list.filter((po) => po.status === "DRAFT" || po.status === "PENDING_APPROVAL");
      } else if (statusFilter === "ACTIVE") {
        list = list.filter((po) => po.status === "APPROVED" || po.status === "SENT" || po.status === "PARTIALLY_RECEIVED");
      } else {
        list = list.filter((po) => po.status === statusFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (po) =>
          po.poNumber.toLowerCase().includes(q) ||
          po.supplier.name.toLowerCase().includes(q) ||
          (po.warehouse && po.warehouse.name.toLowerCase().includes(q)) ||
          po.items.some((item) => item.product.name.toLowerCase().includes(q) || item.product.sku.toLowerCase().includes(q))
      );
    }
    return list;
  }, [orders, statusFilter, searchQuery]);

  // Form State for creating PO
  const [poForm, setPoForm] = useState({
    supplierId: "",
    warehouseId: "",
    creditDays: 0,
    expectedDelivery: "",
    freightCharges: 0,
    otherCharges: 0,
    notes: "",
  });

  type DraftItem = {
    productId: string;
    unitId: string;
    quantity: number;
    purchaseRate: number;
    taxPercent: number;
    schemeDiscount: number;
  };

  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-initialize first row if creating PO and products available
  useEffect(() => {
    if (isCreatingPO && draftItems.length === 0 && products.length > 0) {
      const firstP = products[0];
      if (firstP) {
        setDraftItems([
          {
            productId: firstP.id,
            unitId: firstP.baseUnit?.id || firstP.saleUnits?.[0]?.unitId || "",
            quantity: 1,
            purchaseRate: Number(firstP.wholesalePrice || 0),
            taxPercent: Number(firstP.taxPercent || 0),
            schemeDiscount: 0,
          },
        ]);
      }
    }
  }, [isCreatingPO, products]);

  // Quick Supplier Creator Modal inside PO form
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState("");
  const [newSupPhone, setNewSupPhone] = useState("");
  const [newSupGstin, setNewSupGstin] = useState("");

  async function handleCreateSupplier() {
    if (!newSupName.trim()) return;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSupName.trim(),
          phone: newSupPhone.trim() || undefined,
          gstin: newSupGstin.trim() || undefined,
        }),
      });
      if (res.ok) {
        const created: Supplier = await res.json();
        setPoForm((prev) => ({ ...prev, supplierId: created.id }));
        setShowNewSupplier(false);
        setNewSupName("");
        setNewSupPhone("");
        setNewSupGstin("");
      }
    } catch {
      // ignore
    }
  }

  function addProductRow() {
    if (!products || products.length === 0) return;
    const firstP = products[0];
    if (!firstP) return;
    setDraftItems((prev) => [
      ...prev,
      {
        productId: firstP.id,
        unitId: firstP.baseUnit?.id || firstP.saleUnits?.[0]?.unitId || "",
        quantity: 1,
        purchaseRate: Number(firstP.wholesalePrice || 0),
        taxPercent: Number(firstP.taxPercent || 0),
        schemeDiscount: 0,
      },
    ]);
  }

  function updateDraftItem(index: number, patch: Partial<DraftItem>) {
    setDraftItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== index) return it;
        const updated = { ...it, ...patch };

        // If product changed, update available units and default price
        if (patch.productId && patch.productId !== it.productId) {
          const p = products.find((x) => x.id === patch.productId);
          if (p) {
            updated.unitId = p.baseUnit?.id || p.saleUnits?.[0]?.unitId || "";
            updated.purchaseRate = Number(p.wholesalePrice || 0);
            updated.taxPercent = Number(p.taxPercent || 0);
          }
        }
        return updated;
      })
    );
  }

  function removeDraftItem(index: number) {
    setDraftItems((prev) => prev.filter((_, idx) => idx !== index));
  }

  // Calculated PO Grand Totals
  const totals = useMemo(() => {
    let subtotal = 0;
    let totalTax = 0;

    for (const item of draftItems) {
      const lineSub = item.quantity * item.purchaseRate - item.schemeDiscount;
      const tax = (lineSub * item.taxPercent) / 100;
      subtotal += lineSub;
      totalTax += tax;
    }

    const grandTotal =
      subtotal +
      totalTax +
      Number(poForm.freightCharges || 0) +
      Number(poForm.otherCharges || 0);

    return {
      subtotal: Math.max(0, subtotal),
      totalTax: Math.max(0, totalTax),
      grandTotal: Math.max(0, grandTotal),
    };
  }, [draftItems, poForm.freightCharges, poForm.otherCharges]);

  async function handleSavePO() {
    setFormError(null);
    if (!poForm.supplierId) {
      setFormError("Please select a supplier");
      return;
    }
    if (draftItems.length === 0) {
      setFormError("Please add at least one product item to the purchase order");
      return;
    }
    for (const it of draftItems) {
      if (!it.productId || it.quantity <= 0 || it.purchaseRate < 0) {
        setFormError("All items must have valid quantity and rate");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/procurement/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: poForm.supplierId,
          warehouseId: poForm.warehouseId || undefined,
          creditDays: Number(poForm.creditDays || 0),
          expectedDelivery: poForm.expectedDelivery || undefined,
          freightCharges: Number(poForm.freightCharges || 0),
          otherCharges: Number(poForm.otherCharges || 0),
          notes: poForm.notes || undefined,
          items: draftItems,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to create Purchase Order");
        setSubmitting(false);
        return;
      }

      setSubmitting(false);
      setIsCreatingPO(false);
      setDraftItems([]);
      setPoForm({
        supplierId: "",
        warehouseId: "",
        creditDays: 0,
        expectedDelivery: "",
        freightCharges: 0,
        otherCharges: 0,
        notes: "",
      });
      reload();
    } catch (e: any) {
      setSubmitting(false);
      setFormError(e.message || "Network error");
    }
  }

  function getStatusBadge(status: PurchaseOrder["status"]) {
    switch (status) {
      case "APPROVED":
        return <span className="badge bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">Approved</span>;
      case "SENT":
        return <span className="badge bg-blue-500/10 text-blue-700 border border-blue-500/30">Sent to Supplier</span>;
      case "PARTIALLY_RECEIVED":
        return <span className="badge bg-amber-500/10 text-amber-700 border border-amber-500/30">Partially Received</span>;
      case "RECEIVED":
      case "CLOSED":
        return <span className="badge bg-purple-500/10 text-purple-700 border border-purple-500/30">Received / Closed</span>;
      case "PENDING_APPROVAL":
        return <span className="badge bg-orange-500/10 text-orange-700 border border-orange-500/30">Pending Approval</span>;
      case "CANCELLED":
        return <span className="badge bg-rose-500/10 text-rose-700 border border-rose-500/30">Cancelled</span>;
      default:
        return <span className="badge bg-surface-2 text-muted border border-line">Draft</span>;
    }
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Purchase Orders (PO)</h1>
          <p className="text-xs text-muted mt-0.5">
            Create purchase orders, procure stock from suppliers, and track inward delivery into Hubs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/inventory/suppliers"
            className="btn text-xs font-semibold flex items-center gap-1.5 bg-surface-2 hover:bg-surface-hi border border-line"
          >
            <span>🚚</span> Suppliers Directory
          </Link>
          <button
            onClick={() => {
              setIsCreatingPO(true);
              if (draftItems.length === 0 && products.length > 0) {
                addProductRow();
              }
            }}
            className="btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <span>+</span> Create Purchase Order
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
          {[
            { id: "ALL", label: "All Orders" },
            { id: "ACTIVE", label: "Active & In-Transit" },
            { id: "PENDING", label: "Pending" },
            { id: "RECEIVED", label: "Received / Closed" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                statusFilter === tab.id
                  ? "bg-accent text-white shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="🔍 Search PO #, Supplier, Product…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-xs py-1.5 px-3 rounded border border-line bg-surface-2 text-ink w-64"
          />
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Orders Table */}
      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : (
        <div className="card p-0 overflow-x-auto border border-line">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-muted uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 font-semibold">PO Number</th>
                <th className="py-2.5 px-3 font-semibold">Supplier</th>
                <th className="py-2.5 px-3 font-semibold">Hub / Warehouse</th>
                <th className="py-2.5 px-3 font-semibold">Items</th>
                <th className="py-2.5 px-3 text-right font-semibold">Total Amount</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Expected Date</th>
                <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No purchase orders found. Click <strong>"+ Create Purchase Order"</strong> to create one.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-surface-2/60 transition-colors">
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => setViewingPO(po)}
                        className="text-left font-mono font-bold text-accent hover:underline hover:text-accent-hi cursor-pointer transition-colors block"
                        title="Click to view Purchase Order details"
                      >
                        {po.poNumber}
                      </button>
                      <div className="text-[10px] text-muted font-normal">{fmtDate(po.createdAt)}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-ink">{po.supplier.name}</div>
                      {po.supplier.phone && (
                        <div className="text-[10px] text-muted">{po.supplier.phone}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-ink">
                      <span className="font-medium">{po.warehouse?.name || "All Hubs"}</span>
                      <span className="text-[10px] text-muted block font-mono">{po.warehouse?.code}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted">
                      <div>
                        {po.items.length} {po.items.length === 1 ? "Product" : "Products"}
                      </div>
                      <div className="text-[10px] text-muted/80 truncate max-w-[150px]">
                        {po.items.map((i) => i.product.name).join(", ")}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-ink">
                      ₹{Number(po.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3">{getStatusBadge(po.status)}</td>
                    <td className="py-2.5 px-3 text-muted">
                      {po.expectedDelivery ? fmtDate(po.expectedDelivery) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setViewingPO(po)}
                          className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink font-medium"
                        >
                          View
                        </button>
                        {(po.status === "APPROVED" || po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && (
                          <Link
                            href={`/inventory/grn?poId=${po.id}`}
                            className="px-2 py-1 text-xs rounded bg-good/10 text-good hover:bg-good/20 font-semibold border border-good/30"
                          >
                            📥 Receive GRN
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE PURCHASE ORDER MODAL */}
      {isCreatingPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsCreatingPO(false)}>
          <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 bg-surface border border-line shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Create Purchase Order</h2>
                <div className="text-xs text-muted">Order products from authorized suppliers into the warehouse.</div>
              </div>
              <button onClick={() => setIsCreatingPO(false)} className="text-muted hover:text-ink font-bold text-sm">
                ✕
              </button>
            </div>

            {/* PO Master Details */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-muted">Supplier *</label>
                  <button
                    type="button"
                    onClick={() => setShowNewSupplier(true)}
                    className="text-[10px] text-accent font-semibold hover:underline"
                  >
                    + New Supplier
                  </button>
                </div>
                <select
                  value={poForm.supplierId}
                  onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}
                  className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink font-medium"
                >
                  <option value="">Select Supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-muted mb-1">Target Hub / Warehouse</label>
                <select
                  value={poForm.warehouseId}
                  onChange={(e) => setPoForm({ ...poForm, warehouseId: e.target.value })}
                  className="w-full py-1.5 px-2 rounded border border-line bg-surface-2 text-ink"
                >
                  <option value="">Default Warehouse</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-muted mb-1">Expected Delivery Date</label>
                <input
                  type="date"
                  value={poForm.expectedDelivery}
                  onChange={(e) => setPoForm({ ...poForm, expectedDelivery: e.target.value })}
                  className="w-full py-1 px-2 rounded border border-line bg-surface-2 text-ink"
                />
              </div>
            </div>

            {/* Inline Quick Supplier Creator */}
            {showNewSupplier && (
              <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg space-y-2 text-xs">
                <div className="font-semibold text-accent flex items-center justify-between">
                  <span>Quick Add New Supplier:</span>
                  <button onClick={() => setShowNewSupplier(false)} className="text-muted hover:text-ink">✕</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Supplier Name *"
                    value={newSupName}
                    onChange={(e) => setNewSupName(e.target.value)}
                    className="py-1 px-2 rounded border border-line bg-surface text-ink"
                  />
                  <input
                    type="text"
                    placeholder="Phone Number"
                    value={newSupPhone}
                    onChange={(e) => setNewSupPhone(e.target.value)}
                    className="py-1 px-2 rounded border border-line bg-surface text-ink"
                  />
                  <input
                    type="text"
                    placeholder="GSTIN"
                    value={newSupGstin}
                    onChange={(e) => setNewSupGstin(e.target.value)}
                    className="py-1 px-2 rounded border border-line bg-surface text-ink"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateSupplier}
                    disabled={!newSupName.trim()}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    Save Supplier
                  </button>
                </div>
              </div>
            )}

            {/* Product Items Table */}
            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Order Items</h3>
                <button
                  type="button"
                  onClick={addProductRow}
                  className="btn text-xs py-1 px-2.5 bg-surface-2 hover:bg-surface-hi border border-line font-semibold"
                >
                  + Add Product Row
                </button>
              </div>

              <div className="overflow-x-auto border border-line rounded">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-2 border-b border-line text-[10px] text-muted uppercase">
                      <th className="py-2 px-2.5">Product</th>
                      <th className="py-2 px-2.5">Unit</th>
                      <th className="py-2 px-2.5 text-right w-20">Qty</th>
                      <th className="py-2 px-2.5 text-right w-24">Rate (₹)</th>
                      <th className="py-2 px-2.5 text-right w-16">Tax %</th>
                      <th className="py-2 px-2.5 text-right w-24">Total (₹)</th>
                      <th className="py-2 px-2 text-center w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {draftItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-6 text-muted text-xs">
                          {productsLoading ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="animate-spin">⏳</span> Loading product catalog…
                            </span>
                          ) : products.length === 0 ? (
                            <span>No products found in catalog. Please check your product inventory.</span>
                          ) : (
                            <div className="space-y-1">
                              <div>No items added to this purchase order yet.</div>
                              <button
                                type="button"
                                onClick={addProductRow}
                                className="text-accent underline font-semibold hover:text-accent-hi"
                              >
                                + Add first product item
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      draftItems.map((item, idx) => {
                        const currentProduct = products.find((p) => p.id === item.productId);
                        const availableUnits = currentProduct
                          ? [
                              ...(currentProduct.baseUnit ? [currentProduct.baseUnit] : []),
                              ...(currentProduct.saleUnits || []).map((su) => su.unit).filter(Boolean),
                            ]
                          : [];

                        const lineSub = item.quantity * item.purchaseRate - item.schemeDiscount;
                        const lineTax = (lineSub * item.taxPercent) / 100;
                        const lineTotal = lineSub + lineTax;

                        return (
                          <tr key={idx}>
                            <td className="p-1.5">
                              <select
                                value={item.productId}
                                onChange={(e) => updateDraftItem(idx, { productId: e.target.value })}
                                className="w-full py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs font-medium"
                              >
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.sku})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1.5">
                              <select
                                value={item.unitId}
                                onChange={(e) => updateDraftItem(idx, { unitId: e.target.value })}
                                className="py-1 px-1.5 rounded border border-line bg-surface text-ink text-xs"
                              >
                                {availableUnits.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.symbol}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="1"
                                step="any"
                                value={item.quantity}
                                onChange={(e) => updateDraftItem(idx, { quantity: Number(e.target.value) })}
                                className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono font-bold"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={item.purchaseRate}
                                onChange={(e) => updateDraftItem(idx, { purchaseRate: Number(e.target.value) })}
                                className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.taxPercent}
                                onChange={(e) => updateDraftItem(idx, { taxPercent: Number(e.target.value) })}
                                className="w-full text-right py-1 px-1.5 rounded border border-line bg-surface text-ink font-mono"
                              />
                            </td>
                            <td className="p-1.5 text-right font-mono font-bold text-ink">
                              ₹{lineTotal.toFixed(2)}
                            </td>
                            <td className="p-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeDraftItem(idx)}
                                className="text-bad hover:text-red-700 font-bold p-1"
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
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
              <div>
                <label className="block text-muted font-medium mb-1">Notes / Instructions</label>
                <textarea
                  rows={2}
                  value={poForm.notes}
                  onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                  placeholder="Payment terms, delivery instructions, transporter details…"
                  className="w-full p-2 rounded border border-line bg-surface text-ink text-xs"
                />
              </div>

              <div className="p-3 rounded-lg bg-surface-2 border border-line space-y-1.5 font-mono text-xs">
                <div className="flex justify-between text-muted">
                  <span>Subtotal:</span>
                  <span>₹{totals.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>GST / Tax:</span>
                  <span>+₹{totals.totalTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm text-ink border-t border-line/60 pt-1.5">
                  <span>Grand Total:</span>
                  <span className="text-accent">₹{totals.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {formError && <div className="text-bad text-xs font-semibold">{formError}</div>}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setIsCreatingPO(false)}
                disabled={submitting}
                className="btn text-xs py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePO}
                disabled={submitting || draftItems.length === 0}
                className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs"
              >
                {submitting ? "Saving PO…" : "Issue Purchase Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PURCHASE ORDER DETAILS MODAL */}
      {viewingPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setViewingPO(null)}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-4 bg-surface border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold font-mono text-ink">{viewingPO.poNumber}</h2>
                  {getStatusBadge(viewingPO.status)}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Supplier: <strong className="text-ink">{viewingPO.supplier.name}</strong> • Issued on: {fmtDate(viewingPO.createdAt)}
                </div>
              </div>
              <button onClick={() => setViewingPO(null)} className="text-muted hover:text-ink font-bold text-sm p-1">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-surface-2 p-3 rounded-lg border border-line">
              <div>
                <span className="text-muted block text-[11px]">Delivery Target Hub:</span>
                <strong className="text-ink">{viewingPO.warehouse?.name || "Main Warehouse"}</strong> {viewingPO.warehouse?.code && <span className="font-mono text-muted">({viewingPO.warehouse.code})</span>}
              </div>
              <div>
                <span className="text-muted block text-[11px]">Expected Delivery Date:</span>
                <strong className="text-ink">{viewingPO.expectedDelivery ? fmtDate(viewingPO.expectedDelivery) : "Immediate / On Demand"}</strong>
              </div>
              {viewingPO.supplier.phone && (
                <div>
                  <span className="text-muted block text-[11px]">Supplier Contact:</span>
                  <span className="font-mono text-ink">{viewingPO.supplier.phone}</span> {viewingPO.supplier.contactPerson && `(${viewingPO.supplier.contactPerson})`}
                </div>
              )}
              {viewingPO.createdByUser && (
                <div>
                  <span className="text-muted block text-[11px]">Created By:</span>
                  <span className="text-ink font-medium">{viewingPO.createdByUser.name}</span>
                </div>
              )}
              {viewingPO.notes && (
                <div className="col-span-1 sm:col-span-2 text-muted italic border-t border-line/60 pt-1.5 mt-1">
                  <strong>Notes:</strong> {viewingPO.notes}
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Ordered Products & Line Pricing:</h4>
              <div className="border border-line rounded overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-surface-2 text-[10px] text-muted uppercase">
                    <tr className="border-b border-line">
                      <th className="p-2">Product SKU / Name</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Purchase Rate (₹)</th>
                      <th className="p-2 text-right">Tax %</th>
                      <th className="p-2 text-right">Line Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {viewingPO.items.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-2/40">
                        <td className="p-2">
                          <div className="font-semibold text-ink">{item.product.name}</div>
                          <div className="text-[10px] text-muted font-mono">{item.product.sku}</div>
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-ink">
                          {item.quantity} {item.unit.symbol}
                        </td>
                        <td className="p-2 text-right font-mono text-muted">
                          ₹{Number(item.purchaseRate).toFixed(2)}
                        </td>
                        <td className="p-2 text-right font-mono text-muted">
                          {item.taxPercent ? `${item.taxPercent}%` : "0%"}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-ink">
                          ₹{Number(item.lineTotal).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="flex justify-between items-center bg-surface-2 p-3 rounded-lg border border-line font-mono text-xs">
              <div className="space-y-0.5 text-muted text-[11px]">
                <div>Subtotal: ₹{Number(viewingPO.subtotal || 0).toFixed(2)}</div>
                <div>GST / Tax: +₹{Number(viewingPO.gstAmount || 0).toFixed(2)}</div>
                {Number(viewingPO.freightCharges || 0) > 0 && (
                  <div>Freight: +₹{Number(viewingPO.freightCharges).toFixed(2)}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted uppercase font-bold">Total Order Value</div>
                <div className="text-base font-bold text-accent">
                  ₹{Number(viewingPO.total).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => window.print()}
                className="btn text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <span>🖨️</span> Print PO
              </button>

              <div className="flex items-center gap-2">
                {(viewingPO.status === "APPROVED" || viewingPO.status === "SENT" || viewingPO.status === "PARTIALLY_RECEIVED") && (
                  <Link
                    href={`/inventory/grn?poId=${viewingPO.id}`}
                    className="btn-primary text-xs py-1.5 px-3 font-semibold shadow-xs"
                  >
                    📥 Inward / Receive GRN
                  </Link>
                )}
                <button onClick={() => setViewingPO(null)} className="btn text-xs py-1.5 px-3">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
