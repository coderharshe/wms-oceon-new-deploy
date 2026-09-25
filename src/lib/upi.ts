import QRCode from "qrcode";
import { getSetting } from "./settings";

/** Thrown when UPI_VPA is missing — routes turn this into a 400 for the operator. */
export class UpiNotConfiguredError extends Error {}

/** Standard UPI deep-link payload that any UPI app can scan. */
export async function buildUpiLink(args: { amount: string; orderNumber: string; transactionId?: string }) {
  const vpa = (await getSetting("UPI_VPA")).trim();
  // No placeholder fallback: an unconfigured VPA still renders a perfectly
  // scannable QR, so the customer's money would go to whoever owns it.
  if (!vpa) throw new UpiNotConfiguredError("UPI VPA is not configured");
  const name = (await getSetting("BUSINESS_NAME")) || "Store";
  const params = new URLSearchParams({
    pa: vpa,
    pn: name,
    am: args.amount,
    tn: args.orderNumber,
    cu: "INR",
    // Transaction reference — the only handle that ties a line on the bank
    // statement back to this PaymentTransaction during reconciliation. Absent
    // on the public /pay QR, which is shown before any transaction exists.
    ...(args.transactionId ? { tr: args.transactionId } : {}),
  });
  return `upi://pay?${params.toString()}`;
}

export async function upiQrDataUrl(link: string) {
  return QRCode.toDataURL(link, { margin: 1, width: 320 });
}
