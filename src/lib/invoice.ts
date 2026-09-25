// Plain, printable HTML invoice — not a PDF library. The browser's own
// print-to-PDF/print dialog covers "give the customer a document" without
// pulling in a PDF-generation dependency for a Workers-compatible layout.
// Styled after the shop's existing paper "ESTIMATE" pad so staff see the
// same layout on screen/print as they're used to on paper.

import { fmtQty } from "./fmt";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsToWords(n: number): string {
  let s = "";
  if (n >= 100) {
    s += ONES[Math.floor(n / 100)] + " Hundred ";
    n %= 100;
  }
  if (n >= 20) {
    s += TENS[Math.floor(n / 10)] + " ";
    n %= 10;
  }
  if (n > 0) s += ONES[n] + " ";
  return s.trim();
}

/** Indian numbering (crore/lakh/thousand), integer rupees only — plenty for a retail bill. */
export function amountInWords(rupees: number): string {
  let n = Math.round(Math.abs(rupees));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;
  if (crore) parts.push(threeDigitsToWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitsToWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitsToWords(thousand) + " Thousand");
  if (hundred) parts.push(threeDigitsToWords(hundred));
  return parts.join(" ");
}

/** Staff-typed text (names, notes) lands in a stored HTML file served from our
 *  own origin — escape it rather than trust the counter's keyboard. */
