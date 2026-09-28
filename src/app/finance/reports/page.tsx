"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type DailyReport = {
  sales: {
    totalRevenue: number;
    b2bRevenue: number;
    b2cRevenue: number;
    ordersCount: number;
    averageOrderValue: number;
  };
  collections: {
    total: number;
    cash: number;
    upi: number;
    bank: number;
    cheque: number;
  };
  expenses: {
    total: number;
    count: number;
  };
  cashClosing: {
    expectedCash: number;
    actualCash: number;
    difference: number;
  };
  bank: {
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
  };
  upi: {
    grossUpi: number;
    settled: number;
    pending: number;
    charges: number;
  };
};

type MonthlyPnL = {
  grossRevenue: number;
  returnsAndCreditNotes: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  expenseByCategory: Record<string, number>;
  totalExpenses: number;
  operatingProfit: number;
  operatingMarginPct: number;
};

type ProductProfitItem = {
  sku: string;
  productName: string;
  category: string;
  unitsSold: number;
  unitSellingAvg: number;
  unitLandedAvg: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
};

type RetailerProfitItem = {
  customerId: string;
  shopName: string;
  ownerName: string;
  customerType: string;
  mobile: string;
  ordersCount: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  outstandingDue: number;
  creditLimit: number;
};

type SupplierPayableItem = {
  supplierId: string;
  supplierName: string;
  category: string;
  creditDays: number;
  pendingBillsCount: number;
  totalPayable: number;
  overdueAmount: number;
  status: string;
};

type ChannelProfitItem = {
  channel: string;
  ordersCount: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
};

type WarehouseProfitItem = {
  warehouseId: string;
  name: string;
  code: string;
  ordersCount: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  localExpenses: number;
  operatingProfit: number;
  marginPct: number;
};

type ReportsApiResponse = {
  period: {
    range: string;
    dateParam: string;
    monthParam: string;
    startDate: string;
    endDate: string;
  };
  dailyReport: DailyReport;
  monthlyPnL: MonthlyPnL;
  receivables: {
    total: number;
    current: number;
    overdue15: number;
    overdue30: number;
    overdue60: number;
    overdue90: number;
    debtorsCount: number;
  };
  payables: {
    total: number;
    overdueBillsCount: number;
    supplierCount: number;
    supplierList: SupplierPayableItem[];
  };
  cashFlow: {
    operatingInflows: number;
    operatingOutflows: number;
    netOperatingCashFlow: number;
  };
  businessReports: {
    productProfitability: ProductProfitItem[];
    retailerProfitability: RetailerProfitItem[];
    channelProfitability: ChannelProfitItem[];
    warehouseProfitability: WarehouseProfitItem[];
  };
};

