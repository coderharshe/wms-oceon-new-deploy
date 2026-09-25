import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, completeLogin, clientIp } from "@/lib/login";
import { getActiveSid, loginLockoutSeconds, recordLoginFailure, clearLoginFailures } from "@/lib/session-registry";

const schema = z.object({
  staffId: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const ip = clientIp(req);
  // Throttle keys: the account being guessed, and the box doing the guessing.
  // Every KV call here is wrapped to fail open — a KV outage must not lock
  // the warehouse out of its own app (same rule as the sid check in auth.ts).
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

  // One active device per account: if a session is already registered for
  // this user, this plain login is refused — the client shows a "sign out
  // the other device?" prompt and, if confirmed, calls the takeover flow
  // instead (see /api/auth/login/takeover*).
  const existingSid = await getActiveSid(user.id).catch(() => undefined);
  if (existingSid) {
    return NextResponse.json({ error: "ALREADY_LOGGED_IN" }, { status: 409 });
  }

  const result = await completeLogin(user, ip);
  return NextResponse.json(result);
}
