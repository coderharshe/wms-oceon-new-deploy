import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getSetting } from "@/lib/settings";

// What an offline till needs to print a provisional slip with no server to
// ask: the client caches this while online. Same source as the invoice route.
export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  return NextResponse.json({ businessName: (await getSetting("BUSINESS_NAME")) || "Store" });
}