export default function FinancialReportsPage() {
  const [range, setRange] = useState<"today" | "7d" | "thisMonth" | "prevMonth" | "quarter" | "year">("thisMonth");
  const [dateInput, setDateInput] = useState<string>("");
  const [monthInput, setMonthInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"daily" | "monthly" | "products" | "retailers" | "suppliers" | "channels" | "warehouses">("daily");
  const [q, setQ] = useState("");

  const queryUrl = dateInput
    ? `/api/finance/reports?date=${dateInput}`
    : monthInput
    ? `/api/finance/reports?month=${monthInput}`
    : `/api/finance/reports?range=${range}`;

  const { data, loading, error, reload } = useApiGet<ReportsApiResponse>(queryUrl);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonStats count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-6" />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { dailyReport, monthlyPnL, receivables, payables, cashFlow, businessReports } = data;

  // Filtered lists for search
  const filteredProducts = businessReports.productProfitability.filter(
    (p) =>
      p.productName.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase()) ||
      p.category.toLowerCase().includes(q.toLowerCase())
  );

  const filteredRetailers = businessReports.retailerProfitability.filter(
    (r) =>
      r.shopName.toLowerCase().includes(q.toLowerCase()) ||
      (r.ownerName || "").toLowerCase().includes(q.toLowerCase()) ||
      (r.mobile || "").includes(q)
  );

  const filteredSuppliers = payables.supplierList.filter(
    (s) =>
      s.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      s.category.toLowerCase().includes(q.toLowerCase())
  );

  // CSV Export
  const downloadCsv = (filename: string, headers: string[], rows: string[][]) => {
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filename}_${range}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Period Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-ink">📊 Financial Reports Center</h1>
            <span className="text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full font-bold">
              Executive &amp; Audit Suite
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Daily Daybook, Monthly P&amp;L Statements, Cash Flow, Multi-Dimensional Margin Analytics
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Selectors */}
          <div className="flex items-center bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("today");
                setActiveTab("daily");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "today" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Today (Flash)
            </button>
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("7d");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "7d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              7D
            </button>
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("thisMonth");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "thisMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("prevMonth");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "prevMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Prev Month
            </button>
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("quarter");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "quarter" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Quarter
            </button>
            <button
              onClick={() => {
                setDateInput("");
                setMonthInput("");
                setRange("year");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !dateInput && !monthInput && range === "year" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              FY Year
            </button>
          </div>

          {/* Specific Date & Month inputs */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateInput}
              onChange={(e) => {
                setMonthInput("");
                setDateInput(e.target.value);
              }}
              className="bg-surface border border-line rounded px-2 py-1 text-xs text-ink font-semibold"
              title="Select Specific Date"
            />
            <input
              type="month"
              value={monthInput}
              onChange={(e) => {
                setDateInput("");
                setMonthInput(e.target.value);
              }}
              className="bg-surface border border-line rounded px-2 py-1 text-xs text-ink font-semibold"
              title="Select Specific Month"
            />
            {(dateInput || monthInput) && (
              <button
                onClick={() => {
                  setDateInput("");
                  setMonthInput("");
                }}
                className="text-xs text-rose-600 hover:underline font-bold"
              >
                Reset
              </button>
            )}
          </div>

          <button onClick={() => window.print()} className="btn text-xs flex items-center gap-1 font-semibold">
            🖨️ Print Statement
          </button>
        </div>
      </div>

      {/* Main KPI Summary Ribbon */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-700">Gross Sales Revenue</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{monthlyPnL.grossRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{dailyReport.sales.ordersCount} Billed Invoices</div>
        </div>

        <div className="card p-3 border-l-4 border-l-emerald-500">
          <div className="text-[11px] font-semibold text-emerald-700">Total Collections</div>
          <div className="text-lg font-black text-emerald-700 mt-0.5">
            ₹{dailyReport.collections.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Cash + UPI + Bank + Cheques</div>
        </div>

        <div className="card p-3 border-l-4 border-l-teal-500">
          <div className="text-[11px] font-semibold text-teal-700">Gross Profit (Margin)</div>
          <div className="text-lg font-black text-teal-700 mt-0.5">
            ₹{monthlyPnL.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-teal-600 font-bold mt-1">
            {monthlyPnL.grossMarginPct.toFixed(1)}% Gross Margin
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-rose-500">
          <div className="text-[11px] font-semibold text-rose-700">Operating Expenses</div>
          <div className="text-lg font-black text-rose-700 mt-0.5">
            ₹{monthlyPnL.totalExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Rent, Salaries, Logistics</div>
        </div>

        <div className={`card p-3 border-l-4 ${
          monthlyPnL.operatingProfit >= 0 ? "border-l-good bg-good/[0.04]" : "border-l-bad bg-bad/[0.04]"
        }`}>
          <div className={`text-[11px] font-semibold ${monthlyPnL.operatingProfit >= 0 ? "text-good" : "text-bad"}`}>
            Operating Profit (EBITDA)
          </div>
          <div className={`text-lg font-black ${monthlyPnL.operatingProfit >= 0 ? "text-good" : "text-bad"} mt-0.5`}>
            ₹{monthlyPnL.operatingProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-bold mt-1">
            Net: {monthlyPnL.operatingMarginPct.toFixed(1)}%
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-amber-500">
          <div className="text-[11px] font-semibold text-amber-700">Customer Receivables</div>
          <div className="text-lg font-black text-amber-700 mt-0.5">
            ₹{receivables.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{receivables.debtorsCount} Active Debtors</div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab("daily")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "daily" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📅 1. Daily Daybook
            </button>
            <button
              onClick={() => setActiveTab("monthly")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "monthly" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📊 2. Monthly P&amp;L Statement
            </button>
            <button
              onClick={() => setActiveTab("products")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "products" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏷️ Product Profitability ({businessReports.productProfitability.length})
            </button>
            <button
              onClick={() => setActiveTab("retailers")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "retailers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏪 Retailer Profitability ({businessReports.retailerProfitability.length})
            </button>
            <button
              onClick={() => setActiveTab("suppliers")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "suppliers" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🤝 Supplier Payables ({payables.supplierList.length})
            </button>
            <button
              onClick={() => setActiveTab("channels")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "channels" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📈 Channels
            </button>
            <button
              onClick={() => setActiveTab("warehouses")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "warehouses" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏛️ Warehouses
            </button>
          </div>
        </div>

        {/* Global Filter & Search */}
        {(activeTab === "products" || activeTab === "retailers" || activeTab === "suppliers") && (
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search items, names, categories..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="bg-surface-hi border border-line rounded-lg px-3 py-1.5 text-xs text-ink w-64"
            />
          </div>
        )}
      </div>

      {/* ── 1. DAILY DAYBOOK FLASH REPORT ── */}
      {activeTab === "daily" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Daily Sales Card */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">🛒 1. Daily Sales Breakdown</h3>
                <span className="text-[10px] bg-sky-500/10 text-sky-700 font-bold px-2 py-0.5 rounded">
                  {dailyReport.sales.ordersCount} Orders
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Total Sales Invoiced:</span>
                  <span className="font-bold text-ink font-mono text-sm">
                    ₹{dailyReport.sales.totalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Wholesale B2B Sales:</span>
                  <span className="font-semibold text-sky-700 font-mono">
                    ₹{dailyReport.sales.b2bRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Retail B2C Sales:</span>
                  <span className="font-semibold text-teal-700 font-mono">
                    ₹{dailyReport.sales.b2cRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-muted">
                  <span>Average Order Value (AOV):</span>
                  <span className="font-bold text-ink font-mono">
                    ₹{dailyReport.sales.averageOrderValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Daily Collections Card */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">💵 2. Daily Collections By Tender</h3>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-700 font-bold px-2 py-0.5 rounded">
                  Inflows
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Total Cash Received:</span>
                  <span className="font-semibold text-emerald-700 font-mono">
                    ₹{dailyReport.collections.cash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Total UPI Collections:</span>
                  <span className="font-semibold text-sky-700 font-mono">
                    ₹{dailyReport.collections.upi.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Direct Bank / NEFT Transfers:</span>
                  <span className="font-semibold text-purple-700 font-mono">
                    ₹{dailyReport.collections.bank.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line text-ink font-bold">
                  <span>Total Daily Collection:</span>
                  <span className="text-emerald-700 font-black font-mono text-sm">
                    ₹{dailyReport.collections.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Daily Cash & Bank Closing Card */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">🏦 3. Cash Closing &amp; Banking</h3>
                <span className="text-[10px] bg-amber-500/10 text-amber-700 font-bold px-2 py-0.5 rounded">
                  EOD Position
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Expected Till Cash:</span>
                  <span className="font-semibold text-ink font-mono">
                    ₹{dailyReport.cashClosing.expectedCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Actual Till Counted:</span>
                  <span className="font-bold text-ink font-mono">
                    ₹{dailyReport.cashClosing.actualCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Till Cash Discrepancy:</span>
                  <span className={`font-black font-mono ${dailyReport.cashClosing.difference === 0 ? "text-good" : "text-bad"}`}>
                    {dailyReport.cashClosing.difference === 0 ? "✓ ₹0.00 (Balanced)" : `⚠️ ₹${dailyReport.cashClosing.difference.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-muted">
                  <span>UPI In-Transit / Pending:</span>
                  <span className="font-bold text-amber-700 font-mono">
                    ₹{dailyReport.upi.pending.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. MONTHLY P&L & BALANCE SHEET ── */}
      {activeTab === "monthly" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Profit & Loss Statement */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <div>
                  <h3 className="text-sm font-bold text-ink">Statement of Profit &amp; Loss (P&amp;L)</h3>
                  <span className="text-xs text-muted">Period: {data.period.startDate.slice(0, 10)} to {data.period.endDate.slice(0, 10)}</span>
                </div>
                <button
                  onClick={() =>
                    downloadCsv(
                      "PnL_Statement",
                      ["Line Item", "Amount"],
                      [
                        ["Gross Revenue", monthlyPnL.grossRevenue.toFixed(2)],
                        ["Less: Returns & Credit Notes", `-${monthlyPnL.returnsAndCreditNotes.toFixed(2)}`],
                        ["Net Sales Revenue", monthlyPnL.netRevenue.toFixed(2)],
                        ["Cost of Goods Sold (COGS)", `-${monthlyPnL.cogs.toFixed(2)}`],
                        ["Gross Profit", monthlyPnL.grossProfit.toFixed(2)],
                        ["Gross Margin %", `${monthlyPnL.grossMarginPct.toFixed(2)}%`],
                        ["Total Operating Expenses", `-${monthlyPnL.totalExpenses.toFixed(2)}`],
                        ["Net Operating Profit (EBITDA)", monthlyPnL.operatingProfit.toFixed(2)],
                        ["Operating Margin %", `${monthlyPnL.operatingMarginPct.toFixed(2)}%`],
                      ]
                    )
                  }
                  className="btn text-xs"
                >
                  📥 Export CSV
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="font-semibold text-ink">Gross Billed Sales Revenue</span>
                  <span className="font-mono font-bold text-ink">
                    ₹{monthlyPnL.grossRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50 text-rose-700">
                  <span>Less: Sales Returns &amp; Credit Notes</span>
                  <span className="font-mono font-semibold">
                    - ₹{monthlyPnL.returnsAndCreditNotes.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-line bg-surface-hi px-2 rounded font-bold text-ink">
                  <span>Net Sales Revenue</span>
                  <span className="font-mono text-sky-700">
                    ₹{monthlyPnL.netRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50 text-amber-800">
                  <span>Cost of Goods Sold (COGS Landed Cost)</span>
                  <span className="font-mono font-semibold">
                    - ₹{monthlyPnL.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-line bg-emerald-500/10 px-2 rounded font-bold text-emerald-800">
                  <span>Gross Profit</span>
                  <span className="font-mono font-black">
                    ₹{monthlyPnL.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })} ({monthlyPnL.grossMarginPct.toFixed(1)}%)
                  </span>
                </div>

                {/* OPEX Category Breakdown */}
                <div className="pt-2">
                  <span className="text-[11px] font-bold text-muted block mb-1">Operating Expenses (OPEX):</span>
                  <div className="space-y-1 pl-2 border-l-2 border-line">
                    {Object.entries(monthlyPnL.expenseByCategory).map(([cat, amt]) => (
                      <div key={cat} className="flex justify-between text-muted text-[11px]">
                        <span>{cat}</span>
                        <span className="font-mono text-rose-700">₹{amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-ink pt-1 border-t border-line/40">
                      <span>Total OPEX</span>
                      <span className="font-mono text-rose-700">
                        - ₹{monthlyPnL.totalExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Net Operating Profit */}
                <div className={`flex justify-between py-2 border-t-2 border-line px-2 rounded text-sm font-black ${
                  monthlyPnL.operatingProfit >= 0 ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
                }`}>
                  <span>Operating Profit (EBITDA)</span>
                  <span className="font-mono">
                    ₹{monthlyPnL.operatingProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })} ({monthlyPnL.operatingMarginPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Receivables & Working Capital Position */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">Receivables, Payables &amp; Cash Flow</h3>
                <span className="text-xs bg-amber-500/15 text-amber-700 font-bold px-2 py-0.5 rounded">
                  Balance Position
                </span>
              </div>

              <div className="space-y-3 text-xs">
                {/* Receivables Ageing */}
                <div className="space-y-1.5">
                  <div className="flex justify-between font-bold">
                    <span>Customer Debtors Outstanding:</span>
                    <span className="font-mono text-amber-700">₹{receivables.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] text-center font-semibold">
                    <div className="bg-surface-hi p-1 rounded">Current: ₹{receivables.current.toFixed(0)}</div>
                    <div className="bg-surface-hi p-1 rounded">15D: ₹{receivables.overdue15.toFixed(0)}</div>
                    <div className="bg-amber-500/10 p-1 rounded text-amber-800">30D: ₹{receivables.overdue30.toFixed(0)}</div>
                    <div className="bg-rose-500/10 p-1 rounded text-rose-800">60D+: ₹{(receivables.overdue60 + receivables.overdue90).toFixed(0)}</div>
                  </div>
                </div>

                {/* Supplier Payables */}
                <div className="space-y-1.5 pt-2 border-t border-line/60">
                  <div className="flex justify-between font-bold">
                    <span>Supplier Creditors Outstanding:</span>
                    <span className="font-mono text-rose-700">₹{payables.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="text-[11px] text-muted flex justify-between">
                    <span>Associated Suppliers: {payables.supplierCount}</span>
                    <span className="text-rose-700 font-semibold">{payables.overdueBillsCount} Overdue Bills</span>
                  </div>
                </div>

                {/* Cash Flow Summary */}
                <div className="space-y-1.5 pt-2 border-t border-line/60 bg-surface-hi p-3 rounded-lg">
                  <div className="font-bold text-ink mb-1">Operating Cash Flow Summary:</div>
                  <div className="flex justify-between text-muted">
                    <span>Operating Cash Inflows (Collections):</span>
                    <span className="font-mono text-emerald-700 font-semibold">+₹{cashFlow.operatingInflows.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>Operating Cash Outflows (Expenses):</span>
                    <span className="font-mono text-rose-700 font-semibold">-₹{cashFlow.operatingOutflows.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between font-bold text-ink pt-1 border-t border-line/60">
                    <span>Net Operating Cash Flow:</span>
                    <span className={`font-mono ${cashFlow.netOperatingCashFlow >= 0 ? "text-good" : "text-bad"}`}>
                      ₹{cashFlow.netOperatingCashFlow.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. PRODUCT PROFITABILITY REPORT ── */}
      {activeTab === "products" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">SKU &amp; Product-Level Profitability</h3>
              <span className="text-xs text-muted">Realized sales revenue vs True unit Landed Cost per SKU</span>
            </div>
            <button
              onClick={() =>
                downloadCsv(
                  "Product_Profitability",
                  ["SKU", "Product Name", "Category", "Units Sold", "Revenue", "COGS", "Gross Profit", "Margin %"],
                  filteredProducts.map((p) => [
                    p.sku,
                    `"${p.productName.replace(/"/g, '""')}"`,
                    p.category,
                    p.unitsSold.toString(),
                    p.revenue.toFixed(2),
                    p.cogs.toFixed(2),
                    p.grossProfit.toFixed(2),
                    `${p.marginPct.toFixed(2)}%`,
                  ])
                )
              }
              className="btn text-xs"
            >
              📥 Export CSV
            </button>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">SKU Code</th>
                  <th className="py-2">Product Name</th>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Units Sold</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">COGS (Landed)</th>
                  <th className="py-2 text-right font-bold text-emerald-700">Gross Profit</th>
                  <th className="py-2 text-right font-bold text-ink">Gross Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredProducts.slice(0, 100).map((p) => (
                  <tr key={p.sku} className="hover:bg-surface-hi/50">
                    <td className="py-2 font-mono font-bold text-accent">{p.sku}</td>
                    <td className="py-2 font-medium text-ink max-w-xs truncate">{p.productName}</td>
                    <td className="py-2 text-muted">{p.category}</td>
                    <td className="py-2 text-right font-mono">{p.unitsSold.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono font-semibold">₹{p.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono text-muted">₹{p.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-bold text-emerald-700">₹{p.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-black text-ink">{p.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 4. RETAILER PROFITABILITY REPORT ── */}
      {activeTab === "retailers" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">Retailer &amp; Customer Profitability</h3>
              <span className="text-xs text-muted">Customer-wise margin contribution, order volume, and outstanding credit</span>
            </div>
            <button
              onClick={() =>
                downloadCsv(
                  "Retailer_Profitability",
                  ["Customer", "Owner", "Type", "Orders", "Revenue", "COGS", "Gross Profit", "Margin %", "Outstanding Due", "Credit Limit"],
                  filteredRetailers.map((r) => [
                    `"${r.shopName.replace(/"/g, '""')}"`,
                    `"${r.ownerName.replace(/"/g, '""')}"`,
                    r.customerType,
                    r.ordersCount.toString(),
                    r.revenue.toFixed(2),
                    r.cogs.toFixed(2),
                    r.grossProfit.toFixed(2),
                    `${r.marginPct.toFixed(2)}%`,
                    r.outstandingDue.toFixed(2),
                    r.creditLimit.toFixed(2),
                  ])
                )
              }
              className="btn text-xs"
            >
              📥 Export CSV
            </button>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Retailer / Shop Name</th>
                  <th className="py-2">Owner</th>
                  <th className="py-2">Type</th>
                  <th className="py-2 text-right">Orders</th>
                  <th className="py-2 text-right">Total Revenue</th>
                  <th className="py-2 text-right">COGS</th>
                  <th className="py-2 text-right font-bold text-emerald-700">Gross Profit</th>
                  <th className="py-2 text-right font-bold text-ink">Margin %</th>
                  <th className="py-2 text-right font-bold text-amber-700">Outstanding Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredRetailers.map((r) => (
                  <tr key={r.customerId} className="hover:bg-surface-hi/50">
                    <td className="py-2 font-bold text-ink">{r.shopName}</td>
                    <td className="py-2 text-muted">{r.ownerName || "—"}</td>
                    <td className="py-2">
                      <span className="bg-surface-hi text-muted text-[10px] px-1.5 py-0.5 rounded font-semibold">
                        {r.customerType}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">{r.ordersCount}</td>
                    <td className="py-2 text-right font-mono font-semibold">₹{r.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono text-muted">₹{r.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-bold text-emerald-700">₹{r.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-black text-ink">{r.marginPct.toFixed(1)}%</td>
                    <td className="py-2 text-right font-mono font-bold text-amber-700">₹{r.outstandingDue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 5. SUPPLIER PAYABLES REPORT ── */}
      {activeTab === "suppliers" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">Supplier Creditors &amp; Payables Statement</h3>
              <span className="text-xs text-muted">Vendor-wise pending purchase bills and overdue balances</span>
            </div>
            <button
              onClick={() =>
                downloadCsv(
                  "Supplier_Payables",
                  ["Supplier Name", "Category", "Credit Days", "Pending Bills", "Total Payable", "Overdue Amount", "Status"],
                  filteredSuppliers.map((s) => [
                    `"${s.supplierName.replace(/"/g, '""')}"`,
                    s.category,
                    s.creditDays.toString(),
                    s.pendingBillsCount.toString(),
                    s.totalPayable.toFixed(2),
                    s.overdueAmount.toFixed(2),
                    s.status,
                  ])
                )
              }
              className="btn text-xs"
            >
              📥 Export CSV
            </button>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Supplier Name</th>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-center">Credit Days</th>
                  <th className="py-2 text-right">Pending Bills</th>
                  <th className="py-2 text-right font-bold text-ink">Total Payable</th>
                  <th className="py-2 text-right font-bold text-rose-700">Overdue Amount</th>
                  <th className="py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredSuppliers.map((s) => (
                  <tr key={s.supplierId} className="hover:bg-surface-hi/50">
                    <td className="py-2 font-bold text-ink">{s.supplierName}</td>
                    <td className="py-2 text-muted">{s.category}</td>
                    <td className="py-2 text-center font-mono">{s.creditDays} days</td>
                    <td className="py-2 text-right font-mono font-semibold">{s.pendingBillsCount}</td>
                    <td className="py-2 text-right font-mono font-black text-ink">₹{s.totalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-bold text-rose-700">₹{s.overdueAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        s.status === "OVERDUE" ? "bg-rose-500/15 text-rose-700" : "bg-emerald-500/15 text-emerald-700"
                      }`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 6. CHANNEL PROFITABILITY REPORT ── */}
      {activeTab === "channels" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {businessReports.channelProfitability.map((ch) => (
            <div key={ch.channel} className="card p-4 space-y-3 border-t-4 border-t-accent">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">{ch.channel}</h3>
                <span className="text-xs bg-surface-hi text-ink font-semibold px-2 py-0.5 rounded">
                  {ch.ordersCount} Orders
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">Total Invoiced Revenue:</span>
                  <span className="font-mono font-bold text-ink text-sm">₹{ch.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/50">
                  <span className="text-muted">COGS (Procurement Cost):</span>
                  <span className="font-mono text-muted">₹{ch.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-line bg-emerald-500/10 px-2 rounded font-bold text-emerald-800">
                  <span>Gross Profit:</span>
                  <span className="font-mono font-black">₹{ch.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-1 text-ink font-bold">
                  <span>Channel Gross Margin %:</span>
                  <span className="font-mono text-accent text-sm">{ch.marginPct.toFixed(2)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 7. WAREHOUSE PROFITABILITY REPORT ── */}
      {activeTab === "warehouses" && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">Multi-Warehouse &amp; Branch P&amp;L Performance</h3>
              <span className="text-xs text-muted">Warehouse-level revenue, landed cost, local OPEX, and net margin</span>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Warehouse Name</th>
                  <th className="py-2">Code</th>
                  <th className="py-2 text-right">Orders</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">COGS</th>
                  <th className="py-2 text-right font-bold text-emerald-700">Gross Profit</th>
                  <th className="py-2 text-right font-bold text-rose-700">Local OPEX</th>
                  <th className="py-2 text-right font-bold text-ink">Operating Profit</th>
                  <th className="py-2 text-right font-bold text-accent">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {businessReports.warehouseProfitability.map((w) => (
                  <tr key={w.warehouseId} className="hover:bg-surface-hi/50">
                    <td className="py-2 font-bold text-ink">{w.name}</td>
                    <td className="py-2 font-mono text-muted">{w.code}</td>
                    <td className="py-2 text-right font-mono">{w.ordersCount}</td>
                    <td className="py-2 text-right font-mono font-semibold">₹{w.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono text-muted">₹{w.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-bold text-emerald-700">₹{w.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-bold text-rose-700">₹{w.localExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-black text-ink">₹{w.operatingProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="py-2 text-right font-mono font-black text-accent">{w.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
