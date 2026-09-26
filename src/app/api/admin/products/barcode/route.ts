import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

// Issues an internal barcode for goods that carry no manufacturer code
// (loose rice, repacked spices, anything unbranded). Reuses the same
// Counter-table sequence that backs order/bill numbers, so two admins
// generating at once can never land on the same code (PRD §37).
//
// The code is NOT persisted here — it's handed to the create/edit form,
// which saves it onto a ProductUnit row when the product itself is saved.
// A code generated and then abandoned just burns a sequence number, which
// is cheaper than a reservation table nobody would ever clean up.
//
// Format is `WMS-YYYYMMDD-NNNN` (from nextNumber) — plain alphanumeric, which
// is why the labels print as Code128: it encodes arbitrary text, unlike
// EAN-13 which demands exactly 13 digits with a checksum.
export async function POST() {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "PROCUREMENT", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { nextNumberDrizzle } = await import("@/lib/drizzle-numbering");
    const code = await nextNumberDrizzle(getDrizzleDb(), "unit-barcode", "WMS");
    return NextResponse.json({ code });
  }

  const db = (await import("@/lib/db")).getDb();
  const { nextNumber } = await import("@/lib/numbering");
  const code = await db.$transaction((tx) => nextNumber(tx, "unit-barcode", "WMS"));
  return NextResponse.json({ code });
}
