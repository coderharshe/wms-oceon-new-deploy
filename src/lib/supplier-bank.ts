/**
 * Utilities to parse, serialize, and display structured Supplier Bank & Payment Details.
 * Handles both structured JSON payloads and legacy plain-text fallback strings.
 */

export interface SupplierBankInfo {
  accountHolder?: string;
  accountNumber?: string;
  bankName?: string;
  ifsc?: string;
  branch?: string;
  upiId?: string;
}

/**
 * Safely parse a raw bankDetails string (which may be JSON or free-form text)
 * into a typed SupplierBankInfo object.
 */
export function parseSupplierBankDetails(raw?: string | null): SupplierBankInfo {
  if (!raw || !raw.trim()) {
    return {};
  }

  const trimmed = raw.trim();

  // 1. Try parsing as JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        return {
          accountHolder: typeof parsed.accountHolder === "string" ? parsed.accountHolder.trim() : undefined,
          accountNumber: typeof parsed.accountNumber === "string" ? parsed.accountNumber.trim() : undefined,
          bankName: typeof parsed.bankName === "string" ? parsed.bankName.trim() : undefined,
          ifsc: typeof parsed.ifsc === "string" ? parsed.ifsc.trim().toUpperCase() : undefined,
          branch: typeof parsed.branch === "string" ? parsed.branch.trim() : undefined,
          upiId: typeof parsed.upiId === "string" ? parsed.upiId.trim() : undefined,
        };
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // 2. Fallback heuristic parser for legacy formatted strings (e.g., "HDFC - 123456789, IFSC: HDFC0001, UPI: mva@hdfc")
  const result: SupplierBankInfo = {};

  // Extract IFSC code (4 letters, 0, 6 alphanumeric)
  const ifscMatch = trimmed.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i);
  if (ifscMatch && ifscMatch[1]) {
    result.ifsc = ifscMatch[1].toUpperCase();
  }

  // Extract UPI ID
  const upiMatch = trimmed.match(/UPI[:\s]+([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)/i) || trimmed.match(/\b([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)\b/);
  if (upiMatch && upiMatch[1]) {
    result.upiId = upiMatch[1];
  }

  // Extract Account Number (numeric sequence of 8-18 digits)
  const accMatch = trimmed.match(/(?:A\/C|AC|Account|No\.?|Num[:\s]*)([0-9]{8,18})/i) || trimmed.match(/\b([0-9]{9,18})\b/);
  if (accMatch && accMatch[1]) {
    result.accountNumber = accMatch[1];
  }

  // Extract Bank Name prefix or keyword
  const bankMatch = trimmed.match(/^([A-Za-z\s]+?)(?:-|\band\b|A\/C|Account|IFSC|:|,)/i);
  if (bankMatch && bankMatch[1] && bankMatch[1].trim().length > 2) {
    result.bankName = bankMatch[1].trim();
  } else if (!result.accountNumber && !result.ifsc && !result.upiId) {
    result.bankName = trimmed;
  }

  return result;
}

/**
 * Serializes a SupplierBankInfo object into a clean JSON string for storage in `Supplier.bankDetails`.
 * Returns null if all fields are empty.
 */
export function serializeSupplierBankDetails(info: SupplierBankInfo): string | null {
  const clean: SupplierBankInfo = {};

  if (info.accountHolder?.trim()) clean.accountHolder = info.accountHolder.trim();
  if (info.accountNumber?.trim()) clean.accountNumber = info.accountNumber.trim();
  if (info.bankName?.trim()) clean.bankName = info.bankName.trim();
  if (info.ifsc?.trim()) clean.ifsc = info.ifsc.trim().toUpperCase();
  if (info.branch?.trim()) clean.branch = info.branch.trim();
  if (info.upiId?.trim()) clean.upiId = info.upiId.trim();

  if (Object.keys(clean).length === 0) {
    return null;
  }

  return JSON.stringify(clean);
}

/**
 * Generates a human-friendly single-line bank summary for tables and chips.
 */
export function formatBankSummary(raw?: string | null | SupplierBankInfo): string {
  const info = typeof raw === "string" || raw === null || raw === undefined
    ? parseSupplierBankDetails(raw)
    : raw;

  const parts: string[] = [];
  if (info.bankName) parts.push(info.bankName);
  if (info.accountNumber) parts.push(`A/C: ${info.accountNumber}`);
  if (info.ifsc) parts.push(`IFSC: ${info.ifsc}`);
  if (info.upiId) parts.push(`UPI: ${info.upiId}`);

  if (parts.length === 0) {
    return typeof raw === "string" && raw.trim() ? raw : "No bank details on file";
  }

  return parts.join(" | ");
}
