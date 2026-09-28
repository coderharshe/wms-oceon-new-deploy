"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type EmployeeCollection = {
  userId: string;
  staffId: string;
  name: string;
  role: string;
  cash: number;
  bank: number;
  upi: number;
  cheque: number;
  total: number;
  txCount: number;
};

type RetailerCollection = {
  customerId: string;
  shopName: string;
  ownerName: string | null;
  mobile: string | null;
  gstin: string | null;
  cash: number;
  bank: number;
  upi: number;
  cheque: number;
  total: number;
  currentOutstanding: number;
  lastPaymentDate: string;
  txCount: number;
};

type CollectionTransaction = {
  id: string;
  orderId?: string;
  orderNumber: string;
  billNumber: string | null;
  customerId?: string;
  retailerName: string;
  ownerName: string | null;
  mobile: string | null;
  amount: number;
  method: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE";
  referenceNo: string | null;
  chequeBank: string | null;
  chequeDueDate: string | null;
  chequeStatus: string | null;
  recordedBy: {
    staffId: string;
    name: string;
  };
  timestamp: string;
  isRecovery: boolean;
  notes: string | null;
  warehouse: string;
};

type CollectionsApiResponse = {
  dateRange: {
    range: string;
    from: string;
    to: string;
  };
  summary: {
    totalCollected: number;
    cashCollection: number;
    bankCollection: number;
    upiCollection: number;
    chequeCollection: number;
    b2bCollection: number;
    outstandingCollection: number;
    transactionCount: number;
  };
  collectionByEmployee: EmployeeCollection[];
  collectionByRetailer: RetailerCollection[];
  recentCollections: CollectionTransaction[];
};

