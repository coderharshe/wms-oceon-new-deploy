import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getSetting } from "@/lib/settings";
import { isGstin } from "@/lib/gst";
import { buildLookupUrl, extractDetails, parsePaths, LookupConfigError } from "@/lib/gstin-lookup";

/**
 * Looks a GSTIN up with the configured provider and returns just the name and
 * address, for the "Fetch details" button on the customer form.
 *
 * Server-side so the account key stays server-side — it is substituted into
 * the URL here and never reaches the browser. Unconfigured is a normal state,
 * not an error: the button simply isn't offered.
 */

// A counter clerk waiting on someone else's API must not hang the till.
const TIMEOUT_MS = 8000;

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const gstin = (req.nextUrl.searchParams.get("gstin") ?? "").trim().toUpperCase();
  // Check the digit before spending a lookup: a typo'd GSTIN is the most
  // likely reason a lookup would fail, and we can tell without asking anyone.
  if (!isGstin(gstin)) return NextResponse.json({ error: "That is not a valid GSTIN" }, { status: 400 });

  const [template, key, pathSpec] = await Promise.all([
    getSetting("GSTIN_LOOKUP_URL"),
    getSetting("GSTIN_LOOKUP_KEY"),
    getSetting("GSTIN_LOOKUP_PATHS"),
  ]);
  if (!template.trim()) {
    return NextResponse.json({ error: "GSTIN lookup is not set up. An admin can add a provider under Settings." }, { status: 501 });
  }

  let url: string;
  try {
    url = buildLookupUrl(template, gstin, key);
  } catch (err) {
    if (err instanceof LookupConfigError) return NextResponse.json({ error: err.message }, { status: 500 });
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch {
    return NextResponse.json({ error: "The GSTIN lookup service did not answer — type the details in instead" }, { status: 502 });
  }
  if (!res.ok) {
    // Deliberately not forwarding their body: it can echo the account key.
    return NextResponse.json({ error: `The GSTIN lookup service refused (${res.status})` }, { status: 502 });
  }

  const body = await res.json().catch(() => null);
  if (body == null) return NextResponse.json({ error: "The GSTIN lookup service sent something unreadable" }, { status: 502 });

  const paths = parsePaths(pathSpec || "name:taxpayerInfo.lgnm, tradeName:taxpayerInfo.tradeNam, address:taxpayerInfo.pradr.addr");
  const details = extractDetails(body, paths);
  if (!details.legalName && !details.tradeName && !details.address) {
    return NextResponse.json({ error: "The service answered but no name or address was found — check the field paths in Settings" }, { status: 422 });
  }
  return NextResponse.json({ gstin, ...details });
}
