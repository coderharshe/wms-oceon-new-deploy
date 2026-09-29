"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { useDebounced } from "@/lib/useDebounced";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditCustomerModal, type EditableCustomer } from "@/components/EditCustomerModal";
import { AddCustomerModal, type NewCustomerData } from "@/components/AddCustomerModal";

type Customer = EditableCustomer;

export default function BillingCustomersPage() {
  const [searchInput, setSearchInput] = useState("");
  const debouncedQuery = useDebounced(searchInput, 250);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "WHOLESALE" | "RETAIL">("ALL");
  const [balanceFilter, setBalanceFilter] = useState<"ALL" | "WITH_DUES" | "OVER_LIMIT" | "ZERO">("ALL");

  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const queryParam = debouncedQuery.trim() ? `&q=${encodeURIComponent(debouncedQuery.trim())}` : "";
  const { data, error, loading, reload } = useApiGet<Customer[]>(`/api/customers?limit=150${queryParam}`);

  const rawList = data ?? [];

  // Client-side filtering for type and balance status
  const filteredList = useMemo(() => {
    return rawList.filter((c) => {
      if (typeFilter !== "ALL" && c.type !== typeFilter) return false;

      const outstanding = Number(c.outstandingBalance || 0);
      const limit = c.creditLimit === null ? null : Number(c.creditLimit);
      const isOverLimit = limit !== null && outstanding > limit;

      if (balanceFilter === "WITH_DUES" && outstanding <= 0) return false;
      if (balanceFilter === "OVER_LIMIT" && !isOverLimit) return false;
      if (balanceFilter === "ZERO" && outstanding > 0) return false;

      return true;
    });
  }, [rawList, typeFilter, balanceFilter]);

  // Statistics calculation
  const stats = useMemo(() => {
    let totalDues = 0;
    let wholesaleCount = 0;
    let retailCount = 0;
    let overLimitCount = 0;

    for (const c of rawList) {
      const outstanding = Number(c.outstandingBalance || 0);
      totalDues += outstanding;
      if (c.type === "WHOLESALE") wholesaleCount++;
      else if (c.type === "RETAIL") retailCount++;

      const limit = c.creditLimit === null ? null : Number(c.creditLimit);
      if (limit !== null && outstanding > limit) {
        overLimitCount++;
      }
    }

    return {
      totalCustomers: rawList.length,
      wholesaleCount,
      retailCount,
      totalDues,
      overLimitCount,
    };
  }, [rawList]);

  // Keyboard shortcut listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is inside an input modal
      if (showAddModal || editingCustomer) return;

      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setShowAddModal(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAddModal, editingCustomer]);

  function handleCustomerCreated(newCustomer: NewCustomerData) {
    setShowAddModal(false);
    setToastMessage(`Customer "${newCustomer.shopName}" created successfully.`);
    setTimeout(() => setToastMessage(null), 4000);
    reload();
  }

  function handleCustomerSaved() {
    setEditingCustomer(null);
    setToastMessage("Customer details updated successfully.");
    setTimeout(() => setToastMessage(null), 4000);
    reload();
  }

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-md bg-ink px-4 py-3 text-sm text-surface shadow-lg animate-in fade-in slide-in-from-bottom-3">
          <span className="text-good font-bold">✓</span>
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-3 text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header & Main Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Customer Directory</h1>

        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn text-xs"
            onClick={reload}
            title="Refresh customer list"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5"
            onClick={() => setShowAddModal(true)}
          >
            <span>+</span>
            <span>Add Customer</span>
            <span className="ml-1 text-[10px] opacity-75 font-normal">(Alt+N)</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-paper p-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Customers</div>
          <div className="mt-1 text-2xl font-bold text-ink">{stats.totalCustomers}</div>
          <div className="mt-0.5 text-[11px] text-muted">
            {stats.wholesaleCount} Wholesale • {stats.retailCount} Retail
          </div>
        </div>

        <div className="rounded-lg border border-line bg-paper p-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Dues to Collect</div>
          <div className="mt-1 text-2xl font-bold text-ink">₹{stats.totalDues.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="mt-0.5 text-[11px] text-muted">Across all customer accounts</div>
        </div>

        <div className="rounded-lg border border-line bg-paper p-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Over Credit Limit</div>
          <div className={`mt-1 text-2xl font-bold ${stats.overLimitCount > 0 ? "text-bad" : "text-ink"}`}>
            {stats.overLimitCount}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">Customers exceeding credit limit</div>
        </div>

        <div className="rounded-lg border border-line bg-paper p-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Wholesale Ratio</div>
          <div className="mt-1 text-2xl font-bold text-ink">
            {stats.totalCustomers > 0
              ? `${Math.round((stats.wholesaleCount / stats.totalCustomers) * 100)}%`
              : "0%"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">B2B Trade Accounts</div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper p-3">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              ref={searchRef}
              type="text"
              className="w-full pl-8 pr-8 text-xs"
              placeholder="Search by customer name, shop name, or mobile… (Press / to focus)"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <span className="absolute left-2.5 top-2 text-xs text-muted">🔍</span>
            {searchInput && (
              <button
                type="button"
                className="absolute right-2.5 top-2 text-xs text-muted hover:text-ink"
                onClick={() => setSearchInput("")}
              >
                ✕
              </button>
            )}
          </div>

          {/* Type Filter */}
          <select
            className="text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="ALL">All Types</option>
            <option value="WHOLESALE">Wholesale Only</option>
            <option value="RETAIL">Retail Only</option>
          </select>

          {/* Balance Filter */}
          <select
            className="text-xs"
            value={balanceFilter}
            onChange={(e) => setBalanceFilter(e.target.value as any)}
          >
            <option value="ALL">All Balances</option>
            <option value="WITH_DUES">Has Dues (To Collect)</option>
            <option value="OVER_LIMIT">Over Credit Limit</option>
            <option value="ZERO">Zero Balance</option>
          </select>
        </div>

        <div className="text-xs text-muted">
          Showing <strong className="text-ink">{filteredList.length}</strong> of {rawList.length} customers
        </div>
      </div>

      {/* Error state */}
      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Table Content */}
      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : filteredList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-hi text-2xl">
            👥
          </div>
          <h3 className="text-base font-semibold text-ink">No customers found</h3>
          <p className="mt-1 text-xs text-muted">
            {searchInput || typeFilter !== "ALL" || balanceFilter !== "ALL"
              ? "No customers matched your search and filter criteria."
              : "No customers have been registered yet."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {(searchInput || typeFilter !== "ALL" || balanceFilter !== "ALL") && (
              <button
                type="button"
                className="btn text-xs"
                onClick={() => {
                  setSearchInput("");
                  setTypeFilter("ALL");
                  setBalanceFilter("ALL");
                }}
              >
                Clear Filters
              </button>
            )}
            <button
              type="button"
              className="btn-primary text-xs font-semibold"
              onClick={() => setShowAddModal(true)}
            >
              + Add New Customer
            </button>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden p-0 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-hi text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-3 py-2.5">Shop / Business Name</th>
                  <th className="px-3 py-2.5">Customer Name</th>
                  <th className="px-3 py-2.5">Mobile Number</th>
                  <th className="px-3 py-2.5">Account Type</th>
                  <th className="px-3 py-2.5 text-right">Credit Limit</th>
                  <th className="px-3 py-2.5 text-right">Dues (To Collect)</th>
                  <th className="px-3 py-2.5 text-right">Available Credit</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredList.map((c) => {
                  const limit = c.creditLimit === null ? null : Number(c.creditLimit);
                  const outstanding = Number(c.outstandingBalance || 0);
                  const available = limit === null ? null : limit - outstanding;
                  const isOverLimit = available !== null && available < 0;

                  return (
                    <tr
                      key={c.id}
                      className="transition-colors hover:bg-surface-hi/50"
                    >
                      {/* Shop Name & Address/GSTIN */}
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-ink">{c.shopName}</div>
                        {(c.address || c.gstin) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                            {c.gstin && (
                              <span className="rounded bg-surface-hi px-1 py-0.5 font-mono text-[9px] uppercase border border-line">
                                GSTIN: {c.gstin}
                              </span>
                            )}
                            {c.address && <span className="truncate max-w-[200px]">{c.address}</span>}
                          </div>
                        )}
                      </td>

                      {/* Owner */}
                      <td className="px-3 py-2.5 text-muted">
                        {c.ownerName || "—"}
                      </td>

                      {/* Mobile */}
                      <td className="px-3 py-2.5">
                        {c.mobile ? (
                          <a
                            href={`tel:${c.mobile}`}
                            className="font-mono text-ink hover:underline"
                            title="Call customer"
                          >
                            {c.mobile}
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Type Badge */}
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${c.type === "WHOLESALE"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            }`}
                        >
                          {c.type}
                        </span>
                      </td>

                      {/* Credit Limit */}
                      <td className="px-3 py-2.5 text-right font-mono text-muted">
                        {limit === null ? "No limit" : `₹${limit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
                      </td>

                      {/* Outstanding Dues */}
                      <td className="px-3 py-2.5 text-right font-mono">
                        <span
                          className={`font-semibold ${outstanding > 0
                              ? isOverLimit
                                ? "text-bad font-bold"
                                : "text-amber-600 dark:text-amber-400"
                              : "text-muted"
                            }`}
                        >
                          ₹{outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Available Credit */}
                      <td className="px-3 py-2.5 text-right font-mono">
                        {available === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className={isOverLimit ? "font-bold text-bad" : "text-good"}>
                            ₹{available.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${c.status === "ACTIVE"
                              ? "bg-good/10 text-good"
                              : "bg-bad/10 text-bad"
                            }`}
                        >
                          {c.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn px-2.5 py-1 text-xs hover:border-ink hover:text-ink"
                            onClick={() => setEditingCustomer(c)}
                            title="Edit customer details & ledger balance"
                          >
                            Edit
                          </button>
                          <Link
                            href={`/billing/new?customerQuery=${encodeURIComponent(c.mobile || c.shopName)}`}
                            className="btn-primary px-2.5 py-1 text-xs font-medium"
                            title="Create a new bill for this customer"
                          >
                            Bill
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddModal && (
        <AddCustomerModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleCustomerCreated}
        />
      )}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <EditCustomerModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSaved={handleCustomerSaved}
        />
      )}
    </div>
  );
}
