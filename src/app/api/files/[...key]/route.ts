import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth";
import { assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { getFile } from "@/lib/r2";

/**
 * Resolves the warehouse that owns an invoice object and applies the same
 * PRD §6 check every other route uses. Every invoice key shape carries its
 * owner: `invoices/<billNumber>.html` (finance invoice, from
 * finance/orders/[id]/invoice) and `purchase-bills/<id>/<n>.<ext>` (the
 * photographed supplier bill) name a row to look the warehouse up on, while
 * `gst-invoices/<warehouseId>/<invoiceNo>.html` carries the warehouse itself
 * — a GST tax invoice is deliberately standalone (no Order, no Bill), so
 * there is no row to resolve it against. A forged warehouse segment gains
 * nothing: it only passes this check for a warehouse the caller is already in,
 * and the object itself still has to exist. Anything else under those
 * prefixes is refused rather than served — an unrecognised shape means we
 * can't prove ownership.
 */
async function invoiceWarehouseId(key: string): Promise<string | null> {
  const gst = key.match(/^gst-invoices\/([^/]+)\/[^/]+\.html$/);
  if (gst) return gst[1]!;

  const purchase = key.match(/^purchase-bills\/([^/]+)\//);
  const invoice = key.match(/^invoices\/(.+)\.html$/);
  if (!purchase && !invoice) return null;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { bill, purchaseBill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();
    if (purchase) {
      const [row] = await db.select({ warehouseId: purchaseBill.warehouseId }).from(purchaseBill).where(eq(purchaseBill.id, purchase[1]!));
      return row?.warehouseId ?? null;
    }
    const [row] = await db.select({ warehouseId: bill.warehouseId }).from(bill).where(eq(bill.billNumber, invoice![1]!));
    return row?.warehouseId ?? null;
  }

  const db = (await import("@/lib/db")).getDb();
  if (purchase) {
    const row = await db.purchaseBill.findUnique({ where: { id: purchase[1]! }, select: { warehouseId: true } });
    return row?.warehouseId ?? null;
  }
  const row = await db.bill.findUnique({ where: { billNumber: invoice![1]! }, select: { warehouseId: true } });
  return row?.warehouseId ?? null;
}

// Product images are the only thing served without auth (they're not
// sensitive and the QR/payment display screens may want to show one one
// day). Backups are the full-database dump (every order/payment/customer) —
// the admin-only bar the /api/admin/backup route already enforces to
// list/create them would be pointless if anyone signed in could still fetch
// one directly by key, so that's enforced here too.
//
// Everything else is an invoice, and a signed-in session used to be the
// whole bar — which let a QC user in warehouse A pull warehouse B's invoices
// by guessing a billNumber-derived key, the one place in the app that didn't
// honour assertWarehouseAccess. It does now (ADMIN still bypasses).
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join("/");

  if (!key.startsWith("products/")) {
    const session: SessionPayload | null = await getSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (key.startsWith("backups/")) {
      // Manager too, matching /api/admin/backup — the dump is the whole
      // database, so this pair of guards has to stay in step or the listing
      // hands out keys that won't download.
      if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (session.role !== "ADMIN") {
      const warehouseId = await invoiceWarehouseId(key);
      // No resolvable owner: either an unknown key shape or a deleted row.
      // 404 rather than 403 — don't confirm which.
      if (!warehouseId) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, warehouseId);
      if (forbidden) return forbidden;
    }
  }

  const object = await getFile(key);
  if (!object) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": key.startsWith("products/") ? "public, max-age=86400" : "private, no-store",
    },
  });
}
