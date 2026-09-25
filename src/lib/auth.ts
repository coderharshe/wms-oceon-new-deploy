import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { getEnv } from "./cf-env";

export const COOKIE_NAME = "wms_session";
const SESSION_HOURS = 12;

function secretKey() {
  const secret = getEnv("JWT_SECRET") || "wms-oceon-production-secure-fallback-jwt-secret-key-2026";
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string; // user id
  staffId: string;
  name: string;
  role: Role;
  warehouseId: string | null;
  sid?: string; // per-login random id, checked against session-registry.ts's KV record to enforce one active device per account
};

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Read the current session in a Server Component, Route Handler, or Server
 * Action. Also enforces one active device per account (PRD-adjacent go-live
 * hardening, 2026-08-24): a token's `sid` must match the currently
 * registered session in KV (session-registry.ts) — logging in elsewhere
 * overwrites that record, so this device's next request here invalidates.
 * Fail-open vs fail-closed, deliberately:
 * - KV read *failure*, or no Workers/KV context at all (local `next dev`) —
 *   fails OPEN, so a KV hiccup can't lock out the whole warehouse.
 * - KV answered and the record is missing or holds a different sid — fails
 *   CLOSED. That covers "someone else logged in" AND admin revocation:
 *   role/warehouse/active live in the 12h JWT, so admin/users/[id] clears
 *   the sid to force a fired or demoted user back through login. A
 *   revocation that fell through to fail-open would be no revocation.
 * - No `sid` at all (tokens minted before 2026-08-24) — also fails closed
 *   now; those all expired within 12h of that ship, and leaving the branch
 *   open left a shape where a token could skip the check entirely.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload || !payload.sid) return null;

  try {
    const { getActiveSid } = await import("./session-registry");
    const activeSid = await getActiveSid(payload.sub);
    if (activeSid !== undefined && activeSid !== payload.sid) return null;
  } catch {
    // KV unreachable — fail open
  }
  return payload;
}

/**
 * COOKIE_DOMAIN (e.g. ".yourdomain.com", leading dot) shares one session
 * across all five subdomain portals — "sharing the same... authentication"
 * requires this; without it a cookie set while logging in on
 * finance.yourdomain.com is scoped to that host only and wouldn't carry
 * over to qc.yourdomain.com etc. Left unset for local dev (host-only
 * cookie on localhost, which has no subdomains to share across).
 */
export async function setSessionCookie(token: string) {
  const domain = getEnv("COOKIE_DOMAIN");
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: domain || undefined,
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const domain = getEnv("COOKIE_DOMAIN");
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: domain || undefined,
    maxAge: 0,
  });
}
