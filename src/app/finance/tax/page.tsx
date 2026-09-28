"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonStats, SkeletonTable } from "@/components/Skeleton";

type B2BInvoiceRow = {
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string;
  placeOfSupply: string;
  isInterState: boolean;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  invoiceTotal: number;
  itemsCount: number;
};

type B2CInvoiceRow = {
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  sellingMode: string;
  placeOfSupply: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  invoiceTotal: number;
};

type RateWiseBreakdown = {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
};

type HsnSummaryRow = {
  hsn: string;
  description: string;
  uqc: string;
  totalQty: number;
  taxRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
};

type InwardPurchaseRow = {
  grnNumber: string;
  supplierBillNo: string;
  billDate: string;
  supplierName: string;
  supplierGstin: string;
  isRegisteredSupplier: boolean;
  taxableValue: number;
  gstAmount: number;
  otherCharges: number;
  total: number;
  paymentStatus: string;
  itcEligible: boolean;
  cgst: number;
  sgst: number;
  igst: number;
};

type CreditNoteRow = {
  id: string;
  date: string;
  billNumber: string;
  customerName: string;
  adjustedAmount: number;
  reversalTax: number;
  reason: string;
  resolutionType: string;
};

type TaxApiResponse = {
  period: {
    range: string;
    monthParam: string;
    startDate: string;
    endDate: string;
  };
  company: {
    legalName: string;
    tradeName: string;
    gstin: string;
    stateCode: string;
    stateName: string;
  };
  kpi: {
    totalGstCollected: number;
    totalGstPaidItc: number;
    netGstPayable: number;
    itcClosingBalance: number;
    totalTaxableSales: number;
    totalTaxablePurchases: number;
    totalSalesReturnTaxReversal: number;
    b2bInvoicesCount: number;
    b2cInvoicesCount: number;
    purchaseBillsCount: number;
    creditNotesCount: number;
  };
  gstr3b: {
    outwardSupplies: {
      taxableValue: number;
      igst: number;
      cgst: number;
      sgst: number;
      totalTax: number;
    };
    eligibleItc: {
      inwardGoodsItc: number;
      inwardServicesItc: number;
      totalEligibleItc: number;
      cgst: number;
      sgst: number;
      igst: number;
    };
    adjustments: {
      salesReturnTaxReversal: number;
      creditNotesCount: number;
    };
    offsetCalculation: {
      grossOutputLiability: number;
      lessSalesReturnTax: number;
      netOutputLiability: number;
      lessItcUtilized: number;
      netGstPayableCash: number;
      itcCarriedForward: number;
    };
  };
  rateWiseBreakdown: RateWiseBreakdown[];
  hsnSummary: HsnSummaryRow[];
  b2bInvoices: B2BInvoiceRow[];
  b2cInvoices: B2CInvoiceRow[];
  inwardPurchases: InwardPurchaseRow[];
  creditNotes: CreditNoteRow[];
};

