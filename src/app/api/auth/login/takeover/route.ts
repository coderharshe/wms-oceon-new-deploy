import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, clientIp } from "@/lib/login";
import { createTakeover, loginLockoutSeconds, recordLoginFailure, clearLoginFailures } from "@/lib/session-registry";
import { publish } from "@/lib/realtime";

const schema = z.object({ staffId: z.string().min(1), password: z.string().min(1) });

// Called after a plain /api/auth/login is refused with ALREADY_LOGGED_IN and
// the user confirms "sign out the other device". Re-verifies credentials
// (don't let a bare account-name guess trigger a takeover prompt on someone
// else's screen) and starts the grace-period countdown; the already-logged-
// in device sees it via SSE and can deny it (see .../takeover-deny).
//
// Shares /api/auth/login's throttle keys, not its own: this route also calls
// verifyCredentials, so a separate budget here would just be a second door
// into the same password guessing.
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ip = clientIp(req);
  const keys = [`id:${body.data.staffId}`, ...(ip ? [`ip:${ip}`] : [])];
  const lockedFor = await loginLockoutSeconds(keys).catch(() => 0);
  if (lockedFor > 0) {
    return NextResponse.json({ error: "Too many failed attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(lockedFor) } });
  }

  const user = await verifyCredentials(body.data.staffId, body.data.password);
  if (user && user.role === "QC" && !(await (await import("@/lib/settings")).isQcEnabled())) {
    return NextResponse.json({ error: "QC is switched off. Ask your manager to turn it back on." }, { status: 403 });
  }
  if (!user) {
    await recordLoginFailure(keys).catch(() => {});
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  await clearLoginFailures(keys).catch(() => {});

  const takeoverId = crypto.randomUUID();
  const created = await createTakeover(takeoverId, user.id);
  if (!created) {
    // No KV in this environment (local dev) — can't run the grace-period
    // flow at all, so just fall back to blocking, same as before this
    // feature existed.
    return NextResponse.json({ error: "ALREADY_LOGGED_IN" }, { status: 409 });
  }

  // The old device is told the id (so it can deny) but never the secret —
  // only this response carries it, and only the client that proved the
  // password gets this response.
  publish(`user:${user.id}`, "session:takeover_requested", { takeoverId, expiresAt: created.expiresAt });
  return NextResponse.json({ takeoverId, secret: created.secret, expiresAt: created.expiresAt });
}
