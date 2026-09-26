"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";
import { fmtDate } from "@/lib/fmt";

export type Supplier = {
  id: string;
  name: string;
  category?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  gstin?: string | null;
  paymentTerms?: string | null;
  bankDetails?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  supplyType?: "INWARD" | "OUTWARD" | "BOTH" | string | null;
  creditDays?: number;
  creditLimit?: number | string | null;
  notes?: string | null;
  active: boolean;
  bills?: number;
  outstanding?: number;
  lastBillDate?: string | null;
};

export default function InventorySuppliersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [tabFilter, setTabFilter] = useState<"ALL" | "ACTIVE" | "NEAR_LIMIT" | "HAS_DUES" | "INACTIVE">("ALL");

  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);

  const { data: suppliersData, error, loading, reload } = useApiGet<Supplier[]>("/api/suppliers?withCredit=1&includeInactive=1");
  const suppliers = suppliersData || [];

  // Distinct categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of suppliers) {
      if (s.category) {
        s.category.split(",").forEach((c) => {
          const trimmed = c.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    }
    return Array.from(set).sort();
  }, [suppliers]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let list = suppliers;

    if (tabFilter === "ACTIVE") list = list.filter((s) => s.active);
    else if (tabFilter === "INACTIVE") list = list.filter((s) => !s.active);
    else if (tabFilter === "HAS_DUES") list = list.filter((s) => Number(s.outstanding || 0) > 0);
    else if (tabFilter === "NEAR_LIMIT") {
      list = list.filter((s) => {
        const limit = Number(s.creditLimit || 0);
        const out = Number(s.outstanding || 0);
        return limit > 0 && out / limit >= 0.8;
      });
    }

    if (categoryFilter !== "ALL") {
      list = list.filter((s) => s.category?.toLowerCase().includes(categoryFilter.toLowerCase()));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
          (s.phone && s.phone.includes(q)) ||
          (s.gstin && s.gstin.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (s.city && s.city.toLowerCase().includes(q)) ||
          (s.state && s.state.toLowerCase().includes(q)) ||
          (s.category && s.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [suppliers, tabFilter, categoryFilter, searchQuery]);

  // Overall Statistics
  const stats = useMemo(() => {
    let totalOutstanding = 0;
    let totalCreditLimit = 0;
    let nearLimitCount = 0;
    let activeCount = 0;

    for (const s of suppliers) {
      if (s.active) activeCount++;
      const out = Number(s.outstanding || 0);
      const limit = Number(s.creditLimit || 0);
      totalOutstanding += out;
      totalCreditLimit += limit;
      if (limit > 0 && out / limit >= 0.8) {
        nearLimitCount++;
      }
    }

    return {
      activeCount,
      totalOutstanding,
      totalCreditLimit,
      nearLimitCount,
    };
  }, [suppliers]);

  // Form state for Add/Edit
  const initialFormState = {
    name: "",
    category: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    gstin: "",
    paymentTerms: "Regular",
    bankDetails: "",
    contractStart: "",
    contractEnd: "",
    supplyType: "INWARD",
    creditDays: 30,
    creditLimit: "",
    notes: "",
    active: true,
  };

  const [form, setForm] = useState(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openAddModal() {
    setForm(initialFormState);
    setFormError(null);
    setEditingSupplier(null);
    setIsAddingSupplier(true);
  }

  function openEditModal(s: Supplier) {
    setEditingSupplier(s);
    setFormError(null);
    setForm({
      name: s.name || "",
      category: s.category || "",
      contactPerson: s.contactPerson || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      city: s.city || "",
      state: s.state || "",
      gstin: s.gstin || "",
      paymentTerms: s.paymentTerms || "Regular",
      bankDetails: s.bankDetails || "",
      contractStart: s.contractStart ? s.contractStart.slice(0, 10) : "",
      contractEnd: s.contractEnd ? s.contractEnd.slice(0, 10) : "",
      supplyType: s.supplyType || "INWARD",
      creditDays: s.creditDays || 30,
      creditLimit: s.creditLimit != null ? String(s.creditLimit) : "",
      notes: s.notes || "",
      active: s.active ?? true,
    });
    setIsAddingSupplier(true);
  }

  async function handleSaveSupplier() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Supplier / Distributor Name is required");
      return;
    }

    setSaving(true);
    try {
      const url = editingSupplier ? `/api/suppliers/${editingSupplier.id}` : "/api/suppliers";
      const method = editingSupplier ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          contactPerson: form.contactPerson.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          gstin: form.gstin.trim() || undefined,
          paymentTerms: form.paymentTerms.trim() || undefined,
          bankDetails: form.bankDetails.trim() || undefined,
          contractStart: form.contractStart || undefined,
          contractEnd: form.contractEnd || undefined,
          supplyType: form.supplyType || "INWARD",
          creditDays: Number(form.creditDays || 0),
          creditLimit: form.creditLimit ? parseFloat(form.creditLimit) : null,
          notes: form.notes.trim() || undefined,
          active: form.active,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to save supplier details");
        setSaving(false);
        return;
      }

      setSaving(false);
      setIsAddingSupplier(false);
      setEditingSupplier(null);
      reload();
    } catch (e: any) {
      setSaving(false);
      setFormError(e.message || "Network error");
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Suppliers & Vendor Directory</h1>
          <p className="text-xs text-muted mt-0.5">
            Complete vendor master with credit limits, payment terms, contracts, banking details, and overdue payables tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/inventory/purchase-orders"
            className="btn text-xs font-semibold flex items-center gap-1.5 bg-surface-2 hover:bg-surface-hi border border-line"
          >
            <span>📑</span> Purchase Orders
          </Link>
          <button
            onClick={openAddModal}
            className="btn-primary text-xs font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <span>+</span> Add Supplier
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-3 bg-surface-2/60 border border-line flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Active Suppliers</span>
          <div className="mt-1 text-2xl font-bold text-ink">{stats.activeCount} <span className="text-xs font-normal text-muted">/ {suppliers.length}</span></div>
        </div>

        <div className="card p-3 bg-surface-2/60 border border-line flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Total Outstanding Dues</span>
          <div className="mt-1 text-2xl font-bold text-bad font-mono">
            ₹{stats.totalOutstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="card p-3 bg-surface-2/60 border border-line flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Total Credit Limit</span>
          <div className="mt-1 text-2xl font-bold text-ink font-mono">
            ₹{stats.totalCreditLimit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className={`card p-3 border flex flex-col justify-between ${stats.nearLimitCount > 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-surface-2/60 border-line"}`}>
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Near Credit Limit (≥80%)</span>
          <div className={`mt-1 text-2xl font-bold ${stats.nearLimitCount > 0 ? "text-amber-600" : "text-good"}`}>
            {stats.nearLimitCount} {stats.nearLimitCount > 0 && <span className="text-xs font-normal">Action Required</span>}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
          {[
            { id: "ALL", label: "All Vendors" },
            { id: "ACTIVE", label: "Active" },
            { id: "HAS_DUES", label: "With Dues" },
            { id: "NEAR_LIMIT", label: "Near Credit Limit" },
            { id: "INACTIVE", label: "Inactive" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTabFilter(tab.id as any)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                tabFilter === tab.id ? "bg-surface text-accent shadow-xs border border-line" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs py-1.5 px-2 rounded border border-line bg-surface text-ink font-medium"
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}

          <input
            type="text"
            placeholder="🔍 Search name, contact, phone, GSTIN, city…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-xs py-1.5 px-3 rounded border border-line bg-surface text-ink w-64 lg:w-80"
          />
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Complete Suppliers Table */}
      {loading ? (
        <SkeletonTable rows={8} cols={9} />
      ) : (
        <div className="card p-0 overflow-x-auto border border-line shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-muted uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3 font-semibold">Supplier / Distributors</th>
                <th className="py-2.5 px-2.5 font-semibold">Category</th>
                <th className="py-2.5 px-2.5 font-semibold">Contact Person & Phone</th>
                <th className="py-2.5 px-2.5 font-semibold">Email</th>
                <th className="py-2.5 px-2.5 font-semibold">City / State</th>
                <th className="py-2.5 px-2.5 font-semibold">GSTIN / PAN</th>
                <th className="py-2.5 px-2.5 font-semibold">Payment Terms</th>
                <th className="py-2.5 px-2.5 text-right font-semibold">Outstanding / Credit Limit</th>
                <th className="py-2.5 px-2.5 text-center font-semibold">Supply Type</th>
                <th className="py-2.5 px-2.5 font-semibold">Status</th>
                <th className="py-2.5 px-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-muted">
                    No suppliers match the selected filters. Click <strong>"+ Add Supplier"</strong> to register a new vendor.
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((s) => {
                  const out = Number(s.outstanding || 0);
                  const limit = Number(s.creditLimit || 0);
                  const ratio = limit > 0 ? (out / limit) * 100 : 0;
                  const isHighRisk = limit > 0 && ratio >= 80;

                  return (
                    <tr key={s.id} className="hover:bg-surface-2/60 transition-colors">
                      {/* Supplier Name */}
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-ink hover:text-accent cursor-pointer" onClick={() => setViewingSupplier(s)}>
                          {s.name}
                        </div>
                        {s.contractEnd && (
                          <div className="text-[10px] text-muted">
                            Contract till: {fmtDate(s.contractEnd)}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-2.5">
                        {s.category ? (
                          <span className="badge bg-surface-2 text-ink font-medium border border-line text-[10px]">
                            {s.category}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Contact & Phone */}
                      <td className="py-2.5 px-2.5">
                        <div className="font-medium text-ink">{s.contactPerson || "—"}</div>
                        {s.phone && <div className="text-[11px] font-mono text-muted">{s.phone}</div>}
                      </td>

                      {/* Email */}
                      <td className="py-2.5 px-2.5 text-muted">
                        {s.email ? (
                          <a href={`mailto:${s.email}`} className="hover:text-accent hover:underline">
                            {s.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Location */}
                      <td className="py-2.5 px-2.5">
                        <div className="text-ink font-medium">{s.city || "—"}</div>
                        {s.state && <div className="text-[10px] text-muted">{s.state}</div>}
                      </td>

                      {/* GSTIN */}
                      <td className="py-2.5 px-2.5 font-mono text-xs text-muted">
                        {s.gstin || "—"}
                      </td>

                      {/* Payment Terms */}
                      <td className="py-2.5 px-2.5">
                        <div className="text-ink font-medium">{s.paymentTerms || "Regular"}</div>
                        <div className="text-[10px] text-muted font-mono">{s.creditDays ? `${s.creditDays} Days Credit` : "Immediate / Net 0"}</div>
                      </td>

                      {/* Outstanding vs Credit Limit */}
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        <div className="font-bold text-ink">
                          {out > 0 ? (
                            <span className={isHighRisk ? "text-rose-600" : "text-bad"}>
                              ₹{out.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-good">₹0.00</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted">
                          Limit: {limit > 0 ? `₹${limit.toLocaleString("en-IN")}` : "No Limit"}
                        </div>
                        {limit > 0 && (
                          <div className="w-20 ml-auto bg-surface-2 rounded-full h-1 mt-1 overflow-hidden border border-line">
                            <div
                              className={`h-full ${ratio >= 100 ? "bg-red-600" : ratio >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${Math.min(100, ratio)}%` }}
                            />
                          </div>
                        )}
                      </td>

                      {/* Supply Type */}
                      <td className="py-2.5 px-2.5 text-center">
                        <span className="badge bg-surface text-ink text-[10px] border border-line font-medium">
                          {s.supplyType || "INWARD"}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-2.5">
                        {s.active ? (
                          <span className="badge bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 font-semibold text-[10px]">
                            Active
                          </span>
                        ) : (
                          <span className="badge bg-surface-2 text-muted border border-line text-[10px]">
                            Inactive
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewingSupplier(s)}
                            className="px-2 py-1 text-[11px] rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink font-medium"
                            title="View Profile"
                          >
                            View
                          </button>
                          <button
                            onClick={() => openEditModal(s)}
                            className="px-2 py-1 text-[11px] rounded bg-surface-2 hover:bg-surface-hi border border-line text-ink font-medium"
                            title="Edit Supplier"
                          >
                            Edit
                          </button>
                          <Link
                            href="/inventory/purchase-orders"
                            className="px-2 py-1 text-[11px] rounded bg-accent/10 text-accent hover:bg-accent/20 font-semibold border border-accent/20"
                            title="Create Purchase Order"
                          >
                            + PO
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ADD / EDIT SUPPLIER MODAL */}
      {isAddingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setIsAddingSupplier(false)}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-4 bg-surface border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">
                  {editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : "Register New Supplier / Distributor"}
                </h2>
                <div className="text-xs text-muted">Manage supplier master, contract periods, payment credit limits, and banking info.</div>
              </div>
              <button onClick={() => setIsAddingSupplier(false)} className="text-muted hover:text-ink font-bold text-sm p-1">
                ✕
              </button>
            </div>

            {formError && <div className="p-2.5 rounded bg-bad/10 text-bad border border-bad/20 text-xs font-semibold">{formError}</div>}

            <div className="space-y-4 text-xs">
              {/* Basic Details */}
              <div className="space-y-2">
                <h3 className="font-bold text-ink uppercase tracking-wider text-[11px] border-b border-line pb-1">1. Master Profile</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-muted mb-1">Supplier / Firm Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. MVA ENTERPRISES"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Category (Fruits, Dairy, Snacks, etc.)</label>
                    <input
                      type="text"
                      placeholder="e.g. Tobacco, Yeepee, Groceries"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Supply Type</label>
                    <select
                      value={form.supplyType}
                      onChange={(e) => setForm({ ...form, supplyType: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    >
                      <option value="INWARD">Inward (Procurement from Supplier)</option>
                      <option value="OUTWARD">Outward (Distribution)</option>
                      <option value="BOTH">Both (Inward & Outward)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <label className="flex items-center gap-1.5 font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) => setForm({ ...form, active: e.target.checked })}
                      />
                      Active Vendor Account
                    </label>
                  </div>
                </div>
              </div>

              {/* Contact & Location */}
              <div className="space-y-2">
                <h3 className="font-bold text-ink uppercase tracking-wider text-[11px] border-b border-line pb-1">2. Contact & Location</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-semibold text-muted mb-1">Contact Person</label>
                    <input
                      type="text"
                      placeholder="e.g. Rajesh Sharma"
                      value={form.contactPerson}
                      onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Phone / WhatsApp</label>
                    <input
                      type="text"
                      placeholder="e.g. 91-1244691030, 9899645151"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Email Address</label>
                    <input
                      type="email"
                      placeholder="md@supplier.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-1">
                    <label className="block font-semibold text-muted mb-1">City</label>
                    <input
                      type="text"
                      placeholder="e.g. Gurgaon"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block font-semibold text-muted mb-1">State</label>
                    <input
                      type="text"
                      placeholder="e.g. Haryana"
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block font-semibold text-muted mb-1">GSTIN / PAN</label>
                    <input
                      type="text"
                      placeholder="06ACFFM0485N1ZV"
                      value={form.gstin}
                      onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-muted mb-1">Street Address</label>
                  <input
                    type="text"
                    placeholder="Plot No., Industrial Area, Warehouse Address…"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                  />
                </div>
              </div>

              {/* Credit & Financial Terms */}
              <div className="space-y-2">
                <h3 className="font-bold text-ink uppercase tracking-wider text-[11px] border-b border-line pb-1">3. Credit Limits & Payment Terms</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-muted mb-1">Days Limit of Credit (Credit Days) *</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 30 (Net 30)"
                      value={form.creditDays}
                      onChange={(e) => setForm({ ...form, creditDays: Number(e.target.value) })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono font-bold"
                    />
                    <p className="text-[10px] text-muted mt-0.5">Helps Finance calculate due dates and pay before time expires.</p>
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Amount Limit of Credit (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 500000"
                      value={form.creditLimit}
                      onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono font-bold"
                    />
                    <p className="text-[10px] text-muted mt-0.5">Maximum credit allowed before PO holds or warnings.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-muted mb-1">Payment Terms Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Regular / Net 30 / Advance"
                      value={form.paymentTerms}
                      onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Bank / UPI Payout Details</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC - 123456789, IFSC: HDFC0001, UPI: mva@hdfc"
                      value={form.bankDetails}
                      onChange={(e) => setForm({ ...form, bankDetails: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-muted mb-1">Contract Start Date</label>
                    <input
                      type="date"
                      value={form.contractStart}
                      onChange={(e) => setForm({ ...form, contractStart: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-muted mb-1">Contract Expiry Date</label>
                    <input
                      type="date"
                      value={form.contractEnd}
                      onChange={(e) => setForm({ ...form, contractEnd: e.target.value })}
                      className="w-full py-1.5 px-2.5 rounded border border-line bg-surface-2 text-ink font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setIsAddingSupplier(false)}
                disabled={saving}
                className="btn text-xs py-1.5 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSupplier}
                disabled={saving || !form.name.trim()}
                className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-xs"
              >
                {saving ? "Saving…" : editingSupplier ? "Update Supplier" : "Save Supplier"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW SUPPLIER FULL INSPECTOR MODAL */}
      {viewingSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setViewingSupplier(null)}>
          <div className="card w-full max-w-lg space-y-4 bg-surface border border-line shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-ink">{viewingSupplier.name}</h3>
                  {viewingSupplier.active ? (
                    <span className="badge bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 text-[10px]">Active</span>
                  ) : (
                    <span className="badge bg-surface-2 text-muted border border-line text-[10px]">Inactive</span>
                  )}
                </div>
                <div className="text-xs text-muted mt-0.5">Category: {viewingSupplier.category || "General"} | Supply: {viewingSupplier.supplyType || "INWARD"}</div>
              </div>
              <button onClick={() => setViewingSupplier(null)} className="text-muted hover:text-ink font-bold text-sm p-1">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Credit & Dues Health Box */}
              <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-muted">Outstanding Dues:</span>
                  <span className="text-base font-bold text-bad font-mono">
                    ₹{Number(viewingSupplier.outstanding || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted">Credit Limit Allowed:</span>
                  <span className="font-mono font-semibold text-ink">
                    {Number(viewingSupplier.creditLimit || 0) > 0
                      ? `₹${Number(viewingSupplier.creditLimit).toLocaleString("en-IN")}`
                      : "Unlimited / Unset"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted">Payment Credit Term:</span>
                  <span className="font-mono font-semibold text-accent">
                    {viewingSupplier.creditDays || 0} Days ({viewingSupplier.paymentTerms || "Regular"})
                  </span>
                </div>
              </div>

              {/* Contact & Banking Grid */}
              <div className="grid grid-cols-2 gap-2 bg-surface-2 p-2.5 rounded border border-line">
                <div>
                  <span className="text-muted block text-[10px]">Contact Person:</span>
                  <strong className="text-ink">{viewingSupplier.contactPerson || "—"}</strong>
                </div>
                <div>
                  <span className="text-muted block text-[10px]">Phone / WhatsApp:</span>
                  <strong className="font-mono text-ink">{viewingSupplier.phone || "—"}</strong>
                </div>
                <div>
                  <span className="text-muted block text-[10px]">Email:</span>
                  <span className="text-ink">{viewingSupplier.email || "—"}</span>
                </div>
                <div>
                  <span className="text-muted block text-[10px]">GSTIN / PAN:</span>
                  <strong className="font-mono text-ink">{viewingSupplier.gstin || "—"}</strong>
                </div>
              </div>

              {/* Location & Banking */}
              <div className="space-y-1.5 bg-surface-2 p-2.5 rounded border border-line">
                <div>
                  <span className="text-muted block text-[10px]">Location & Address:</span>
                  <span className="text-ink font-medium">
                    {[viewingSupplier.address, viewingSupplier.city, viewingSupplier.state].filter(Boolean).join(", ") || "—"}
                  </span>
                </div>
                {viewingSupplier.bankDetails && (
                  <div className="border-t border-line/60 pt-1.5">
                    <span className="text-muted block text-[10px]">Bank / UPI Account:</span>
                    <span className="font-mono text-ink font-semibold">{viewingSupplier.bankDetails}</span>
                  </div>
                )}
              </div>

              {/* Contract Validity */}
              {(viewingSupplier.contractStart || viewingSupplier.contractEnd) && (
                <div className="flex justify-between bg-surface-2 p-2 rounded border border-line text-[11px]">
                  <span>Contract Start: <strong>{viewingSupplier.contractStart ? fmtDate(viewingSupplier.contractStart) : "—"}</strong></span>
                  <span>Contract Expiry: <strong>{viewingSupplier.contractEnd ? fmtDate(viewingSupplier.contractEnd) : "—"}</strong></span>
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 pt-3 border-t border-line">
              <button
                onClick={() => {
                  const s = viewingSupplier;
                  setViewingSupplier(null);
                  openEditModal(s);
                }}
                className="btn text-xs py-1.5 px-3 font-semibold"
              >
                ✏️ Edit Supplier
              </button>
              <div className="flex gap-2">
                <Link
                  href="/inventory/purchase-orders"
                  className="btn-primary text-xs py-1.5 px-3 font-semibold"
                >
                  + Issue Purchase Order
                </Link>
                <button onClick={() => setViewingSupplier(null)} className="btn text-xs py-1.5 px-3">
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