export const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function buildInvoiceHtml(args: {
  businessName: string;
  billNumber: string;
  orderNumber: string;
  date: string;
  time: string;
  customerName: string;
  customerMobile: string | null; // optional on the customer, so optional on the bill
  sellingMode: string;
  notes?: string | null;
  items: { name: string; quantity: string; unit: string; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
}) {
  const totalQty = args.items.reduce((s, it) => s + Number(it.quantity), 0);
  const rawTotal = Number(args.total);
  const gTotal = Math.round(rawTotal);
  const roundOff = gTotal - rawTotal;
  const [y, m, d] = args.date.split("-");
  const displayDate = y && m && d ? `${d}/${m}/${y}` : args.date;

  // A→Z by product name, so the counter finds a line on the paper at a glance.
  const rows = [...args.items]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
    .map(
      (it) =>
        `<tr><td class="idx">&bull;</td><td class="qty">${fmtQty(it.quantity)} ${it.unit}</td><td class="nm">${esc(it.name)}</td><td class="amt">${Number(it.lineTotal).toFixed(2)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(args.billNumber)}</title>
<style>
  * { box-sizing: border-box; }
  /* One knob for the whole slip: every size below is a rem off this, so the
     bill scales by changing this line alone. 12px could not be read across
     the counter; 14px is the counter's own call. The invoice is its own
     document, so the app's own root font-size never reaches in here. */
  html { font-size: 14px; }
  /* The whole slip prints bold — thermal/laser output on cheap paper is thin,
     and the customer copy gets read across a counter. */
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 1rem; line-height: 1.5; font-weight: 700; color: #111; max-width: 420px; margin: 16px auto; }
  h1 { font-size: 1.35rem; letter-spacing: 2px; text-align: center; margin: 0 0 2px; }
  /* The company name, boxed with a double rule so it stands out on thermal
     paper — no colour or shaded fill, which a thermal head can't print. */
  .co { display: table; margin: 2px auto 10px; padding: 1px 8px; border: 3px double #000; font-size: 1rem; letter-spacing: 0.5px; white-space: nowrap; }
  .row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; border-bottom: 1px solid #999; padding-bottom: 3px; margin-bottom: 4px; }
  /* A long customer name wraps rather than pushing the slip off the roll; the
     short right-hand value (bill no., date + time) stays whole, dropping to
     its own line when the two cannot share one. */
  .row span { overflow-wrap: anywhere; }
  .row span + span { white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th { border-bottom: 1.5px solid #111; padding: 6px 2px; text-align: left; font-size: 0.85rem; }
  thead th.qty, thead th.amt { text-align: right; }
  /* Solid black rule under every product — a grey dotted one vanished on thermal paper. */
  tbody td { border-bottom: 1px solid #000; padding: 6px 2px; font-size: 1rem; vertical-align: top; }
  /* Solid black and bigger: a thin grey dot fades on thermal paper. */
  td.idx { width: 1%; color: #000; font-size: 1.25rem; font-weight: 900; line-height: 1; }
  /* One line: "12.500 peti" must never wrap and split the number from its unit.
     width:1% shrinks a column to exactly its own text, so a bigger font widens
     the column instead of shoving the table off the 80mm roll. */
  td.qty { width: 1%; white-space: nowrap; }
  td.amt { width: 1%; text-align: right; white-space: nowrap; }
  /* Product names print in capitals — the counter reads them off the paper.
     The one column left flexible, so a long name wraps under itself rather
     than widening the bill. */
  td.nm { text-transform: uppercase; }
  .totals-row { display: flex; justify-content: space-between; border-top: 1.5px solid #111; margin-top: 6px; padding-top: 6px; font-size: 1rem; }
  .gtotal { display: flex; justify-content: space-between; font-size: 1.3rem; font-weight: 700; margin-top: 4px; }
  .words { margin-top: 8px; padding-top: 6px; border-top: 1px solid #999; font-size: 0.95rem; }
  .note { margin-top: 8px; font-size: 0.9rem; white-space: pre-wrap; }
  .terms { margin-top: 10px; font-size: 0.8rem; color: #333; }
  .terms p { margin: 2px 0; }
  .eoe { text-align: right; font-size: 0.8rem; color: #555; margin-top: 2px; }
  .thanks { text-align: center; margin-top: 12px; font-style: italic; font-weight: 600; }
  /* Thermal roll: one continuous page the height of the bill, no A4 letterbox
     and no blank second page. 80mm roll, ~72mm of printable head.
     ponytail: 80mm hardcoded — make it a setting only if a 58mm counter appears
     (then 58mm/48mm). */
  @page { size: 80mm auto; margin: 0; }
  @media print {
    html, body { width: 80mm; max-width: 80mm; height: auto; margin: 0; padding: 0; background: #fff; color: #000; }
    body { padding: 0 4mm; }
    body > *:last-child { margin-bottom: 0; }
    tr { break-inside: avoid; }
  }
</style></head>
<body>
  <h1>ESTIMATE</h1>
  <div class="co">TARESH GOLD FOODS PVT. LTD.</div>
  <div class="row"><span>Customer: ${esc(args.customerName)}</span><span>Bill No. ${esc(args.billNumber)}</span></div>
  <div class="row"><span>${args.customerMobile ? `Mobile: ${esc(args.customerMobile)}` : ""}</span><span>Date: ${displayDate} &nbsp; Time: ${args.time}</span></div>

  <table>
    <thead><tr><th></th><th class="qty">QTY</th><th>Description</th><th class="amt">Amt</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals-row"><span>Item Qty: ${fmtQty(totalQty)}</span><span>Round off: ${roundOff >= 0 ? "" : "-"}${Math.abs(roundOff).toFixed(2)}</span></div>
  <div class="gtotal"><span>G.TOTAL :-</span><span>₹${gTotal.toFixed(2)}</span></div>

  <div class="words">Rs. ${amountInWords(gTotal)} only</div>

  ${args.notes?.trim() ? `<div class="note"><strong>Note:</strong> ${esc(args.notes.trim())}</div>` : ""}

  <div class="terms">
    <strong>Terms &amp; Conditions :-</strong>
    <p>1. Goods once sold not be taken back &amp; no cash Refund.</p>
  </div>
  <div class="eoe">E.&amp;O.E</div>

  <p class="thanks">!!! Thanks !!! Visit Again !!!</p>
</body></html>`;
}
