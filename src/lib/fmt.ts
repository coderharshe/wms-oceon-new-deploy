// Display formatting for timestamps. Two things go wrong without it:
//
// 1. The DB driver returns DateTime columns as "YYYY-MM-DD HH:MM:SS.mmm"
//    (space-separated, no zone) — a UTC instant, but JS's Date constructor
//    reads the space-separated form as LOCAL time (unlike the "T" ISO form,
//    which is always UTC). That shift already caused a live QC-lock bug.
// 2. `toLocaleString()` with no arguments renders in the *browser's* zone,
//    so a laptop left on the wrong timezone shows the wrong bill time.
//
// The business runs on Delhi time, so everything user-facing is pinned to
// Asia/Kolkata. Storage stays UTC — one canonical instant, rendered locally.
export const BUSINESS_TZ = "Asia/Kolkata";

/** Parse a DB timestamp (Date, ISO string, or the driver's naive UTC form). */
export function parseDbTimestamp(value: Date | string): Date {
  if (value instanceof Date) return value;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value) ? value.replace(" ", "T") + "Z" : value;
  return new Date(iso);
}

const opts = (o: Intl.DateTimeFormatOptions) => ({ timeZone: BUSINESS_TZ, ...o });

/** "01/09/2026, 4:35:12 pm" IST. */
export function fmtDateTime(value: Date | string): string {
  return parseDbTimestamp(value).toLocaleString("en-IN", opts({ dateStyle: "short", timeStyle: "medium" }));
}

/** "01/09/2026" IST. */
export function fmtDate(value: Date | string): string {
  return parseDbTimestamp(value).toLocaleDateString("en-IN", opts({ dateStyle: "short" }));
}

/** "4:35:12 pm" IST. */
export function fmtTime(value: Date | string): string {
  return parseDbTimestamp(value).toLocaleTimeString("en-IN", opts({ timeStyle: "medium" }));
}

/**
 * Printed-invoice stamp, as { date: "YYYY-MM-DD", time: "HH:MM" } in IST.
 * The Worker runs on UTC, so slicing an ISO string put 5h30 earlier on the
 * bill — an evening sale printed with yesterday's date. sv-SE formats as
 * "YYYY-MM-DD HH:MM", which splits straight into the two fields.
 */
export function invoiceStamp(value: Date | string): { date: string; time: string } {
  const [date = "", time = ""] = parseDbTimestamp(value)
    .toLocaleString("sv-SE", { timeZone: BUSINESS_TZ, dateStyle: "short", timeStyle: "short" })
    .split(" ");
  return { date, time };
}

/**
 * Bill quantities: "2", not "2.00". Most lines are whole pieces, and a
 * counter reading "2.00 PCS" off a bill has to stop and check it isn't 2.05.
 * Fractions always show all 3 decimals: "0.500", not "0.5". A customer read
 * "0.5 kg" off a thermal bill as 5 kg — the trailing zeros make half a kilo
 * unmistakable. Three is also all the database keeps (Decimal(14,3)).
 */
export function fmtQty(value: number | string): string {
  const n = Math.round(Number(value) * 1000) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/**
 * Formats a unit and its conversion factor into a clean, concise readable string:
 * e.g. "kg (Base)", "1 Box = 12 Pcs", "1 Peti = 9 Bottles"
 */
export function fmtSaleUnit(
  unitSymbol: string,
  factorToBase: number | string,
  baseUnitSymbol?: string,
  isBaseUnit?: boolean
): string {
  const factor = Number(factorToBase);
  if (isBaseUnit || factor === 1 || !baseUnitSymbol || unitSymbol.toLowerCase() === baseUnitSymbol.toLowerCase()) {
    return isBaseUnit ? `${unitSymbol} (Base)` : unitSymbol;
  }
  const cleanFactor = Number.isInteger(factor) ? String(factor) : factor.toFixed(2);
  return `1 ${unitSymbol} = ${cleanFactor} ${baseUnitSymbol}`;
}

/**
 * Returns a short list of compact unit labels from a product's saleUnits array:
 * e.g. ["kg", "Box (×12)", "Carton (×24)"]
 */
export function fmtProductUnits(
  saleUnits: { unit?: { symbol: string }; factorToBase: number | string; isBaseUnit?: boolean }[],
  baseUnitSymbol?: string
): string[] {
  if (!Array.isArray(saleUnits) || saleUnits.length === 0) {
    return baseUnitSymbol ? [baseUnitSymbol] : [];
  }
  return saleUnits.map((su) => {
    const sym = su.unit?.symbol ?? baseUnitSymbol ?? "";
    const factor = Number(su.factorToBase);
    if (su.isBaseUnit || factor === 1 || !baseUnitSymbol) return sym;
    return `${sym} (×${Number.isInteger(factor) ? factor : factor.toFixed(2)})`;
  });
}
