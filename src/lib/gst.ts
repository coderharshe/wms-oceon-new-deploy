/**
 * GST tax-invoice arithmetic, shared by the Finance GST bill screen and its
 * route so the figures on screen, on paper and in the audit log cannot drift.
 *
 * Plain numbers rather than Decimal: this module is imported by a client page,
 * and the till's existing money math (offline-bills.ts) is number-based too.
 *
 * Rounding deliberately follows Tally, which is what the shop's own suppliers
 * print: the per-unit ex-tax rate is rounded to paise FIRST, then multiplied
 * by quantity, and CGST/SGST are each rounded separately rather than halving
 * one rounded total. That is where a bill's odd "and three paise" comes from,
 * and matching it is the point — a customer holding our invoice next to a
 * Tally one must see the same numbers. See the vikas.pdf check in
 * __tests__/run.ts, which reproduces a real supplier bill to the paisa.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** GST state codes — the first two digits of every GSTIN. */
export const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

// 2-digit state + 10-char PAN + entity number + "Z" + check character.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The 15th character of a GSTIN is a check digit over the first 14, so a
 * single mistyped character is detectable without asking anyone. Weights
 * alternate 1,2 and each product is folded (quotient + remainder, base 36)
 * before summing — the same scheme the GST portal uses.
 */
export function gstinChecksumOk(gstin: string): boolean {
  const v = gstin.trim().toUpperCase();
  if (v.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(v[i]!);
    if (value < 0) return false;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36] === v[14];
}

/**
 * A GSTIN printed on a tax invoice is a legal claim — validate, don't trust.
 * Shape AND check digit: the regex alone accepts a number that is one typo
 * away from a real one, and the state code and PAN on the invoice are both
 * read straight off these characters.
 */
export function isGstin(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toUpperCase();
  return GSTIN_RE.test(v) && gstinChecksumOk(v);
}

/** State code and PAN are both structural parts of a GSTIN, so neither needs
 *  its own settings field or customer column — read them off the number. */
export function stateCodeOfGstin(gstin: string | null | undefined): string | null {
  return isGstin(gstin) ? gstin!.trim().toUpperCase().slice(0, 2) : null;
}

export function panOfGstin(gstin: string | null | undefined): string | null {
  return isGstin(gstin) ? gstin!.trim().toUpperCase().slice(2, 12) : null;
}

export const stateName = (code: string | null | undefined) => (code ? STATE_CODES[code] ?? "" : "");

/**
 * Place of supply decides CGST+SGST vs IGST. An unregistered buyer has no
 * GSTIN to read a state off — for a counter sale that is a walk-in standing
 * in the shop, so the seller's own state is the honest default. The screen
 * lets whoever makes the bill override it.
 */
export function isInterState(sellerGstin: string, buyerStateCode: string | null): boolean {
  const seller = stateCodeOfGstin(sellerGstin);
  if (!seller || !buyerStateCode) return false;
  return seller !== buyerStateCode;
}

export type GstLineInput = {
  quantity: number;
  rate: number;
  taxPercent: number;
};

export type GstLine = ReturnType<typeof gstLine>;

/**
 * One invoice line's money. `inclusive` says whether `rate` already carries
 * the tax (the shop quoting a per-bag price the customer pays) or not (a rate
 * quoted ex-tax, which is how pricing.ts treats Product prices today).
 *
 * The Amount column on a Tally invoice is the TAXABLE value, not the
 * tax-inclusive one — the tax is then added once at the foot of the bill.
 */
export function gstLine(l: GstLineInput, inclusive: boolean, interState: boolean) {
  const t = Math.max(0, l.taxPercent);
  const qty = Math.max(0, l.quantity);
  const rateExcl = inclusive ? round2(l.rate / (1 + t / 100)) : round2(l.rate);
  const rateIncl = inclusive ? round2(l.rate) : round2(l.rate * (1 + t / 100));
  const taxable = round2(qty * rateExcl);
  // Each half rounded on its own: round2(x*2.5%)*2 and round2(x*5%) differ by
  // a paisa often enough that the printed CGST + SGST would not add up to the
  // printed tax total. The invoice shows all three, so all three must agree.
  const cgst = interState ? 0 : round2((taxable * (t / 2)) / 100);
  const sgst = cgst;
  const igst = interState ? round2((taxable * t) / 100) : 0;
  const tax = round2(cgst + sgst + igst);
  return { taxPercent: t, rateExcl, rateIncl, taxable, cgst, sgst, igst, tax, total: round2(taxable + tax) };
}

/** Invoice foot. Sums the already-rounded line figures, so the printed lines
 *  always add up to the printed total. */
export function gstTotals(lines: Pick<GstLine, "taxable" | "cgst" | "sgst" | "igst" | "tax">[]) {
  const sum = (pick: (l: (typeof lines)[number]) => number) => round2(lines.reduce((s, l) => s + pick(l), 0));
  const taxable = sum((l) => l.taxable);
  const tax = sum((l) => l.tax);
  return { taxable, cgst: sum((l) => l.cgst), sgst: sum((l) => l.sgst), igst: sum((l) => l.igst), tax, total: round2(taxable + tax) };
}

export type HsnRow = { hsn: string; taxPercent: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };

/**
 * The HSN/SAC summary table every tax invoice carries. Rolled up from the
 * rounded line figures for the same reason as gstTotals — the summary has to
 * reconcile with the lines above it, not merely be close.
 *
 * Grouped by HSN *and* rate: the same HSN can legitimately appear at two
 * rates, and the table prints one rate per row.
 */
export function hsnSummary(lines: (Pick<GstLine, "taxPercent" | "taxable" | "cgst" | "sgst" | "igst" | "tax"> & { hsn: string })[]): HsnRow[] {
  const rows = new Map<string, HsnRow>();
  for (const l of lines) {
    const hsn = l.hsn.trim() || "—";
    const key = `${hsn}@${l.taxPercent}`;
    const row = rows.get(key) ?? { hsn, taxPercent: l.taxPercent, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    row.taxable = round2(row.taxable + l.taxable);
    row.cgst = round2(row.cgst + l.cgst);
    row.sgst = round2(row.sgst + l.sgst);
    row.igst = round2(row.igst + l.igst);
    row.tax = round2(row.tax + l.tax);
    rows.set(key, row);
  }
  return [...rows.values()];
}
