/**
 * The GST invoice register: what the Finance "Past invoices" screen reads.
 *
 * A GST tax invoice is deliberately standalone — no Order, no Bill row — so
 * its audit row IS the record, not a description of one. This module owns the
 * shape of that row so the route that writes it (api/finance/gst-bill) and
 * the screens that read it cannot drift apart.
 *
 * Audit rows are never pruned (only R2 backups are, see worker.ts), so the
 * register does not quietly lose invoices the way a cache would.
 */

export const GST_ENTITY_TYPE = "GstInvoice";
export const GST_ISSUED = "GST_INVOICE_ISSUED";
export const GST_DEDUCTED_LATER = "GST_INVOICE_STOCK_DEDUCTED";

export type GstInvoiceItem = {
  productId: string;
  unitId: string;
  name: string;
  unit: string;
  hsn: string;
  quantity: number;
  rate: number;
  taxPercent: number;
  renamed?: boolean;
};

export type GstInvoiceRecord = {
  customerId: string;
  customerName: string;
  total: number;
  taxable: number;
  tax: number;
  interState: boolean;
  placeOfSupply: string | null;
  inclusive: boolean;
  lines: number;
  stockDeducted: boolean;
  supersedes: string | null;
  key: string;
  items: GstInvoiceItem[];
};

export type RegisterRow = GstInvoiceRecord & {
  invoiceNo: string;
  issuedAt: string;
  issuedBy: string | null;
  /** Stock moved later from the register rather than at issue time. */
  deductedLater: boolean;
  /** Invoice number that replaced this one, if it was revised. */
  supersededBy: string | null;
  url: string;
};

/** A row older than this change has no `items` — it cannot be re-issued or
 *  deducted from, and the screen must say so rather than offer a dead button. */
export const isReplayable = (r: RegisterRow) => Array.isArray(r.items) && r.items.length > 0;

/** Stock is accounted for if it moved at issue time or was moved since. */
export const isStockSettled = (r: RegisterRow) => r.stockDeducted || r.deductedLater;

type RawLog = { entityId: string; timestamp: Date | string; newValue: unknown; userId: string | null; action: string };

/**
 * Folds the raw audit rows into one row per invoice. Two actions land against
 * the same entityId — the issue itself, and a later stock deduction — so the
 * later rows are merged onto the invoice they belong to rather than showing
 * up as phantom extra invoices in the register.
 */
export function buildRegister(logs: RawLog[], userNames: Map<string, string>): RegisterRow[] {
  const issued = logs.filter((l) => l.action === GST_ISSUED);
  const deductedLater = new Set(logs.filter((l) => l.action === GST_DEDUCTED_LATER).map((l) => l.entityId));

  const rows = issued.map((l) => {
    const rec = (l.newValue ?? {}) as Partial<GstInvoiceRecord>;
    return {
      ...(rec as GstInvoiceRecord),
      items: rec.items ?? [],
      invoiceNo: l.entityId,
      issuedAt: typeof l.timestamp === "string" ? l.timestamp : l.timestamp.toISOString(),
      issuedBy: l.userId ? userNames.get(l.userId) ?? null : null,
      deductedLater: deductedLater.has(l.entityId),
      supersededBy: null as string | null,
      // Older invoices predate the stored key; the shape has always been
      // derivable from the warehouse and number, so fall back rather than
      // hand the screen a dead link.
      url: `/api/files/${rec.key ?? ""}`,
    } satisfies RegisterRow;
  });

  // A revision names the invoice it replaces; show that on BOTH, so neither
  // side of a correction can be read on its own and mistaken for the truth.
  const byNumber = new Map(rows.map((r) => [r.invoiceNo, r]));
  for (const r of rows) {
    if (r.supersedes) {
      const old = byNumber.get(r.supersedes);
      if (old) old.supersededBy = r.invoiceNo;
    }
  }
  return rows;
}

/** Month filter value ("2026-09") against an ISO timestamp, in the business
 *  timezone — a 23:40 IST invoice belongs to that day's month, not UTC's. */
export function inMonth(issuedAt: string, month: string, timeZone = "Asia/Kolkata"): boolean {
  if (!month) return true;
  const local = new Date(issuedAt).toLocaleDateString("sv-SE", { timeZone });
  return local.slice(0, 7) === month;
}

export function matchesSearch(r: RegisterRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return r.invoiceNo.toLowerCase().includes(needle) || (r.customerName ?? "").toLowerCase().includes(needle);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Excel reads a leading =, +, - or @ as a formula. Quote-and-prefix so an
  // exported customer name can never execute in the accountant's spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** GSTR-1-shaped export: one row per invoice, the figures an accountant files. */
export function toCsv(rows: RegisterRow[]): string {
  const head = ["Invoice No", "Date", "Customer", "Place of Supply", "Taxable Value", "Tax", "Total", "Tax Type", "Stock Deducted", "Supersedes", "Superseded By", "Issued By"];
  const body = rows.map((r) =>
    [
      r.invoiceNo,
      new Date(r.issuedAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" }),
      r.customerName,
      r.placeOfSupply ?? "",
      r.taxable?.toFixed(2) ?? "",
      r.tax?.toFixed(2) ?? "",
      r.total?.toFixed(2) ?? "",
      r.interState ? "IGST" : "CGST+SGST",
      isStockSettled(r) ? "Yes" : "No",
      r.supersedes ?? "",
      r.supersededBy ?? "",
      r.issuedBy ?? "",
    ].map(csvCell).join(",")
  );
  return [head.join(","), ...body].join("\r\n");
}
