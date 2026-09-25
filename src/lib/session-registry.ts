import { getCloudflareContext } from "@opennextjs/cloudflare";

// One active device per account, enforced via KV (edge-fast; avoids adding a
// Postgres round-trip to every authenticated request). Local `next dev` has
// no Workers/KV context — falls through to "no enforcement", same tradeoff
// kv-cache.ts already makes; a rare KV outage on the deployed Worker does
// the same (fail open, not fail closed — losing this feature briefly beats
// locking every staff member out).
const SESSION_TTL_SECONDS = 12 * 60 * 60; // matches the JWT's own expiry
export const TAKEOVER_GRACE_MS = 20_000;
const TAKEOVER_TTL_SECONDS = 60; // generous pad past the grace window, just to let stragglers poll it

function kv(): KVNamespace | undefined {
  try {
    return getCloudflareContext().env.CACHE_KV;
  } catch {
    return undefined;
  }
}

// undefined = no KV context at all (local dev, or KV genuinely unreachable)
// — caller can't check, so allows. null = KV was queried and has no record
// (explicit logout, or evicted) — caller treats that as "not the active
// session anymore", distinct from "couldn't tell".
export async function getActiveSid(userId: string): Promise<string | null | undefined> {
  const store = kv();
  if (!store) return undefined;
  const rec = await store.get<{ sid: string }>(`session:${userId}`, "json");
  return rec?.sid ?? null;
}

// Also the admin force-logout: role/warehouse/active are baked into the JWT
// for 12h, so deactivating or demoting someone (admin/users/[id]) clears
// their sid to make getSession() reject the stale token on the next request.
export async function clearActiveSid(userId: string): Promise<void> {
  const store = kv();
  if (!store) return;
  await store.delete(`session:${userId}`);
}

export async function setActiveSid(userId: string, sid: string): Promise<void> {
  const store = kv();
  if (!store) return;
  await store.put(`session:${userId}`, JSON.stringify({ sid }), { expirationTtl: SESSION_TTL_SECONDS });
}

// Failed-login throttle. Fixed lockout window after N consecutive failures,
// counted separately per staffId and per client IP (one key alone isn't
// enough: per-IP only lets a botnet spread a single-account attack out, and
// per-staffId only lets one box walk the whole FIN-00N / QC-00N id space).
// Same fail-open rule as everything else here — no KV, or KV erroring, means
// no throttle rather than a warehouse that can't sign in.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
type LoginFailures = { n: number; until?: number };

/** 0 = not locked out; otherwise the Retry-After the caller should send. */
export async function loginLockoutSeconds(keys: string[]): Promise<number> {
  const store = kv();
  if (!store) return 0;
  const recs = await Promise.all(keys.map((k) => store.get<LoginFailures>(`login-fail:${k}`, "json")));
  const until = Math.max(0, ...recs.map((r) => r?.until ?? 0));
  return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
}

export async function recordLoginFailure(keys: string[]): Promise<void> {
  const store = kv();
  if (!store) return;
  await Promise.all(
    keys.map(async (k) => {
      const rec = (await store.get<LoginFailures>(`login-fail:${k}`, "json")) ?? { n: 0 };
      const n = rec.n + 1;
      // The record's own TTL is the lockout window, so a slow guesser's count
      // decays on its own and there's nothing to sweep.
      await store.put(`login-fail:${k}`, JSON.stringify({ n, until: n >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_LOCKOUT_SECONDS * 1000 : undefined } satisfies LoginFailures), {
        expirationTtl: LOGIN_LOCKOUT_SECONDS,
      });
    })
  );
}

export async function clearLoginFailures(keys: string[]): Promise<void> {
  const store = kv();
  if (!store) return;
  await Promise.all(keys.map((k) => store.delete(`login-fail:${k}`)));
}

// `secret` is the takeover's real credential — the takeoverId travels in SSE
// payloads and poll bodies, so possession of the id alone must not be enough
// to mint a session (see takeover-status). Returned to the creating client
// once and never published.
export type Takeover = { userId: string; status: "pending" | "denied"; expiresAt: number; secret: string };

export async function createTakeover(takeoverId: string, userId: string): Promise<{ expiresAt: number; secret: string } | null> {
  const store = kv();
  if (!store) return null; // no KV — caller falls back to plain "blocked" behavior
  const expiresAt = Date.now() + TAKEOVER_GRACE_MS;
  const secret = crypto.randomUUID();
  await store.put(`takeover:${takeoverId}`, JSON.stringify({ userId, status: "pending", expiresAt, secret } satisfies Takeover), {
    expirationTtl: TAKEOVER_TTL_SECONDS,
  });
  return { expiresAt, secret };
}

export async function getTakeover(takeoverId: string): Promise<Takeover | null> {
  const store = kv();
  if (!store) return null;
  return store.get<Takeover>(`takeover:${takeoverId}`, "json");
}

export async function denyTakeover(takeoverId: string): Promise<void> {
  const store = kv();
  if (!store) return;
  const existing = await store.get<Takeover>(`takeover:${takeoverId}`, "json");
  if (!existing) return;
  await store.put(`takeover:${takeoverId}`, JSON.stringify({ ...existing, status: "denied" } satisfies Takeover), {
    expirationTtl: TAKEOVER_TTL_SECONDS,
  });
}

export async function deleteTakeover(takeoverId: string): Promise<void> {
  const store = kv();
  if (!store) return;
  await store.delete(`takeover:${takeoverId}`);
}
