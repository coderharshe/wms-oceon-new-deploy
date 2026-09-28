"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats } from "@/components/Skeleton";

type ProductProfitItem = {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unit: string;
  purchasePrice: number;
  inwardFreight: number;
  landedCost: number;
  sellingPrice: number;
  retailPrice: number;
  unitGrossProfit: number;
  grossMarginPct: number;
  markupPct: number;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  contributionSharePct: number;
  orderCount: number;
};

type CategoryProfitItem = {
  category: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  contributionSharePct: number;
  productCount: number;
  unitsSold: number;
};

type ProfitabilityApiResponse = {
  range: string;
  userRole: "ADMIN" | "MANAGER" | "FINANCE" | string;
  dashboard: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    operatingExpenses: number;
    operatingProfit: number;
    operatingMarginPct: number;
    orderCount: number;
    totalSkusSold: number;
    totalCatalogSkus: number;
  };
  exampleBenchmark: {
    purchasePrice: number;
    inwardFreight: number;
    landedCost: number;
    sellingPrice: number;
    grossProfit: number;
    grossMarginPct: number;
    markupPct: number;
  };
  expenseCategoryBreakdown: Record<string, number>;
  categoryList: CategoryProfitItem[];
  productList: ProductProfitItem[];
};

export default function ProfitabilityPage() {
  const [range, setRange] = useState<"today" | "7d" | "thisMonth" | "30d" | "year">("thisMonth");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"unitEconomics" | "simulator" | "realizedSales" | "categories" | "waterfall">("unitEconomics");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"margin" | "grossProfit" | "sellingPrice" | "landedCost">("margin");

  // Simulator Calculator State
  const [simPurchasePrice, setSimPurchasePrice] = useState<number>(100);
  const [simFreightPct, setSimFreightPct] = useState<number>(3);
  const [simHandling, setSimHandling] = useState<number>(0);
  const [simSellingPrice, setSimSellingPrice] = useState<number>(115);

  const { data, loading, error, reload } = useApiGet<ProfitabilityApiResponse>(
    `/api/finance/profitability?range=${range}${categoryFilter !== "all" ? `&category=${categoryFilter}` : ""}`
  );

  if (loading) return <SkeletonStats count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-6" />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  const { dashboard, categoryList, productList, expenseCategoryBreakdown } = data;

  // Filter & Sort Products
  const filteredProducts = productList
    .filter((p) =>
      p.productName.toLowerCase().includes(q.toLowerCase()) ||
      p.sku.toLowerCase().includes(q.toLowerCase()) ||
      p.category.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "margin") return b.grossMarginPct - a.grossMarginPct;
      if (sortBy === "grossProfit") return b.unitGrossProfit - a.unitGrossProfit;
      if (sortBy === "sellingPrice") return b.sellingPrice - a.sellingPrice;
      if (sortBy === "landedCost") return b.landedCost - a.landedCost;
      return 0;
    });

  // Simulator Derived Calculations
  const simFreightAmt = simPurchasePrice * (simFreightPct / 100);
  const simLandedCost = simPurchasePrice + simFreightAmt + simHandling;
  const simGrossProfit = simSellingPrice - simLandedCost;
  const simGrossMarginPct = simSellingPrice > 0 ? (simGrossProfit / simSellingPrice) * 100 : 0;
  const simMarkupPct = simLandedCost > 0 ? (simGrossProfit / simLandedCost) * 100 : 0;

  const isProfitable = dashboard.operatingProfit >= 0;

  return (
    <div className="space-y-5">
      {/* Top Banner & Time Range Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-hi p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📈</span>
            <h1 className="text-xl font-black text-ink">Product-Level Margin &amp; Landed Cost Architecture</h1>
          </div>
          <p className="text-xs text-muted mt-0.5">
            Unit Landed Cost Build-up: Purchase Price &rarr; Landed Cost (+Freight) &rarr; Selling Price &rarr; Gross Profit &rarr; Gross Margin %
          </p>
        </div>

        {/* Range Selector */}
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
            onClick={() => setRange("7d")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "7d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            7 Days
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
          <button
            onClick={() => setRange("year")}
            className={`px-3 py-1 rounded transition-colors ${
              range === "year" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
            }`}
          >
            This Year
          </button>
        </div>
      </div>

      {/* Benchmark Example Reference Card */}
      <div className="bg-gradient-to-r from-accent/10 via-emerald-500/10 to-transparent p-4 rounded-xl border border-accent/20 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-bold text-accent uppercase tracking-wider">Example Unit Landed Cost Benchmark</div>
          <div className="text-xs text-muted">
            Standard pricing model for accurate wholesale &amp; retail unit gross margins
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="bg-surface px-3 py-1.5 rounded-lg border border-line">
            <span className="text-muted block text-[10px]">Purchase Price</span>
            <span className="font-bold text-ink">₹100.00</span>
          </div>
          <span className="text-muted font-bold">+</span>
          <div className="bg-surface px-3 py-1.5 rounded-lg border border-line">
            <span className="text-muted block text-[10px]">Inward Freight (3%)</span>
            <span className="font-bold text-amber-700">₹3.00</span>
          </div>
          <span className="text-muted font-bold">=</span>
          <div className="bg-surface px-3 py-1.5 rounded-lg border border-line">
            <span className="text-muted block text-[10px]">Landed Cost</span>
            <span className="font-bold text-ink">₹103.00</span>
          </div>
          <span className="text-muted font-bold">&rarr;</span>
          <div className="bg-surface px-3 py-1.5 rounded-lg border border-line">
            <span className="text-muted block text-[10px]">Selling Price</span>
            <span className="font-bold text-sky-700">₹115.00</span>
          </div>
          <span className="text-muted font-bold">=</span>
          <div className="bg-emerald-500/15 px-3 py-1.5 rounded-lg border border-emerald-500/30">
            <span className="text-emerald-700 block text-[10px] font-bold">Gross Profit</span>
            <span className="font-black text-emerald-700">₹12.00 (10.43% Margin)</span>
          </div>
        </div>
      </div>

      {/* Main Executive Profitability Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-700">Total Sales Revenue</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{dashboard.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">{dashboard.orderCount} billed orders</div>
        </div>

        <div className="card p-3 border-l-4 border-l-amber-500">
          <div className="text-[11px] font-semibold text-amber-700">COGS (Landed Cost)</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{dashboard.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">Total procurement cost</div>
        </div>

        <div className="card p-3 border-l-4 border-l-emerald-500">
          <div className="text-[11px] font-semibold text-emerald-700">Gross Profit</div>
          <div className="text-lg font-black text-emerald-700 mt-0.5">
            ₹{dashboard.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-emerald-600 font-semibold mt-1">
            Margin: {dashboard.grossMarginPct.toFixed(1)}%
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-teal-500">
          <div className="text-[11px] font-semibold text-teal-700">Catalog SKUs</div>
          <div className="text-lg font-black text-teal-700 mt-0.5">
            {dashboard.totalCatalogSkus} Products
          </div>
          <div className="text-[10px] text-muted mt-1">{dashboard.totalSkusSold} sold this period</div>
        </div>

        <div className="card p-3 border-l-4 border-l-rose-500">
          <div className="text-[11px] font-semibold text-rose-700">Operating Expenses</div>
          <div className="text-lg font-black text-rose-700 mt-0.5">
            ₹{dashboard.operatingExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">OPEX deductions</div>
        </div>

        <div className={`card p-3 border-l-4 ${
          isProfitable ? "border-l-good bg-good/[0.04]" : "border-l-bad bg-bad/[0.04]"
        }`}>
          <div className={`text-[11px] font-semibold ${isProfitable ? "text-good" : "text-bad"}`}>
            Operating Profit (EBITDA)
          </div>
          <div className={`text-lg font-black ${isProfitable ? "text-good" : "text-bad"} mt-0.5`}>
            ₹{dashboard.operatingProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className={`text-[10px] font-bold ${isProfitable ? "text-good" : "text-bad"} mt-1`}>
            Net: {dashboard.operatingMarginPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Tabs & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab("unitEconomics")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "unitEconomics" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏷️ Product Landed Cost &amp; Margin Matrix ({productList.length})
            </button>
            <button
              onClick={() => setActiveTab("simulator")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "simulator" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🧮 Landed Cost &amp; Margin Simulator
            </button>
            <button
              onClick={() => setActiveTab("realizedSales")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "realizedSales" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📦 Realized Sales Profitability
            </button>
            <button
              onClick={() => setActiveTab("categories")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "categories" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏷️ Category Contribution
            </button>
            <button
              onClick={() => setActiveTab("waterfall")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "waterfall" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📊 P&amp;L Waterfall
            </button>
          </div>

          {activeTab === "unitEconomics" && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted font-semibold">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="p-1.5 rounded border border-line bg-surface-hi text-xs"
              >
                <option value="margin">Highest Gross Margin %</option>
                <option value="grossProfit">Highest Unit Profit (₹)</option>
                <option value="sellingPrice">Highest Selling Price (₹)</option>
                <option value="landedCost">Highest Landed Cost (₹)</option>
              </select>
            </div>
          )}
        </div>

        <div className="w-full sm:w-72">
          <input
            type="search"
            placeholder="Search product, SKU, category..."
            className="w-full text-xs py-1.5 px-3 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* VIEW 1: PRODUCT-LEVEL LANDED COST & MARGIN MATRIX */}
      {activeTab === "unitEconomics" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Catalog Unit Landed Costs &amp; Wholesale Margins</h2>
              <p className="text-[11px] text-muted">
                Formula: <strong>Purchase Price + Inward Freight (3%) = Landed Cost &rarr; Selling Price &minus; Landed Cost = Unit Gross Profit</strong>
              </p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Total Products: <strong className="text-ink">{filteredProducts.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Product / SKU</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Purchase Price (₹)</th>
                <th className="py-3 px-3 text-right">Inward Freight (₹)</th>
                <th className="py-3 px-3 text-right">Landed Cost (₹)</th>
                <th className="py-3 px-3 text-right">Selling Price (₹)</th>
                <th className="py-3 px-3 text-right">Unit Profit (₹)</th>
                <th className="py-3 px-3 text-center">Gross Margin %</th>
                <th className="py-3 px-4 text-center">Markup %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted">
                    No products found.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isHighMargin = p.grossMarginPct >= 15;
                  const isLowMargin = p.grossMarginPct < 8;
                  return (
                    <tr key={p.productId} className="hover:bg-surface-hi/80 transition-colors">
                      {/* Product */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-ink">{p.productName}</div>
                        <div className="text-[10px] text-muted font-mono">{p.sku}</div>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3">
                        <span className="text-[10px] bg-surface-hi px-2 py-0.5 rounded border border-line font-medium text-ink">
                          {p.category}
                        </span>
                      </td>

                      {/* Purchase Price */}
                      <td className="py-3 px-3 text-right font-medium text-muted">
                        ₹{p.purchasePrice.toFixed(2)}
                      </td>

                      {/* Inward Freight */}
                      <td className="py-3 px-3 text-right font-medium text-amber-700">
                        +₹{p.inwardFreight.toFixed(2)}
                      </td>

                      {/* Landed Cost */}
                      <td className="py-3 px-3 text-right font-bold text-ink">
                        ₹{p.landedCost.toFixed(2)}
                      </td>

                      {/* Selling Price */}
                      <td className="py-3 px-3 text-right font-bold text-sky-700">
                        ₹{p.sellingPrice.toFixed(2)}
                      </td>

                      {/* Unit Gross Profit */}
                      <td className={`py-3 px-3 text-right font-black text-sm ${
                        p.unitGrossProfit >= 0 ? "text-emerald-700" : "text-bad"
                      }`}>
                        ₹{p.unitGrossProfit.toFixed(2)}
                      </td>

                      {/* Gross Margin % */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isHighMargin
                              ? "bg-good/15 text-good"
                              : isLowMargin
                              ? "bg-bad/15 text-bad"
                              : "bg-warn/15 text-warn"
                          }`}
                        >
                          {p.grossMarginPct.toFixed(2)}%
                        </span>
                      </td>

                      {/* Markup % */}
                      <td className="py-3 px-4 text-center font-mono text-[11px] text-muted font-semibold">
                        {p.markupPct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 2: INTERACTIVE LANDED COST & MARGIN SIMULATOR */}
      {activeTab === "simulator" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Input Controls */}
          <div className="card p-6 border border-line space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="text-base font-bold text-ink">Landed Cost &amp; Price Simulator</h2>
              <p className="text-xs text-muted">Simulate procurement changes, freight impacts, and target selling prices</p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">Base Purchase Price from Supplier (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={simPurchasePrice}
                  onChange={(e) => setSimPurchasePrice(parseFloat(e.target.value) || 0)}
                  className="w-full text-base font-bold p-2.5 rounded-lg border border-line bg-surface-hi focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">Inward Freight &amp; Transport (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={simFreightPct}
                    onChange={(e) => setSimFreightPct(parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 rounded-lg border border-line bg-surface-hi font-medium"
                  />
                  <span className="text-[10px] text-muted mt-1 block">Freight: +₹{simFreightAmt.toFixed(2)}</span>
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">Packaging / Loading (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={simHandling}
                    onChange={(e) => setSimHandling(parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 rounded-lg border border-line bg-surface-hi font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">Selling Price to Wholesale Retailer (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={simSellingPrice}
                  onChange={(e) => setSimSellingPrice(parseFloat(e.target.value) || 0)}
                  className="w-full text-base font-bold p-2.5 rounded-lg border border-line bg-surface-hi text-sky-700 focus:outline-none focus:border-accent"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="pt-2">
                <span className="text-muted block text-[11px] mb-1.5 font-semibold">Quick Set Selling Price by Target Margin:</span>
                <div className="flex flex-wrap gap-2">
                  {[8, 10, 12, 15, 20].map((tgt) => {
                    const reqPrice = simLandedCost / (1 - tgt / 100);
                    return (
                      <button
                        key={tgt}
                        onClick={() => setSimSellingPrice(parseFloat(reqPrice.toFixed(2)))}
                        className="px-2.5 py-1 rounded bg-surface-hi border border-line hover:border-accent text-[11px] font-semibold"
                      >
                        Target {tgt}% (₹{reqPrice.toFixed(2)})
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Calculation Result Sheet */}
          <div className="card p-6 border border-line bg-surface-hi/40 space-y-4 flex flex-col justify-between">
            <div className="border-b border-line pb-3">
              <h2 className="text-base font-bold text-ink">Simulated Unit Economics Breakdown</h2>
              <p className="text-xs text-muted">Live margin &amp; profit calculations</p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center p-2 rounded bg-surface border border-line">
                <span className="text-muted">1. Purchase Price:</span>
                <span className="font-bold text-ink">₹{simPurchasePrice.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-2 rounded bg-surface border border-line text-amber-700">
                <span>+ Inward Freight &amp; Handling:</span>
                <span className="font-bold">+₹{(simFreightAmt + simHandling).toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-3 rounded-lg bg-surface border-2 border-line font-bold">
                <span className="text-ink">2. Total Landed Cost (COGS):</span>
                <span className="text-ink text-sm">₹{simLandedCost.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 font-bold">
                <span className="text-sky-800">3. Selling Price:</span>
                <span className="text-sky-800 text-sm">₹{simSellingPrice.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                <div>
                  <span className="text-emerald-800 font-bold text-sm block">4. Unit Gross Profit:</span>
                  <span className="text-[11px] text-emerald-700">Markup on Landed Cost: {simMarkupPct.toFixed(2)}%</span>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black text-emerald-800">₹{simGrossProfit.toFixed(2)}</div>
                  <div className="text-xs font-bold text-emerald-700">
                    Gross Margin: {simGrossMarginPct.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="text-[11px] text-muted p-2 rounded bg-surface border border-line text-center">
              Formula: <strong>Gross Margin % = (Gross Profit / Selling Price) &times; 100</strong>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: REALIZED SALES PROFITABILITY */}
      {activeTab === "realizedSales" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Realized Product Sales &amp; Gross Profit Generation</h2>
              <p className="text-[11px] text-muted">Actual sales volume, delivered COGS, and gross profit contribution</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Products Sold: <strong className="text-ink">{filteredProducts.filter((p) => p.unitsSold > 0).length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Product / SKU</th>
                <th className="py-3 px-3 text-right">Units Sold</th>
                <th className="py-3 px-3 text-right">Sales Revenue (₹)</th>
                <th className="py-3 px-3 text-right">Delivered COGS (₹)</th>
                <th className="py-3 px-3 text-right">Gross Profit (₹)</th>
                <th className="py-3 px-3 text-center">Gross Margin %</th>
                <th className="py-3 px-4 text-center">Profit Contribution %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredProducts.filter((p) => p.unitsSold > 0).length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    No sales recorded for the selected time period.
                  </td>
                </tr>
              ) : (
                filteredProducts
                  .filter((p) => p.unitsSold > 0)
                  .map((p) => (
                    <tr key={p.productId} className="hover:bg-surface-hi/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-ink">{p.productName}</div>
                        <div className="text-[10px] text-muted font-mono">{p.sku}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-ink">
                        {p.unitsSold} {p.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-sky-700">
                        ₹{p.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-amber-700">
                        ₹{p.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-700 text-sm">
                        ₹{p.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-good/15 text-good">
                          {p.grossMarginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 bg-surface-hi h-1.5 rounded-full overflow-hidden border border-line">
                            <div
                              className="bg-accent h-full rounded-full"
                              style={{ width: `${Math.min(p.contributionSharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-muted w-8 text-right">
                            {p.contributionSharePct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 4: CATEGORY CONTRIBUTION */}
      {activeTab === "categories" && (
        <div className="card overflow-x-auto p-0 border border-line">
          <div className="p-4 border-b border-line bg-surface-hi/50 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-ink">Category-Level Profitability Matrix</h2>
              <p className="text-[11px] text-muted">Contribution breakdown across product categories</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Categories: <strong className="text-ink">{categoryList.length}</strong>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted bg-surface text-[11px] font-semibold">
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-3 text-center">SKU Count</th>
                <th className="py-3 px-3 text-right">Total Units Sold</th>
                <th className="py-3 px-3 text-right">Sales Revenue (₹)</th>
                <th className="py-3 px-3 text-right">COGS (₹)</th>
                <th className="py-3 px-3 text-right">Gross Profit (₹)</th>
                <th className="py-3 px-3 text-center">Gross Margin %</th>
                <th className="py-3 px-4 text-center">Profit Contribution %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {categoryList.map((cat) => (
                <tr key={cat.category} className="hover:bg-surface-hi/80 transition-colors">
                  <td className="py-3 px-4 font-bold text-ink text-sm">{cat.category}</td>
                  <td className="py-3 px-3 text-center text-muted font-semibold">{cat.productCount} SKUs</td>
                  <td className="py-3 px-3 text-right font-medium text-ink">{cat.unitsSold.toLocaleString()}</td>
                  <td className="py-3 px-3 text-right font-bold text-sky-700">
                    ₹{cat.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-amber-700">
                    ₹{cat.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-emerald-700 text-sm">
                    ₹{cat.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-good/15 text-good">
                      {cat.grossMarginPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-16 bg-surface-hi h-1.5 rounded-full overflow-hidden border border-line">
                        <div
                          className="bg-accent h-full rounded-full"
                          style={{ width: `${Math.min(cat.contributionSharePct, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-muted w-8 text-right">
                        {cat.contributionSharePct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 5: P&L WATERFALL */}
      {activeTab === "waterfall" && (
        <div className="card p-6 border border-line space-y-6">
          <div className="border-b border-line pb-3">
            <h2 className="text-base font-bold text-ink">Executive Income &amp; Profitability Statement (P&amp;L Bridge)</h2>
            <p className="text-xs text-muted">Complete financial breakdown from Top-line Revenue to Bottom-line Operating Profit</p>
          </div>

          <div className="space-y-4 max-w-2xl mx-auto text-xs">
            <div className="flex justify-between items-center p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 font-bold text-sm">
              <span className="text-sky-800">1. Gross Invoiced Revenue</span>
              <span className="text-sky-800 text-base">₹{dashboard.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="flex justify-between items-center px-4 py-2 border-l-2 border-line text-muted">
              <span className="flex items-center gap-2">
                <span className="text-bad font-bold">&minus;</span>
                <span>Cost of Goods Sold (COGS / Landed Costs)</span>
              </span>
              <span className="font-bold text-bad">
                -₹{dashboard.cogs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex justify-between items-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 font-bold text-sm">
              <span className="text-emerald-800 flex items-center gap-2">
                <span>=</span>
                <span>2. Gross Profit (Margin: {dashboard.grossMarginPct.toFixed(1)}%)</span>
              </span>
              <span className="text-emerald-800 text-base">₹{dashboard.grossProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="space-y-2 border-l-2 border-line pl-4 py-2">
              <div className="text-[11px] font-bold text-rose-700 flex items-center gap-1">
                <span>&minus;</span>
                <span>Operating Expenditures (OPEX Breakdown):</span>
              </div>

              {Object.entries(expenseCategoryBreakdown).map(([cat, amt]) => (
                <div key={cat} className="flex justify-between text-[11px] pl-4 text-muted">
                  <span>{cat.replace(/_/g, " ")}:</span>
                  <span className="font-semibold text-bad">
                    -₹{amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}

              <div className="flex justify-between text-xs font-bold pt-1 border-t border-line/60 text-bad">
                <span>Total Operating Expenses:</span>
                <span>-₹{dashboard.operatingExpenses.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className={`flex justify-between items-center p-4 rounded-xl border font-bold text-base ${
              isProfitable ? "bg-good/15 text-good border-good/40" : "bg-bad/15 text-bad border-bad/40"
            }`}>
              <div className="space-y-0.5">
                <div>= 3. Net Operating Profit (EBITDA)</div>
                <div className="text-xs font-semibold opacity-80">
                  Operating Margin: {dashboard.operatingMarginPct.toFixed(2)}%
                </div>
              </div>
              <div className="text-xl font-black">
                ₹{dashboard.operatingProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
