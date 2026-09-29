import { amountInWords, esc } from "./invoice";
import { fmtDate } from "./fmt";

export type PurchaseOrderPrintData = {
  id: string;
  poNumber: string;
  createdAt: string;
  expectedDelivery?: string | null;
  status: string;
  notes?: string | null;
  creditDays?: number | null;
  freightCharges?: number | string | null;
  otherCharges?: number | string | null;
  subtotal: number | string;
  gstAmount: number | string;
  total: number | string;
  supplier: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    gstin?: string | null;
    address?: string | null;
    email?: string | null;
  };
  warehouse?: {
    id?: string;
    name: string;
    code: string;
    address?: string | null;
  } | null;
  createdByUser?: {
    name: string;
  } | null;
  items: Array<{
    id: string;
    product: {
      name: string;
      sku: string;
      hsn?: string | null;
    };
    unit: {
      symbol: string;
    };
    quantity: number | string;
    purchaseRate: number | string;
    taxPercent: number | string;
    schemeDiscount?: number | string | null;
    lineTotal: number | string;
  }>;
  companyInfo?: {
    name?: string;
    gstin?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
};

export function buildPurchaseOrderHtml(po: PurchaseOrderPrintData): string {
  const companyName = po.companyInfo?.name || "OCEON PVT. LTD.";
  const companyGstin = po.companyInfo?.gstin || "06AQNPG1418P1ZK";
  const companyAddress = po.companyInfo?.address || "Central Distribution Hub, Sector 18, Industrial Area, New Delhi - 110020";
  const companyPhone = po.companyInfo?.phone || "+91 98765 43210";
  const companyEmail = po.companyInfo?.email || "purchase@oceon.com";

  const totalNum = Number(po.total) || 0;
  const subtotalNum = Number(po.subtotal) || 0;
  const gstNum = Number(po.gstAmount) || 0;
  const freightNum = Number(po.freightCharges) || 0;
  const otherNum = Number(po.otherCharges) || 0;

  const totalQty = po.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  const formattedDate = fmtDate(po.createdAt);
  const formattedExpectedDate = po.expectedDelivery ? fmtDate(po.expectedDelivery) : "Immediate / On Demand";

  const rowsHtml = po.items
    .map((item, idx) => {
      const rate = Number(item.purchaseRate) || 0;
      const taxPct = Number(item.taxPercent) || 0;
      const lineTotal = Number(item.lineTotal) || 0;
      const taxable = Number(item.quantity) * rate - (Number(item.schemeDiscount) || 0);
      const taxAmt = (taxable * taxPct) / 100;

      return `
        <tr>
          <td class="text-center font-mono">${idx + 1}</td>
          <td>
            <div class="item-name">${esc(item.product.name)}</div>
            <div class="item-sku">SKU: ${esc(item.product.sku)}${item.product.hsn ? ` · HSN: ${esc(item.product.hsn)}` : ""}</div>
          </td>
          <td class="text-center font-mono font-bold">${item.quantity} ${esc(item.unit?.symbol || "PCS")}</td>
          <td class="text-right font-mono">₹${rate.toFixed(2)}</td>
          <td class="text-right font-mono">₹${taxable.toFixed(2)}</td>
          <td class="text-center font-mono">${taxPct > 0 ? `${taxPct}%` : "0%"}</td>
          <td class="text-right font-mono">₹${taxAmt.toFixed(2)}</td>
          <td class="text-right font-mono font-bold">₹${lineTotal.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Purchase Order - ${esc(po.poNumber)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    *, *:before, *:after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .po-container {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
      border: 1px solid #cbd5e1;
      padding: 10px 14px;
    }
    
    /* Header */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 6px;
    }
    .header-table td {
      vertical-align: top;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
    .company-desc {
      font-size: 10px;
      color: #475569;
      margin-top: 1px;
      max-width: 320px;
    }
    .doc-type-badge {
      text-align: right;
    }
    .doc-title {
      font-size: 20px;
      font-weight: 900;
      color: #1e3a8a;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .po-number {
      font-size: 12px;
      font-family: monospace;
      font-weight: 700;
      color: #0f172a;
      margin-top: 2px;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      font-size: 9px;
      font-weight: 700;
      border-radius: 4px;
      text-transform: uppercase;
      margin-top: 3px;
      border: 1px solid #94a3b8;
      background: #f1f5f9;
      color: #0f172a;
    }

    /* Meta details grid */
    .meta-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .meta-box {
      width: 50%;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      vertical-align: top;
    }
    .meta-box-title {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 2px;
      margin-bottom: 4px;
    }
    .party-name {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
    }
    .party-details {
      font-size: 10px;
      color: #334155;
      margin-top: 2px;
      line-height: 1.3;
    }

    /* Items Table */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6px;
    }
    .items-table th {
      background: #0f172a;
      color: #ffffff;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 5px 6px;
      border: 1px solid #0f172a;
    }
    .items-table td {
      padding: 5px 6px;
      border: 1px solid #cbd5e1;
      font-size: 10px;
      vertical-align: middle;
    }
    .items-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .item-name {
      font-weight: 700;
      color: #0f172a;
    }
    .item-sku {
      font-size: 9px;
      color: #64748b;
      font-family: monospace;
    }

    /* Totals & Summary */
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .summary-table td {
      vertical-align: top;
    }
    .words-box {
      width: 58%;
      padding-right: 12px;
    }
    .numbers-box {
      width: 42%;
    }
    .totals-breakdown {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
    }
    .totals-breakdown td {
      padding: 3.5px 8px;
      font-size: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    .totals-breakdown tr.grand-row {
      background: #f1f5f9;
      font-weight: 800;
      font-size: 12px;
      border-top: 2px solid #0f172a;
      border-bottom: none;
    }

    /* Terms & Footer */
    .footer-section {
      border-top: 1px solid #cbd5e1;
      padding-top: 6px;
      margin-top: 4px;
    }
    .instructions-box {
      font-size: 9px;
      color: #475569;
      line-height: 1.3;
      margin-bottom: 8px;
    }
    .signatures-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    .signatures-table td {
      width: 50%;
      vertical-align: bottom;
      text-align: center;
      padding-top: 24px;
    }
    .sign-line {
      border-top: 1px dashed #64748b;
      margin: 0 20px 4px 20px;
      padding-top: 3px;
      font-size: 9.5px;
      font-weight: 600;
      color: #334155;
    }

    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-bold { font-weight: 700; }
  </style>
</head>
<body>
  <div class="po-container">
    <!-- Header -->
    <table class="header-table">
      <tr>
        <td>
          <div class="brand-title">${esc(companyName)}</div>
          <div class="company-desc">
            ${esc(companyAddress)}<br>
            <strong>GSTIN:</strong> ${esc(companyGstin)} · <strong>Phone:</strong> ${esc(companyPhone)} · <strong>Email:</strong> ${esc(companyEmail)}
          </div>
        </td>
        <td class="doc-type-badge">
          <div class="doc-title">PURCHASE ORDER</div>
          <div class="po-number">PO NO: ${esc(po.poNumber)}</div>
          <div><small>Date:</small> <strong>${formattedDate}</strong></div>
          <div class="status-badge">${esc(po.status)}</div>
        </td>
      </tr>
    </table>

    <!-- Meta Grid -->
    <table class="meta-grid">
      <tr>
        <!-- Vendor / Supplier -->
        <td class="meta-box" style="border-right: none;">
          <div class="meta-box-title">Vendor / Supplier Details:</div>
          <div class="party-name">${esc(po.supplier.name)}</div>
          <div class="party-details">
            ${po.supplier.address ? `${esc(po.supplier.address)}<br>` : ""}
            <strong>GSTIN:</strong> ${esc(po.supplier.gstin || "Unregistered / Not Provided")}<br>
            <strong>Contact:</strong> ${esc(po.supplier.contactPerson || po.supplier.phone || "N/A")} 
            ${po.supplier.phone && po.supplier.contactPerson ? `(${esc(po.supplier.phone)})` : ""}
            ${po.supplier.email ? `<br><strong>Email:</strong> ${esc(po.supplier.email)}` : ""}
          </div>
        </td>

        <!-- Ship To / Delivery Target -->
        <td class="meta-box">
          <div class="meta-box-title">Ship-To / Delivery Destination:</div>
          <div class="party-name">${esc(po.warehouse?.name || "Main Central Warehouse")} ${po.warehouse?.code ? `(${esc(po.warehouse.code)})` : ""}</div>
          <div class="party-details">
            <strong>Delivery Address:</strong> ${esc(po.warehouse?.address || companyAddress)}<br>
            <strong>Expected Delivery:</strong> <span style="font-weight: 700; color: #1e3a8a;">${formattedExpectedDate}</span><br>
            <strong>Payment / Credit Terms:</strong> ${po.creditDays ? `${po.creditDays} Days Credit` : "Immediate / Standard Terms"}<br>
            <strong>PO Issued By:</strong> ${esc(po.createdByUser?.name || "Purchasing Officer")}
          </div>
        </td>
      </tr>
    </table>

    <!-- Line Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 25px;">#</th>
          <th>Item Description & SKU</th>
          <th style="width: 55px;" class="text-center">Qty</th>
          <th style="width: 65px;" class="text-right">Rate</th>
          <th style="width: 70px;" class="text-right">Taxable</th>
          <th style="width: 45px;" class="text-center">GST %</th>
          <th style="width: 60px;" class="text-right">GST (₹)</th>
          <th style="width: 75px;" class="text-right">Total (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <!-- Summary & Totals -->
    <table class="summary-table">
      <tr>
        <td class="words-box">
          <div style="font-size: 9.5px; margin-bottom: 4px;">
            <strong>Total Quantity:</strong> ${totalQty} Units across ${po.items.length} Line Item(s)
          </div>
          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 8px; font-size: 9.5px; line-height: 1.35;">
            <strong>Amount in Words:</strong><br>
            <span style="font-weight: 700; color: #0f172a;">INR ${amountInWords(Math.round(totalNum))} Rupees Only</span>
          </div>
          ${
            po.notes
              ? `<div style="margin-top: 5px; font-size: 9px; color: #475569;">
                   <strong>Special Instructions / Notes:</strong> ${esc(po.notes)}
                 </div>`
              : ""
          }
        </td>

        <td class="numbers-box">
          <table class="totals-breakdown">
            <tr>
              <td class="text-muted">Subtotal (Excl. Tax):</td>
              <td class="text-right font-mono">₹${subtotalNum.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="text-muted">Total GST / Taxes:</td>
              <td class="text-right font-mono">+₹${gstNum.toFixed(2)}</td>
            </tr>
            ${
              freightNum > 0
                ? `<tr>
                    <td class="text-muted">Freight & Transport:</td>
                    <td class="text-right font-mono">+₹${freightNum.toFixed(2)}</td>
                  </tr>`
                : ""
            }
            ${
              otherNum > 0
                ? `<tr>
                    <td class="text-muted">Other Charges:</td>
                    <td class="text-right font-mono">+₹${otherNum.toFixed(2)}</td>
                  </tr>`
                : ""
            }
            <tr class="grand-row">
              <td>Grand Total:</td>
              <td class="text-right font-mono" style="color: #0f172a;">₹${totalNum.toFixed(2)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Footer Terms & Signatures -->
    <div class="footer-section">
      <div class="instructions-box">
        <strong>Terms & Conditions:</strong>
        1. Please supply the goods strictly according to the approved purchase order rates and specifications.
        2. Delivery must be accompanied by the original Tax Invoice and Delivery Challan mentioning PO #${esc(po.poNumber)}.
        3. Damaged or non-compliant stock will be returned at vendor's expense during GRN verification.
      </div>

      <table class="signatures-table">
        <tr>
          <td>
            <div class="sign-line">Supplier / Vendor Acceptance (Sign & Stamp)</div>
          </td>
          <td>
            <div class="sign-line">For ${esc(companyName)} (Authorized Signatory)</div>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 200);
    };
  </script>
</body>
</html>`;
}

/**
 * Triggers printing of the purchase order via an invisible iframe or new window.
 */
export function printPurchaseOrder(po: PurchaseOrderPrintData) {
  const html = buildPurchaseOrderHtml(po);
  const win = window.open("", "_blank", "width=850,height=900");
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } else {
    // Fallback: iframe print
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 2000);
      }, 300);
    }
  }
}