export default function CollectionsPage() {
  const [range, setRange] = useState<"today" | "yesterday" | "7d" | "thisMonth" | "30d">("30d");
  const [activeTab, setActiveTab] = useState<"employees" | "retailers" | "transactions">("employees");
  const [q, setQ] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE">("all");

  const { data, loading, error, reload } = useApiGet<CollectionsApiResponse>(
    `/api/finance/collections?range=${range}`
  );

  if (loading) return <SkeletonStats count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-6" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { summary } = data;

  // Filter Employees
  const filteredEmployees = data.collectionByEmployee.filter((emp) =>
    emp.name.toLowerCase().includes(q.toLowerCase()) ||
    emp.staffId.toLowerCase().includes(q.toLowerCase())
  );

  // Filter Retailers
  const filteredRetailers = data.collectionByRetailer.filter((ret) =>
    ret.shopName.toLowerCase().includes(q.toLowerCase()) ||
    (ret.ownerName && ret.ownerName.toLowerCase().includes(q.toLowerCase())) ||
    (ret.mobile && ret.mobile.includes(q))
  );

  // Filter Transactions
  const filteredTransactions = data.recentCollections.filter((tx) => {
    const matchesSearch =
      tx.retailerName.toLowerCase().includes(q.toLowerCase()) ||
      tx.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      (tx.referenceNo && tx.referenceNo.toLowerCase().includes(q.toLowerCase())) ||
      tx.recordedBy.name.toLowerCase().includes(q.toLowerCase());

    if (!matchesSearch) return false;
    if (methodFilter !== "all" && tx.method !== methodFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Header Banner & Date Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">💵</span>
            <h1 className="text-xl font-black text-ink">Overall Collections Monitor</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Real-time tracking of Cash, Bank, UPI, B2B dues recovery, Staff collection leaderboard & Retailer contributions
          </p>
        </div>

        {/* Date Presets */}
        <div className="flex flex-wrap items-center gap-1.5 bg-surface p-1 rounded-lg border border-line text-xs font-semibold">
          <button
            onClick={() => setRange("today")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "today" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setRange("yesterday")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "yesterday" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            Yesterday
          </button>
          <button
            onClick={() => setRange("7d")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "7d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            Last 7 Days
          </button>
          <button
            onClick={() => setRange("thisMonth")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "thisMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            This Month
          </button>
          <button
            onClick={() => setRange("30d")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "30d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            Last 30 Days
          </button>
        </div>
      </div>

      {/* Main Collection KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-7">
        {/* Total Overall */}
        <div className="card bg-accent/10 border-accent/40 p-3 col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold text-accent">Total Collections</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{summary.totalCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{summary.transactionCount} transactions</div>
        </div>

        {/* Cash */}
        <div className="card p-3 border-l-4 border-l-emerald-500 bg-emerald-500/[0.03]">
          <div className="text-[11px] font-semibold text-emerald-600">💵 Cash Collection</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.cashCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {summary.totalCollected > 0 ? ((summary.cashCollection / summary.totalCollected) * 100).toFixed(0) : 0}% of total
          </div>
        </div>

        {/* Bank */}
        <div className="card p-3 border-l-4 border-l-sky-500 bg-sky-500/[0.03]">
          <div className="text-[11px] font-semibold text-sky-600">🏦 Bank (NEFT/RTGS)</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.bankCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {summary.totalCollected > 0 ? ((summary.bankCollection / summary.totalCollected) * 100).toFixed(0) : 0}% of total
          </div>
        </div>

        {/* UPI */}
        <div className="card p-3 border-l-4 border-l-purple-500 bg-purple-500/[0.03]">
          <div className="text-[11px] font-semibold text-purple-600">📱 UPI Collection</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.upiCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {summary.totalCollected > 0 ? ((summary.upiCollection / summary.totalCollected) * 100).toFixed(0) : 0}% of total
          </div>
        </div>

        {/* Cheque */}
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-500/[0.03]">
          <div className="text-[11px] font-semibold text-amber-600">🧾 Cheque Collection</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.chequeCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {summary.totalCollected > 0 ? ((summary.chequeCollection / summary.totalCollected) * 100).toFixed(0) : 0}% of total
          </div>
        </div>

        {/* B2B Total */}
        <div className="card p-3 border-l-4 border-l-indigo-500 bg-indigo-500/[0.03]">
          <div className="text-[11px] font-semibold text-indigo-600">🏢 B2B Collection</div>
          <div className="text-base font-bold text-ink mt-0.5">
            ₹{summary.b2bCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Wholesale & retail billing</div>
        </div>

        {/* Outstanding Recoveries */}
        <div className="card p-3 border-l-4 border-l-good bg-good/[0.03]">
          <div className="text-[11px] font-semibold text-good">⚡ Outstanding Recovered</div>
          <div className="text-base font-bold text-good mt-0.5">
            ₹{summary.outstandingCollection.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">From credit bills</div>
        </div>
      </div>

      {/* Tabs & Search Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab("employees")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "employees" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              👥 Collection by Employee ({data.collectionByEmployee.length})
            </button>
            <button
              onClick={() => setActiveTab("retailers")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "retailers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏢 Collection by Retailer ({data.collectionByRetailer.length})
            </button>
            <button
              onClick={() => setActiveTab("transactions")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "transactions" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📋 All Transactions ({data.recentCollections.length})
            </button>
          </div>

          {activeTab === "transactions" && (
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="text-xs p-1.5 rounded border border-line bg-surface-hi"
            >
              <option value="all">All Payment Methods</option>
              <option value="CASH">Cash Only</option>
              <option value="BANK_TRANSFER">Bank / NEFT / RTGS</option>
              <option value="UPI">UPI Only</option>
              <option value="CHEQUE">Cheque Only</option>
            </select>
          )}
        </div>

        <div className="w-full sm:w-72">
          <input
            type="search"
            placeholder="Search collector, retailer, order #..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: COLLECTION BY EMPLOYEE */}
      {activeTab === "employees" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Staff & Collector Performance Leaderboard</h2>
              <p className="text-[11px] text-muted">Breakdown of collections deposited and handled by each employee</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Total Staff Active: <strong className="text-ink">{filteredEmployees.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Employee / Staff</th>
                <th className="py-3 px-3">Role</th>
                <th className="py-3 px-3 text-right">Cash (₹)</th>
                <th className="py-3 px-3 text-right">Bank / NEFT (₹)</th>
                <th className="py-3 px-3 text-right">UPI (₹)</th>
                <th className="py-3 px-3 text-right">Cheque (₹)</th>
                <th className="py-3 px-3 text-center">Tx Count</th>
                <th className="py-3 px-4 text-right">Total Collection (₹)</th>
                <th className="py-3 px-4 text-center">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted">
                    No employee collection records in this date range.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp, idx) => {
                  const share = summary.totalCollected > 0 ? (emp.total / summary.totalCollected) * 100 : 0;
                  return (
                    <tr key={emp.userId} className="hover:bg-surface-hi/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-accent/10 text-accent font-bold text-[10px]">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="font-bold text-ink">{emp.name}</div>
                            <div className="text-[10px] text-muted font-mono">{emp.staffId}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-[10px] bg-surface-hi px-2 py-0.5 rounded border border-line font-semibold text-ink">
                          {emp.role}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-emerald-600">
                        {emp.cash > 0 ? `₹${emp.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-sky-600">
                        {emp.bank > 0 ? `₹${emp.bank.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-purple-600">
                        {emp.upi > 0 ? `₹${emp.upi.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-amber-600">
                        {emp.cheque > 0 ? `₹${emp.cheque.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-3 px-3 text-center text-muted font-semibold">
                        {emp.txCount} txs
                      </td>
                      <td className="py-3 px-4 text-right font-black text-ink text-sm">
                        ₹{emp.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center gap-1.5 justify-center">
                          <div className="w-12 bg-surface-hi h-1.5 rounded-full overflow-hidden border border-line">
                            <div className="bg-accent h-full rounded-full" style={{ width: `${Math.min(share, 100)}%` }} />
                          </div>
                          <span className="text-[10px] font-semibold text-muted">{share.toFixed(0)}%</span>
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

      {/* VIEW 2: COLLECTION BY RETAILER */}
      {activeTab === "retailers" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Retailer-wise Collection Breakdown</h2>
              <p className="text-[11px] text-muted">Receipts received from B2B customer shops and remaining balances</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Total Contributing Retailers: <strong className="text-ink">{filteredRetailers.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Retailer (Shop Name)</th>
                <th className="py-3 px-3">Contact</th>
                <th className="py-3 px-3 text-center">Tenders Used</th>
                <th className="py-3 px-3 text-center">Tx Count</th>
                <th className="py-3 px-3 text-center">Last Payment Date</th>
                <th className="py-3 px-3 text-right">Current Outstanding</th>
                <th className="py-3 px-4 text-right">Total Collected (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredRetailers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No retailer collections found in this range.
                  </td>
                </tr>
              ) : (
                filteredRetailers.map((ret) => (
                  <tr key={ret.customerId} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-ink">{ret.shopName}</div>
                      {ret.gstin && (
                        <div className="text-[10px] text-muted font-mono">{ret.gstin}</div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-muted">
                      <div>{ret.ownerName || "Owner"}</div>
                      <div className="text-[10px]">{ret.mobile || "—"}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-wrap justify-center gap-1 text-[9px]">
                        {ret.bank > 0 && (
                          <span className="bg-sky-500/10 text-sky-600 px-1 py-0.2 rounded font-semibold">
                            NEFT: ₹{ret.bank.toLocaleString("en-IN")}
                          </span>
                        )}
                        {ret.upi > 0 && (
                          <span className="bg-purple-500/10 text-purple-600 px-1 py-0.2 rounded font-semibold">
                            UPI: ₹{ret.upi.toLocaleString("en-IN")}
                          </span>
                        )}
                        {ret.cash > 0 && (
                          <span className="bg-emerald-500/10 text-emerald-600 px-1 py-0.2 rounded font-semibold">
                            Cash: ₹{ret.cash.toLocaleString("en-IN")}
                          </span>
                        )}
                        {ret.cheque > 0 && (
                          <span className="bg-amber-500/10 text-amber-600 px-1 py-0.2 rounded font-semibold">
                            CHQ: ₹{ret.cheque.toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center text-muted font-semibold">
                      {ret.txCount} txs
                    </td>
                    <td className="py-3 px-3 text-center text-muted font-mono text-[11px]">
                      {new Date(ret.lastPaymentDate).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {ret.currentOutstanding > 0 ? (
                        <span className="font-bold text-bad">
                          ₹{ret.currentOutstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-good font-semibold text-[11px]">✓ No Dues</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-black text-good text-sm">
                      ₹{ret.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 3: ALL COLLECTION TRANSACTIONS */}
      {activeTab === "transactions" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Detailed Collections Ledger</h2>
              <p className="text-[11px] text-muted">Showing {filteredTransactions.length} individual receipt transactions</p>
            </div>
            <div className="text-xs font-semibold">
              Total Filtered:{" "}
              <span className="text-good font-black">
                ₹{filteredTransactions.reduce((s, t) => s + t.amount, 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-3">Retailer Shop</th>
                <th className="py-3 px-3">Order / Bill #</th>
                <th className="py-3 px-3">Method / Tender</th>
                <th className="py-3 px-3">Reference / UTR / Cheque #</th>
                <th className="py-3 px-3">Collected By</th>
                <th className="py-3 px-3 text-center">Type</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted">
                    No transactions matching filter.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface-hi/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-muted">
                      {new Date(tx.timestamp).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-ink">{tx.retailerName}</div>
                      {tx.mobile && <div className="text-[10px] text-muted">{tx.mobile}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-ink">{tx.orderNumber}</div>
                      {tx.billNumber && <div className="text-[10px] text-muted font-mono">{tx.billNumber}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.method === "CASH"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : tx.method === "BANK_TRANSFER"
                            ? "bg-sky-500/15 text-sky-600"
                            : tx.method === "UPI"
                            ? "bg-purple-500/15 text-purple-600"
                            : "bg-amber-500/15 text-amber-600"
                        }`}
                      >
                        {tx.method === "BANK_TRANSFER" ? "NEFT / RTGS" : tx.method}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-muted">
                      {tx.referenceNo || "—"}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-ink">{tx.recordedBy.name}</div>
                      <div className="text-[10px] text-muted font-mono">{tx.recordedBy.staffId}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {tx.isRecovery ? (
                        <span className="text-[9px] bg-good/15 text-good font-bold px-1.5 py-0.5 rounded">
                          Recovery
                        </span>
                      ) : (
                        <span className="text-[9px] bg-surface-hi text-muted px-1.5 py-0.5 rounded">
                          Fresh Sale
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-black text-good text-sm">
                      ₹{tx.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