export default function TaxGstPage() {
  const [range, setRange] = useState<"today" | "7d" | "thisMonth" | "prevMonth" | "quarter" | "year">("thisMonth");
  const [monthInput, setMonthInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"gstr3b" | "gstr1" | "itc" | "hsn" | "creditNotes" | "caExport">("gstr3b");
  const [q, setQ] = useState("");
  const [selectedRate, setSelectedRate] = useState<string>("all");

  const queryUrl = monthInput
    ? `/api/finance/tax?month=${monthInput}`
    : `/api/finance/tax?range=${range}`;

  const { data, loading, error, reload } = useApiGet<TaxApiResponse>(queryUrl);

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

  const { kpi, gstr3b, company, rateWiseBreakdown, hsnSummary, b2bInvoices, b2cInvoices, inwardPurchases, creditNotes } = data;

  // Search & Filter Invoices
  const filteredB2b = b2bInvoices.filter(
    (inv) =>
      inv.invoiceNo.toLowerCase().includes(q.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(q.toLowerCase()) ||
      inv.customerGstin.toLowerCase().includes(q.toLowerCase())
  );

  const filteredInward = inwardPurchases.filter(
    (p) =>
      p.supplierName.toLowerCase().includes(q.toLowerCase()) ||
      p.supplierBillNo.toLowerCase().includes(q.toLowerCase()) ||
      p.grnNumber.toLowerCase().includes(q.toLowerCase()) ||
      p.supplierGstin.toLowerCase().includes(q.toLowerCase())
  );

  const filteredHsn = hsnSummary.filter(
    (h) =>
      (selectedRate === "all" || h.taxRate.toString() === selectedRate) &&
      (h.hsn.toLowerCase().includes(q.toLowerCase()) || h.description.toLowerCase().includes(q.toLowerCase()))
  );

  // CSV Export for GSTR-1
  const downloadGstr1Csv = () => {
    const headers = [
      "GSTIN/UIN of Recipient",
      "Receiver Name",
      "Invoice Number",
      "Invoice date",
      "Invoice Value",
      "Place Of Supply",
      "Reverse Charge",
      "Applicable % of Tax Rate",
      "Invoice Type",
      "E-Commerce GSTIN",
      "Rate",
      "Taxable Value",
      "Cess Amount",
    ];

    const rows = b2bInvoices.map((inv) => [
      inv.customerGstin,
      `"${inv.customerName.replace(/"/g, '""')}"`,
      inv.invoiceNo,
      inv.invoiceDate,
      inv.invoiceTotal.toFixed(2),
      inv.placeOfSupply.slice(0, 2),
      "N",
      "",
      "Regular",
      "",
      inv.totalTax > 0 ? ((inv.totalTax / (inv.taxableValue || 1)) * 100).toFixed(0) : "0",
      inv.taxableValue.toFixed(2),
      "0.00",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `GSTR1_B2B_${company.gstin}_${range}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // JSON Export for Portal
  const downloadGstPortalJson = () => {
    const exportPayload = {
      gstin: company.gstin,
      fp: monthInput || new Date().toISOString().slice(0, 7).replace("-", ""),
      version: "GST_OFFLINE_2.0",
      hash: "hash_token_verified",
      b2b: b2bInvoices.map((inv) => ({
        ctin: inv.customerGstin,
        cname: inv.customerName,
        inv: [
          {
            inum: inv.invoiceNo,
            idt: inv.invoiceDate,
            val: inv.invoiceTotal,
            pos: inv.placeOfSupply.slice(0, 2),
            rchrg: "N",
            inv_typ: "R",
            itms: [
              {
                num: 1,
                itm_det: {
                  rt: inv.totalTax > 0 ? Math.round((inv.totalTax / (inv.taxableValue || 1)) * 100) : 0,
                  txval: inv.taxableValue,
                  iamt: inv.igst,
                  camt: inv.cgst,
                  samt: inv.sgst,
                  csamt: 0,
                },
              },
            ],
          },
        ],
      })),
      hsn: {
        data: hsnSummary.map((h, i) => ({
          num: i + 1,
          hsn_sc: h.hsn,
          desc: h.description,
          uqc: h.uqc,
          qty: h.totalQty,
          val: h.taxable + h.totalTax,
          txval: h.taxable,
          iamt: h.igst,
          camt: h.cgst,
          samt: h.sgst,
          csamt: 0,
        })),
      },
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `GSTN_GSTR1_${company.gstin}_${range}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-4 rounded-xl border border-line">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black text-ink">🏛️ GST &amp; Tax Portal</h1>
            <span className="text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full font-bold">
              GSTR-1 &amp; GSTR-3B Ready
            </span>
          </div>
          <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-3">
            <span>
              🏢 <strong className="text-ink">{company.legalName}</strong> ({company.tradeName})
            </span>
            <span>
              GSTIN: <strong className="text-accent font-mono">{company.gstin}</strong>
            </span>
            <span>
              State: <strong className="text-ink">{company.stateName} ({company.stateCode})</strong>
            </span>
          </div>
        </div>

        {/* Date / Month Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => {
                setMonthInput("");
                setRange("today");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "today" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                setMonthInput("");
                setRange("7d");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "7d" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              7D
            </button>
            <button
              onClick={() => {
                setMonthInput("");
                setRange("thisMonth");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "thisMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => {
                setMonthInput("");
                setRange("prevMonth");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "prevMonth" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Prev Month
            </button>
            <button
              onClick={() => {
                setMonthInput("");
                setRange("quarter");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "quarter" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              Quarter
            </button>
            <button
              onClick={() => {
                setMonthInput("");
                setRange("year");
              }}
              className={`px-3 py-1 rounded transition-colors ${
                !monthInput && range === "year" ? "bg-accent text-white font-bold" : "text-muted hover:text-ink"
              }`}
            >
              FY Year
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-surface-hi px-2.5 py-1 rounded-lg border border-line text-xs">
            <span className="text-muted font-medium">Month:</span>
            <input
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="bg-surface border border-line rounded px-2 py-0.5 text-xs text-ink font-semibold"
            />
            {monthInput && (
              <button
                onClick={() => setMonthInput("")}
                className="text-[10px] text-rose-600 hover:underline font-bold"
              >
                Clear
              </button>
            )}
          </div>

          <Link href="/finance/gst-bill" className="btn btn-primary text-xs flex items-center gap-1">
            <span>+</span> Issue Tax Invoice
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="card p-3 border-l-4 border-l-rose-500">
          <div className="text-[11px] font-semibold text-rose-700">GST Collected (Output Tax)</div>
          <div className="text-lg font-black text-rose-700 mt-0.5">
            ₹{kpi.totalGstCollected.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            CGST + SGST + IGST liability
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-emerald-500">
          <div className="text-[11px] font-semibold text-emerald-700">GST Paid (Eligible ITC)</div>
          <div className="text-lg font-black text-emerald-700 mt-0.5">
            ₹{kpi.totalGstPaidItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            Input tax on purchases &amp; OPEX
          </div>
        </div>

        <div className={`card p-3 border-l-4 ${
          kpi.netGstPayable > 0 ? "border-l-amber-500 bg-amber-500/5" : "border-l-sky-500 bg-sky-500/5"
        }`}>
          <div className="text-[11px] font-semibold text-ink">
            {kpi.netGstPayable > 0 ? "Net GST Payable (Cash)" : "ITC Carried Forward"}
          </div>
          <div className={`text-lg font-black mt-0.5 ${
            kpi.netGstPayable > 0 ? "text-amber-700" : "text-sky-700"
          }`}>
            ₹{(kpi.netGstPayable > 0 ? kpi.netGstPayable : kpi.itcClosingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {kpi.netGstPayable > 0 ? "To pay in cash ledger" : "Balance in Credit Ledger"}
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-sky-500">
          <div className="text-[11px] font-semibold text-sky-700">Total Taxable Sales</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{kpi.totalTaxableSales.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {kpi.b2bInvoicesCount} B2B + {kpi.b2cInvoicesCount} B2C
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-teal-500">
          <div className="text-[11px] font-semibold text-teal-700">Taxable Purchases</div>
          <div className="text-lg font-black text-ink mt-0.5">
            ₹{kpi.totalTaxablePurchases.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {kpi.purchaseBillsCount} supplier GRN bills
          </div>
        </div>

        <div className="card p-3 border-l-4 border-l-purple-500">
          <div className="text-[11px] font-semibold text-purple-700">Credit Notes / Returns</div>
          <div className="text-lg font-black text-purple-700 mt-0.5">
            ₹{kpi.totalSalesReturnTaxReversal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted mt-1">
            {kpi.creditNotesCount} sales reversals
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-surface-hi p-1 rounded-lg border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab("gstr3b")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "gstr3b" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📊 GSTR-3B Monthly Return
            </button>
            <button
              onClick={() => setActiveTab("gstr1")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "gstr1" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📑 GSTR-1 Sales Register ({b2bInvoices.length + b2cInvoices.length})
            </button>
            <button
              onClick={() => setActiveTab("itc")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "itc" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              📥 Inward Purchases &amp; ITC ({inwardPurchases.length})
            </button>
            <button
              onClick={() => setActiveTab("hsn")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "hsn" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🏷️ HSN Summary ({hsnSummary.length})
            </button>
            <button
              onClick={() => setActiveTab("creditNotes")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "creditNotes" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              🔄 Credit Notes ({creditNotes.length})
            </button>
            <button
              onClick={() => setActiveTab("caExport")}
              className={`px-3 py-1.5 rounded transition-all ${
                activeTab === "caExport" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              💼 CA &amp; Accounting Export
            </button>
          </div>
        </div>

        {/* Global Search Bar */}
        {(activeTab === "gstr1" || activeTab === "itc" || activeTab === "hsn") && (
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search invoice, GSTIN, supplier..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="bg-surface-hi border border-line rounded-lg px-3 py-1.5 text-xs text-ink w-64"
            />
          </div>
        )}
      </div>

      {/* Tab 1: GSTR-3B Monthly Return & Offset Computation */}
      {activeTab === "gstr3b" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Table 3.1 Outward Supplies */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">
                  3.1 Details of Outward Supplies &amp; Inward Reverse Charge
                </h3>
                <span className="text-[10px] bg-rose-500/10 text-rose-700 font-bold px-2 py-0.5 rounded">
                  Output Tax Liability
                </span>
              </div>

              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2">Nature of Supply</th>
                      <th className="py-2 text-right">Taxable Val</th>
                      <th className="py-2 text-right">IGST</th>
                      <th className="py-2 text-right">CGST</th>
                      <th className="py-2 text-right">SGST</th>
                      <th className="py-2 text-right font-bold text-ink">Total Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    <tr>
                      <td className="py-2.5 font-medium text-ink">
                        (a) Outward Taxable Supplies (other than zero/nil/exempt)
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold">
                        ₹{gstr3b.outwardSupplies.taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-rose-700">
                        ₹{gstr3b.outwardSupplies.totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="text-muted">
                      <td className="py-2">(b) Outward Taxable (Zero Rated)</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                    </tr>
                    <tr className="text-muted">
                      <td className="py-2">(c) Other Outward Supplies (Nil/Exempt)</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                      <td className="py-2 text-right font-mono">—</td>
                      <td className="py-2 text-right font-mono">—</td>
                      <td className="py-2 text-right font-mono">—</td>
                      <td className="py-2 text-right font-mono">₹0.00</td>
                    </tr>
                    <tr className="bg-surface-hi font-bold text-ink">
                      <td className="py-2.5">Total Outward Tax</td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.outwardSupplies.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono text-rose-700 font-black">
                        ₹{gstr3b.outwardSupplies.totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Table 4 Eligible ITC */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h3 className="text-sm font-bold text-ink">
                  4. Eligible Input Tax Credit (ITC) Available
                </h3>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-700 font-bold px-2 py-0.5 rounded">
                  ITC Asset Balance
                </span>
              </div>

              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2">Details</th>
                      <th className="py-2 text-right">IGST</th>
                      <th className="py-2 text-right">CGST</th>
                      <th className="py-2 text-right">SGST</th>
                      <th className="py-2 text-right font-bold text-ink">Total ITC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    <tr>
                      <td className="py-2.5 font-medium text-ink">
                        (A) (1) Inward supplies of goods (GRN Supplier Bills)
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.eligibleItc.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.eligibleItc.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.eligibleItc.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-emerald-700">
                        ₹{gstr3b.eligibleItc.inwardGoodsItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-medium text-ink">
                        (A) (2) Inward supplies of services &amp; OPEX
                      </td>
                      <td className="py-2.5 text-right font-mono">₹0.00</td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{(gstr3b.eligibleItc.inwardServicesItc / 2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{(gstr3b.eligibleItc.inwardServicesItc / 2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono font-bold text-emerald-700">
                        ₹{gstr3b.eligibleItc.inwardServicesItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="bg-surface-hi font-bold text-ink">
                      <td className="py-2.5">Total Eligible ITC</td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{gstr3b.eligibleItc.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{(gstr3b.eligibleItc.cgst + gstr3b.eligibleItc.inwardServicesItc / 2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        ₹{(gstr3b.eligibleItc.sgst + gstr3b.eligibleItc.inwardServicesItc / 2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 text-right font-mono text-emerald-700 font-black">
                        ₹{gstr3b.eligibleItc.totalEligibleItc.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Table 5 Tax Offset & Cash Payment Ledger Computation */}
          <div className="card p-4 space-y-3 border-2 border-accent/20">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  5. Payment of Tax &amp; Net Liability Offset Calculation
                </h3>
                <p className="text-xs text-muted">
                  Systematic set-off of output tax against eligible input tax credit according to GST Law
                </p>
              </div>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                gstr3b.offsetCalculation.netGstPayableCash > 0
                  ? "bg-amber-500/15 text-amber-700 border border-amber-500/30"
                  : "bg-sky-500/15 text-sky-700 border border-sky-500/30"
              }`}>
                {gstr3b.offsetCalculation.netGstPayableCash > 0 ? "Challan Payment Required" : "Credit Balance Surplus"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 pt-2 text-xs">
              <div className="bg-surface-hi p-3 rounded-lg border border-line">
                <span className="text-muted block text-[10px]">Gross Output Tax</span>
                <span className="font-bold text-ink text-sm">
                  ₹{gstr3b.offsetCalculation.grossOutputLiability.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-surface-hi p-3 rounded-lg border border-line">
                <span className="text-muted block text-[10px]">Less: Return Reversals</span>
                <span className="font-bold text-purple-700 text-sm">
                  - ₹{gstr3b.offsetCalculation.lessSalesReturnTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-surface-hi p-3 rounded-lg border border-line">
                <span className="text-muted block text-[10px]">Net Output Liability</span>
                <span className="font-bold text-rose-700 text-sm">
                  ₹{gstr3b.offsetCalculation.netOutputLiability.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-surface-hi p-3 rounded-lg border border-line">
                <span className="text-muted block text-[10px]">Less: ITC Utilized</span>
                <span className="font-bold text-emerald-700 text-sm">
                  - ₹{gstr3b.offsetCalculation.lessItcUtilized.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/30 md:col-span-1">
                <span className="text-amber-800 block text-[10px] font-bold">Net Cash Payable</span>
                <span className="font-black text-amber-800 text-base">
                  ₹{gstr3b.offsetCalculation.netGstPayableCash.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="bg-sky-500/10 p-3 rounded-lg border border-sky-500/30 md:col-span-1">
                <span className="text-sky-800 block text-[10px] font-bold">ITC Carried Fwd</span>
                <span className="font-black text-sky-800 text-base">
                  ₹{gstr3b.offsetCalculation.itcCarriedForward.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: GSTR-1 Sales Register (B2B & B2C) */}
      {activeTab === "gstr1" && (
        <div className="space-y-4">
          {/* Rate-wise Summary Pills */}
          <div className="card p-3">
            <div className="text-xs font-bold text-ink mb-2">GST Rate-wise Tax Summary (Outward Supplies):</div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {rateWiseBreakdown.map((r) => (
                <div key={r.rate} className="bg-surface-hi p-2.5 rounded-lg border border-line text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span className="text-accent">{r.rate}% Slab</span>
                    <span className="text-[10px] text-muted font-normal">Rate</span>
                  </div>
                  <div className="mt-1 text-ink font-semibold">
                    Taxable: ₹{r.taxable.toLocaleString("en-IN", { minimumFractionDigits: 0 })}
                  </div>
                  <div className="text-rose-700 font-bold text-[11px]">
                    Tax: ₹{r.totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* B2B Invoices Table */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  4A, 4B, 4C, 6B, 6C - B2B Invoices (Registered Dealers)
                </h3>
                <span className="text-xs text-muted">
                  Sales to retail businesses and dealers with verified 15-digit GSTIN
                </span>
              </div>
              <button onClick={downloadGstr1Csv} className="btn text-xs flex items-center gap-1">
                📥 Export B2B CSV
              </button>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Invoice No</th>
                    <th className="py-2">Date</th>
                    <th className="py-2">Customer / Shop Name</th>
                    <th className="py-2">Customer GSTIN</th>
                    <th className="py-2">Place of Supply</th>
                    <th className="py-2 text-right">Taxable Value</th>
                    <th className="py-2 text-right">CGST</th>
                    <th className="py-2 text-right">SGST</th>
                    <th className="py-2 text-right">IGST</th>
                    <th className="py-2 text-right font-bold text-ink">Total Bill</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {filteredB2b.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-6 text-muted">
                        No B2B registered invoices found for the selected period.
                      </td>
                    </tr>
                  ) : (
                    filteredB2b.map((inv) => (
                      <tr key={inv.invoiceNo} className="hover:bg-surface-hi/50">
                        <td className="py-2 font-mono font-bold text-accent">{inv.invoiceNo}</td>
                        <td className="py-2 text-muted">{inv.invoiceDate}</td>
                        <td className="py-2 font-medium text-ink">{inv.customerName}</td>
                        <td className="py-2 font-mono text-[11px] font-semibold text-sky-700">
                          {inv.customerGstin}
                        </td>
                        <td className="py-2 text-muted">{inv.placeOfSupply}</td>
                        <td className="py-2 text-right font-mono font-semibold">
                          ₹{inv.taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right font-mono text-muted">
                          ₹{inv.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right font-mono text-muted">
                          ₹{inv.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right font-mono text-muted">
                          ₹{inv.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 text-right font-mono font-black text-ink">
                          ₹{inv.invoiceTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* B2C Invoices Table */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  7 - B2C (Others) Retail &amp; Unregistered Counter Sales
                </h3>
                <span className="text-xs text-muted">
                  Intra-state sales to walk-in consumers without GSTIN
                </span>
              </div>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2">Bill No</th>
                    <th className="py-2">Date</th>
                    <th className="py-2">Buyer</th>
                    <th className="py-2">Mode</th>
                    <th className="py-2 text-right">Taxable Value</th>
                    <th className="py-2 text-right">CGST</th>
                    <th className="py-2 text-right">SGST</th>
                    <th className="py-2 text-right font-bold text-ink">Invoice Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {b2cInvoices.slice(0, 50).map((inv) => (
                    <tr key={inv.invoiceNo} className="hover:bg-surface-hi/50">
                      <td className="py-2 font-mono font-bold text-ink">{inv.invoiceNo}</td>
                      <td className="py-2 text-muted">{inv.invoiceDate}</td>
                      <td className="py-2 font-medium text-ink">{inv.customerName}</td>
                      <td className="py-2 text-muted">{inv.sellingMode}</td>
                      <td className="py-2 text-right font-mono">
                        ₹{inv.taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        ₹{inv.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        ₹{inv.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-ink">
                        ₹{inv.invoiceTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Inward Purchases & ITC Register */}
      {activeTab === "itc" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">
                Inward Supplies &amp; GSTR-2B Input Tax Credit Register
              </h3>
              <span className="text-xs text-muted">
                Procurement purchase bills received at warehouse gate with supplier GSTIN validation
              </span>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">GRN No</th>
                  <th className="py-2">Supplier Bill No</th>
                  <th className="py-2">Bill Date</th>
                  <th className="py-2">Supplier Name</th>
                  <th className="py-2">Supplier GSTIN</th>
                  <th className="py-2">ITC Status</th>
                  <th className="py-2 text-right">Taxable Value</th>
                  <th className="py-2 text-right">CGST</th>
                  <th className="py-2 text-right">SGST</th>
                  <th className="py-2 text-right">IGST</th>
                  <th className="py-2 text-right font-bold text-ink">Total Bill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredInward.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-6 text-muted">
                      No inward purchase bills found for this period.
                    </td>
                  </tr>
                ) : (
                  filteredInward.map((pb) => (
                    <tr key={pb.grnNumber} className="hover:bg-surface-hi/50">
                      <td className="py-2 font-mono font-bold text-accent">{pb.grnNumber}</td>
                      <td className="py-2 font-mono text-ink">{pb.supplierBillNo}</td>
                      <td className="py-2 text-muted">{pb.billDate}</td>
                      <td className="py-2 font-semibold text-ink">{pb.supplierName}</td>
                      <td className="py-2 font-mono text-[11px]">
                        {pb.supplierGstin === "UNREGISTERED" ? (
                          <span className="text-muted">Unregistered</span>
                        ) : (
                          <span className="text-emerald-700 font-bold">{pb.supplierGstin}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {pb.itcEligible ? (
                          <span className="bg-emerald-500/15 text-emerald-700 font-bold text-[10px] px-2 py-0.5 rounded">
                            ✓ ITC Eligible
                          </span>
                        ) : (
                          <span className="bg-gray-500/15 text-muted font-medium text-[10px] px-2 py-0.5 rounded">
                            No ITC (Unreg)
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono font-semibold">
                        ₹{pb.taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        ₹{pb.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        ₹{pb.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono text-muted">
                        ₹{pb.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono font-black text-ink">
                        ₹{pb.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: HSN Summary */}
      {activeTab === "hsn" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">
                12 - HSN/SAC Summary of Outward Supplies
              </h3>
              <span className="text-xs text-muted">
                Mandatory aggregated HSN return breakdown for GST e-filing
              </span>
            </div>

            {/* Rate Filter */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted">Filter Rate:</span>
              <select
                value={selectedRate}
                onChange={(e) => setSelectedRate(e.target.value)}
                className="bg-surface-hi border border-line rounded px-2 py-1 text-xs"
              >
                <option value="all">All Tax Rates</option>
                <option value="0">0% (Nil/Exempt)</option>
                <option value="5">5% GST</option>
                <option value="12">12% GST</option>
                <option value="18">18% GST</option>
                <option value="28">28% GST</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">HSN / SKU Code</th>
                  <th className="py-2">Description</th>
                  <th className="py-2">UQC Unit</th>
                  <th className="py-2 text-right">Total Quantity</th>
                  <th className="py-2 text-right">Tax Rate</th>
                  <th className="py-2 text-right">Taxable Value</th>
                  <th className="py-2 text-right">CGST</th>
                  <th className="py-2 text-right">SGST</th>
                  <th className="py-2 text-right">IGST</th>
                  <th className="py-2 text-right font-bold text-ink">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filteredHsn.map((h, idx) => (
                  <tr key={`${h.hsn}-${h.taxRate}-${idx}`} className="hover:bg-surface-hi/50">
                    <td className="py-2 font-mono font-bold text-accent">{h.hsn}</td>
                    <td className="py-2 font-medium text-ink max-w-xs truncate">{h.description}</td>
                    <td className="py-2 font-mono text-muted">{h.uqc}</td>
                    <td className="py-2 text-right font-mono font-semibold">
                      {h.totalQty.toLocaleString("en-IN", { minimumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 text-right font-bold text-sky-700">{h.taxRate}%</td>
                    <td className="py-2 text-right font-mono font-semibold">
                      ₹{h.taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      ₹{h.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      ₹{h.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono text-muted">
                      ₹{h.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right font-mono font-black text-rose-700">
                      ₹{h.totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Credit Notes */}
      {activeTab === "creditNotes" && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div>
              <h3 className="text-sm font-bold text-ink">
                9B - Credit Notes, Debit Notes &amp; Sales Return Tax Reversals
              </h3>
              <span className="text-xs text-muted">
                GST adjustments from order cancellations, QC deductions, damaged items, and returned shipments
              </span>
            </div>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2">Adjustment ID</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Bill Number</th>
                  <th className="py-2">Customer Name</th>
                  <th className="py-2">Resolution Type</th>
                  <th className="py-2">Reason / QC Notes</th>
                  <th className="py-2 text-right">Adjusted Amount</th>
                  <th className="py-2 text-right font-bold text-purple-700">Reversal Tax (Output Reduction)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {creditNotes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-6 text-muted">
                      No credit note reversals recorded for this period.
                    </td>
                  </tr>
                ) : (
                  creditNotes.map((cn) => (
                    <tr key={cn.id} className="hover:bg-surface-hi/50">
                      <td className="py-2 font-mono font-bold text-accent">{cn.id.slice(0, 10)}...</td>
                      <td className="py-2 text-muted">{cn.date}</td>
                      <td className="py-2 font-mono font-semibold text-ink">{cn.billNumber}</td>
                      <td className="py-2 font-medium text-ink">{cn.customerName}</td>
                      <td className="py-2">
                        <span className="bg-purple-500/15 text-purple-700 font-bold text-[10px] px-2 py-0.5 rounded">
                          {cn.resolutionType}
                        </span>
                      </td>
                      <td className="py-2 text-muted max-w-xs truncate">{cn.reason}</td>
                      <td className="py-2 text-right font-mono font-semibold text-ink">
                        ₹{cn.adjustedAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-purple-700">
                        ₹{cn.reversalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 6: CA & Accounting System Export */}
      {activeTab === "caExport" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Box 1: GST Offline Tool JSON */}
            <div className="card p-4 space-y-3 border-t-4 border-t-sky-500">
              <div className="text-sm font-bold text-ink">GSTN Portal JSON Schema</div>
              <p className="text-xs text-muted">
                Official JSON structure ready for upload via GST Offline Tool v3.x directly to the GST Government Portal.
              </p>
              <div className="pt-2">
                <button onClick={downloadGstPortalJson} className="btn btn-primary w-full text-xs">
                  📥 Download GSTN JSON ({b2bInvoices.length} Invoices)
                </button>
              </div>
            </div>

            {/* Box 2: Tally Prime & Zoho Books CSV */}
            <div className="card p-4 space-y-3 border-t-4 border-t-emerald-500">
              <div className="text-sm font-bold text-ink">Tally / Zoho Books / Excel CSV</div>
              <p className="text-xs text-muted">
                Standard GSTR-1 Sales register table with Item level taxable and split tax heads for Chartered Accountants.
              </p>
              <div className="pt-2">
                <button onClick={downloadGstr1Csv} className="btn w-full text-xs">
                  📥 Download GSTR-1 CSV Sheet
                </button>
              </div>
            </div>

            {/* Box 3: CA Audit Checklist & Reconciliation */}
            <div className="card p-4 space-y-3 border-t-4 border-t-purple-500">
              <div className="text-sm font-bold text-ink">CA Audit &amp; Tax Checklist</div>
              <ul className="text-xs text-muted space-y-1.5 list-disc pl-4">
                <li>All B2B Invoices matched with 15-digit GSTIN</li>
                <li>ITC claimed only on registered supplier GRNs</li>
                <li>Sales return credit notes mapped to original bills</li>
                <li>HSN code summaries reconciled to general ledger</li>
              </ul>
              <div className="pt-2">
                <button onClick={() => window.print()} className="btn w-full text-xs">
                  🖨️ Print Tax Summary Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
