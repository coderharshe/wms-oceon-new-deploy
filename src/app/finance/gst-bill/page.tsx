import { getSetting } from "@/lib/settings";
import GstBillForm from "./GstBillForm";

// Never prerendered. It reads a per-deployment setting from the database and
// sits behind auth, so there is nothing to freeze at build time — and trying
// to prerender it hangs the build for 60s against a DB the build host cannot
// reach. Every other server page here happens to avoid this by calling
// getSession() (cookies) before touching data; saying it outright means a
// later edit can't silently reintroduce the hang.
export const dynamic = "force-dynamic";

// Server wrapper for one reason: the seller's GSTIN. The screen needs it to
// show CGST+SGST vs IGST live as you type, and the settings endpoint that
// holds it is ADMIN-only — reading it here keeps Finance off that route.
export default async function GstBillPage() {
  const [gstin, name] = await Promise.all([getSetting("BUSINESS_GSTIN"), getSetting("BUSINESS_NAME")]);
  return <GstBillForm sellerGstin={gstin} sellerName={name} />;
}
