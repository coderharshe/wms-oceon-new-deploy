import type { ErrorFix } from "./api-error";

export type ApiError = {
  message: string;
  fix?: ErrorFix;
  actionLabel?: string;
  onAction?: () => void;
};

/** The sign-out case is the same everywhere, so it doesn't need 40 servers to say it. */
const SIGN_IN_AGAIN: ErrorFix = { label: "Sign in again", href: "/login" };

/**
 * Automatically infers an instant 1-click solution/navigation button
 * based on error content so the user can resolve issues without delay.
 */
export function inferErrorFix(message: string): ErrorFix | undefined {
  const lower = message.toLowerCase();
  if (lower.includes("session") || lower.includes("expired") || lower.includes("unauthorized") || lower.includes("sign in") || lower.includes("login") || lower.includes("credentials")) {
    return SIGN_IN_AGAIN;
  }
  if (lower.includes("warehouse")) {
    return { label: "🏢 Choose / Open Warehouses", href: "/admin/warehouses" };
  }
  if (lower.includes("staff id") || lower.includes("user") || lower.includes("password") || lower.includes("role") || lower.includes("permission")) {
    return { label: "👥 User Accounts", href: "/admin/users" };
  }
  if (lower.includes("stock") || lower.includes("inventory") || lower.includes("out of stock") || lower.includes("insufficient") || lower.includes("shortage")) {
    return { label: "📥 Receive / Inward Stock (GRN)", href: "/inventory/grn" };
  }
  if (lower.includes("product") || lower.includes("sku") || lower.includes("barcode") || lower.includes("unit") || lower.includes("hsn")) {
    return { label: "📦 Product Catalog & Barcodes", href: "/admin/products" };
  }
  if (lower.includes("customer") || lower.includes("credit limit") || lower.includes("outstanding") || lower.includes("balance")) {
    return { label: "👤 Customer Master", href: "/admin/customers" };
  }
  if (lower.includes("supplier") || lower.includes("grn") || lower.includes("purchase") || lower.includes("procurement") || lower.includes("vendor")) {
    return { label: "🚚 Supplier Management", href: "/admin/suppliers" };
  }
  if (lower.includes("gstin") || lower.includes("tax") || lower.includes("gst") || lower.includes("upi") || lower.includes("settings") || lower.includes("invoice prefix") || lower.includes("printer")) {
    return { label: "⚙️ System Settings", href: "/admin/settings" };
  }
  if (lower.includes("cash") || lower.includes("drawer") || lower.includes("session") || lower.includes("bank") || lower.includes("reconciliation") || lower.includes("float")) {
    return { label: "💵 Cash & Bank Register", href: "/admin/cash" };
  }
  if (lower.includes("qc") || lower.includes("quality") || lower.includes("inspection") || lower.includes("rejection")) {
    return { label: "🔍 QC Approval Queue", href: "/qc" };
  }
  if (lower.includes("discount") || lower.includes("rate") || lower.includes("price") || lower.includes("margin")) {
    return { label: "🏷️ Rates & Discounts", href: "/billing/discounts" };
  }
  if (lower.includes("voucher") || lower.includes("expense") || lower.includes("payment")) {
    return { label: "💳 Payments & Vouchers", href: "/finance/vouchers" };
  }
  if (lower.includes("network") || lower.includes("offline") || lower.includes("econnrefused") || lower.includes("timeout")) {
    return { label: "⚡ Offline Billing Mode", href: "/finance/orders/new" };
  }
  return undefined;
}

/**
 * Sanitizes technical stack traces, bcrypt hashes, or raw database messages
 * into clean, user-facing error explanations.
 */
export function sanitizeErrorMessage(raw: unknown, fallback = "Something went wrong"): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;

    // Filter out bcrypt tokens, hashes, and internal server protocol errors
    if (trimmed.includes("$2a$") || trimmed.includes("$2b$") || trimmed.toLowerCase().includes("bcrypt") || trimmed.includes("SCRAM")) {
      return "Authentication error. Please check your password.";
    }
    if (trimmed.includes("PrismaClient") || trimmed.includes("Unique constraint") || trimmed.includes("P2002")) {
      return "A record with this identifier already exists.";
    }
    if (trimmed.includes("ECONNREFUSED") || trimmed.includes("connectex") || trimmed.includes("P1001")) {
      return "Database server is temporarily unavailable. Please try again.";
    }
    return trimmed;
  }

  // Handle Zod flattened errors { fieldErrors, formErrors }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.fieldErrors && typeof obj.fieldErrors === "object") {
      const fieldErrors = obj.fieldErrors as Record<string, string[]>;
      const messages: string[] = [];
      for (const [field, errs] of Object.entries(fieldErrors)) {
        if (Array.isArray(errs) && errs.length > 0) {
          const readableField = field
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (str) => str.toUpperCase());
          messages.push(`${readableField}: ${errs.join(", ")}`);
        }
      }
      if (messages.length > 0) return messages.join(" • ");
    }
    if (Array.isArray(obj.formErrors) && obj.formErrors.length > 0) {
      return obj.formErrors.join(" • ");
    }
    if (typeof obj.message === "string") {
      return sanitizeErrorMessage(obj.message, fallback);
    }
  }

  return fallback;
}

/**
 * Turns a failed fetch Response into something showable.
 */
export async function readError(res: Response, fallback = "Something went wrong"): Promise<ApiError> {
  if (res.status === 401) return { message: "Your session has expired.", fix: SIGN_IN_AGAIN };

  const body: unknown = await res.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = sanitizeErrorMessage(record.error, fallback);
  
  // Use explicit fix sent by server
  let fix: ErrorFix | undefined = undefined;
  const rawFix = record.fix;
  if (
    typeof rawFix === "object" &&
    rawFix !== null &&
    typeof (rawFix as ErrorFix).label === "string" &&
    typeof (rawFix as ErrorFix).href === "string"
  ) {
    fix = rawFix as ErrorFix;
  }

  return fix ? { message, fix } : { message };
}
