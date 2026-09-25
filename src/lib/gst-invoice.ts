/**
 * A4 GST tax invoice — the registered-dealer document, as distinct from the
 * 80mm "ESTIMATE" slip in invoice.ts that the counter prints all day.
 *
 * Laid out after the Tally invoices the shop already receives from its own
 * suppliers (vikas.pdf), so a buyer can read ours without relearning where
 * anything is: seller block, bill-to/ship-to, the goods table with HSN and
 * both rates, the tax foot, amount in words, and the HSN summary.
 *
 * Still plain HTML printed by the browser — no PDF dependency, same as the
 * slip. The empty Tally boxes (Delivery Note, Dispatch Doc No., Vehicle No.)
 * are deliberately not reproduced: the shop never fills them in.
 */

import { amountInWords, esc } from "./invoice";
import { fmtQty } from "./fmt";
import { gstTotals, hsnSummary, panOfGstin, round2, stateCodeOfGstin, stateName, type GstLine } from "./gst";

/** "INR Forty Six Thousand Two Hundred Fifty and Three paise Only" — the
 *  wording a Tally invoice prints, which is the phrasing buyers check against. */
export function rupeesInWords(amount: number): string {
  const n = Math.abs(Math.round(amount * 100)) / 100;
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  const head = `INR ${amountInWords(rupees)}`;
  return paise ? `${head} and ${amountInWords(paise)} paise Only` : `${head} Only`;
}

export type GstInvoiceLine = GstLine & { name: string; hsn: string; quantity: number; unit: string };

export type GstInvoiceArgs = {
  seller: { name: string; address: string; gstin: string; email?: string | null };
  buyer: { name: string; address?: string | null; gstin?: string | null; stateCode: string | null; mobile?: string | null };
  /** Ship-to, when the goods go somewhere other than the billing address. */
  shipTo?: string | null;
  invoiceNo: string;
  date: string; // YYYY-MM-DD
  terms?: string | null;
  notes?: string | null;
  lines: GstInvoiceLine[];
  interState: boolean;
};

const money = (n: number) => n.toFixed(2);
const pct = (n: number) => `${n.toFixed(2)}%`;

