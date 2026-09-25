import { NextResponse } from "next/server";
import { getSession, clearSessionCookie } from "@/lib/auth";
import { clearActiveSid } from "@/lib/session-registry";

export async function POST() {
  const session = await getSession();
  await clearSessionCookie();
  // Frees the "one device" slot immediately, so logging in again elsewhere
  // right after doesn't trigger the takeover/deny flow unnecessarily.
  if (session) await clearActiveSid(session.sub).catch(() => {});
  return NextResponse.json({ ok: true });
}