export function buildGstInvoiceHtml(a: GstInvoiceArgs): string {
  const totals = gstTotals(a.lines);
  const hsnRows = hsnSummary(a.lines);
  const sellerState = stateCodeOfGstin(a.seller.gstin);
  const pan = panOfGstin(a.seller.gstin);
  const [y, m, d] = a.date.split("-");
  const displayDate = y && m && d ? `${d}-${MONTHS[Number(m) - 1] ?? m}-${y.slice(2)}` : a.date;
  const totalQty = a.lines.reduce((s, l) => s + l.quantity, 0);
  // A bill of one unit reads "35.000 BAG"; mixed units can't be summed into
  // one label, so the column just shows the count.
  const units = [...new Set(a.lines.map((l) => l.unit).filter(Boolean))];
  const qtyLabel = `${fmtQty(totalQty)}${units.length === 1 ? ` ${units[0]}` : ""}`;

  const rows = a.lines
    .map(
      (l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="nm">${esc(l.name)}</td>
      <td class="c">${esc(l.hsn.trim() || "—")}</td>
      <td class="n">${fmtQty(l.quantity)} ${esc(l.unit)}</td>
      <td class="n">${money(l.rateExcl)}</td>
      <td class="n">${money(l.rateIncl)}</td>
      <td class="c">${esc(l.unit)}</td>
      <td class="n">${money(l.taxable)}</td>
    </tr>`
    )
    .join("");

  // One tax row per distinct RATE, not per HSN — two HSNs both at 5% are one
  // "Outward Cgst 2.5%" line on the bill, the way it is filed and the way the
  // supplier invoices the shop receives print it. The per-HSN split is the
  // summary table further down.
  const byRate = new Map<number, { cgst: number; sgst: number; igst: number }>();
  for (const r of hsnRows) {
    const at = byRate.get(r.taxPercent) ?? { cgst: 0, sgst: 0, igst: 0 };
    byRate.set(r.taxPercent, { cgst: round2(at.cgst + r.cgst), sgst: round2(at.sgst + r.sgst), igst: round2(at.igst + r.igst) });
  }
  const rates = [...byRate.entries()].sort((x, y) => x[0] - y[0]);
  const taxRows = a.interState
    ? rates.filter(([, v]) => v.igst > 0).map(([rate, v]) => taxRow(`Outward Igst ${pct(rate)}`, v.igst))
    : rates.flatMap(([rate, v]) =>
        v.cgst > 0 ? [taxRow(`Outward Cgst ${pct(rate / 2)}`, v.cgst), taxRow(`Outward Sgst ${pct(rate / 2)}`, v.sgst)] : []
      );

  const hsnHead = a.interState
    ? `<th class="n">IGST Rate</th><th class="n">IGST Amount</th>`
    : `<th class="n">CGST Rate</th><th class="n">CGST Amount</th><th class="n">SGST Rate</th><th class="n">SGST Amount</th>`;
  const hsnBody = hsnRows
    .map(
      (r) => `<tr><td>${esc(r.hsn)}</td><td class="n">${money(r.taxable)}</td>${
        a.interState
          ? `<td class="n">${pct(r.taxPercent)}</td><td class="n">${money(r.igst)}</td>`
          : `<td class="n">${pct(r.taxPercent / 2)}</td><td class="n">${money(r.cgst)}</td><td class="n">${pct(r.taxPercent / 2)}</td><td class="n">${money(r.sgst)}</td>`
      }<td class="n">${money(r.tax)}</td></tr>`
    )
    .join("");
  const hsnFootCols = a.interState
    ? `<td class="n">${money(totals.igst)}</td>`
    : `<td class="n">${money(totals.cgst)}</td><td class="n">${money(totals.sgst)}</td>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(a.invoiceNo)}</title>
<style>
  * { box-sizing: border-box; }
  html { font-size: 11px; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 1rem; line-height: 1.35; color: #000; margin: 0 auto; padding: 8mm; max-width: 210mm; }
  h1 { font-size: 1.3rem; text-align: center; margin: 0 0 6px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  .box, .box td, .box th { border: 1px solid #000; }
  .box td, .box th { padding: 3px 5px; vertical-align: top; }
  th { font-weight: 700; text-align: left; }
  .n { text-align: right; white-space: nowrap; }
  .c { text-align: center; white-space: nowrap; }
  .party { font-weight: 700; font-size: 1.1rem; }
  .lbl { color: #333; font-size: 0.9rem; }
  .goods thead th { text-align: center; font-size: 0.9rem; }
  .goods td.nm { text-transform: uppercase; }
  /* The goods table is stretched so the bill fills the page down to the tax
     foot, the way a pre-printed invoice pad does — otherwise a two-line bill
     leaves the totals floating under the header. */
  .goods tbody { height: 60mm; }
  .goods tbody tr:last-child td { border-bottom: none; }
  .goods tfoot td { font-weight: 700; }
  .words { font-size: 1rem; }
  .decl { font-size: 0.85rem; }
  .sign { text-align: right; height: 18mm; }
  .foot { text-align: center; font-size: 0.85rem; margin-top: 4px; }
  @page { size: A4; margin: 8mm; }
  @media print {
    body { padding: 0; max-width: none; }
    tr { break-inside: avoid; }
  }
</style></head>
<body>
  <h1>Tax Invoice</h1>
  <table class="box">
    <tr>
      <td rowspan="2" style="width:55%">
        <div class="party">${esc(a.seller.name)}</div>
        <div>${esc(a.seller.address).replace(/\n/g, "<br>")}</div>
        <div>GSTIN/UIN: ${esc(a.seller.gstin)}</div>
        <div>State Name : ${esc(stateName(sellerState))}, Code : ${esc(sellerState ?? "")}</div>
        ${a.seller.email ? `<div>E-Mail : ${esc(a.seller.email)}</div>` : ""}
      </td>
      <td style="width:22.5%"><span class="lbl">Invoice No.</span><br><strong>${esc(a.invoiceNo)}</strong></td>
      <td style="width:22.5%"><span class="lbl">Dated</span><br><strong>${displayDate}</strong></td>
    </tr>
    <tr>
      <td colspan="2"><span class="lbl">Mode/Terms of Payment</span><br>${esc(a.terms ?? "")}</td>
    </tr>
    <tr>
      <td rowspan="2">
        <div class="lbl">Buyer (Bill to)</div>
        <div class="party">${esc(a.buyer.name)}</div>
        ${a.buyer.address ? `<div>${esc(a.buyer.address).replace(/\n/g, "<br>")}</div>` : ""}
        ${a.buyer.mobile ? `<div>Mobile : ${esc(a.buyer.mobile)}</div>` : ""}
        ${a.buyer.gstin ? `<div>GSTIN/UIN: ${esc(a.buyer.gstin)}</div>` : ""}
        <div>State Name : ${esc(stateName(a.buyer.stateCode))}, Code : ${esc(a.buyer.stateCode ?? "")}</div>
      </td>
      <td colspan="2">
        <div class="lbl">Consignee (Ship to)</div>
        <div class="party">${esc(a.shipTo?.trim() || a.buyer.name)}</div>
      </td>
    </tr>
    <tr><td colspan="2"><span class="lbl">Place of Supply</span><br>${esc(stateName(a.buyer.stateCode) || stateName(sellerState))}</td></tr>
  </table>

  <table class="box goods">
    <thead><tr>
      <th style="width:5%">Sl<br>No.</th>
      <th>Description of Goods</th>
      <th style="width:10%">HSN/SAC</th>
      <th class="n" style="width:12%">Quantity</th>
      <th class="n" style="width:10%">Rate</th>
      <th class="n" style="width:11%">Rate<br>(Incl. of Tax)</th>
      <th style="width:6%">per</th>
      <th class="n" style="width:14%">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      ${taxRows.join("")}
      <tr><td colspan="3"></td><td class="n">${qtyLabel}</td><td colspan="3" class="n">Total</td><td class="n">&#8377; ${money(totals.total)}</td></tr>
    </tfoot>
  </table>

  <table class="box">
    <tr><td>
      <span class="lbl">Amount Chargeable (in words)</span><br>
      <strong class="words">${esc(rupeesInWords(totals.total))}</strong>
      <div class="n lbl">E. &amp; O.E</div>
    </td></tr>
  </table>

  <table class="box">
    <thead><tr><th>HSN/SAC</th><th class="n">Taxable Value</th>${hsnHead}<th class="n">Total Tax Amount</th></tr></thead>
    <tbody>${hsnBody}</tbody>
    <tfoot><tr>
      <td><strong>Total</strong></td><td class="n"><strong>${money(totals.taxable)}</strong></td>
      ${a.interState ? `<td></td>${hsnFootCols}` : `<td></td><td class="n"><strong>${money(totals.cgst)}</strong></td><td></td><td class="n"><strong>${money(totals.sgst)}</strong></td>`}
      <td class="n"><strong>${money(totals.tax)}</strong></td>
    </tr></tfoot>
  </table>

  <table class="box">
    <tr><td>
      <span class="lbl">Tax Amount (in words) :</span> <strong>${esc(rupeesInWords(totals.tax))}</strong>
      ${pan ? `<div>Company's PAN : <strong>${esc(pan)}</strong></div>` : ""}
      ${a.notes?.trim() ? `<div class="decl"><strong>Note:</strong> ${esc(a.notes.trim())}</div>` : ""}
    </td></tr>
    <tr>
      <td class="decl">
        <strong>Declaration</strong>
        <p style="margin:2px 0">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p>
        <p style="margin:2px 0">Goods once sold will not be taken back or exchanged. All disputes subject to local jurisdiction only.</p>
        <div class="sign"><strong>for ${esc(a.seller.name)}</strong><br><br><br>Authorised Signatory</div>
      </td>
    </tr>
  </table>
  <p class="foot">This is a Computer Generated Invoice</p>
</body></html>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const taxRow = (label: string, amount: number) =>
  `<tr><td colspan="3"></td><td colspan="4" class="n">${label}</td><td class="n">${money(amount)}</td></tr>`;
