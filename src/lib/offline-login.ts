"use client";

// Signing in with the internet down. The server can't be asked, so each
// successful online sign-in leaves a salted PBKDF2 hash of the password on
// this PC (never the password itself), and the same person can sign in
// against it offline. Only the counter works offline — billing and the
// finance screens the service worker keeps — so only roles that can use
// them are let through.
//
// Limits, on purpose: an account disabled or a password changed on the
// server still works offline on a PC it last signed in on, until that PC is
// online again; and a stolen PC's hashes can be guessed at offline, like any
// cached credential — the iteration count is what slows that down.
// Bills made offline sync under whoever next signs in online on this PC; the
// OFF number printed on each still names the cashier who billed it.

type Saved = { salt: string; hash: string; name: string; role: string };
type OfflineUser = { staffId: string; name: string; role: string };

const LOGINS = "offline-logins";
const SESSION = "offline-session";
const SIGNED_OUT = "signed-out";
const ITERATIONS = 210_000;
export const OFFLINE_ROLES = ["FINANCE", "ADMIN"];

const idKey = (staffId: string) => staffId.trim().toUpperCase();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256));
}

/** After a successful ONLINE sign-in: remember it for offline, and end any offline session. */
export async function rememberLogin(staffId: string, password: string, user: { name: string; role: string }) {
  try {
    localStorage.removeItem(SIGNED_OUT);
    localStorage.removeItem(SESSION);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const logins = read<Record<string, Saved>>(LOGINS) ?? {};
    logins[idKey(staffId)] = { salt: b64(salt), hash: await derive(password, salt), name: user.name, role: user.role };
    localStorage.setItem(LOGINS, JSON.stringify(logins));
  } catch {
    // No storage or no WebCrypto: online sign-in still works, offline won't.
  }
}

/** Checks against what this PC remembers. "unknown": this ID never signed in online here. */
export async function offlineLogin(staffId: string, password: string): Promise<OfflineUser | "unknown" | "wrong"> {
  const saved = read<Record<string, Saved>>(LOGINS)?.[idKey(staffId)];
  if (!saved) return "unknown";
  if ((await derive(password, unb64(saved.salt))) !== saved.hash) return "wrong";
  const user = { staffId: idKey(staffId), name: saved.name, role: saved.role };
  localStorage.setItem(SESSION, JSON.stringify(user));
  localStorage.removeItem(SIGNED_OUT);
  return user;
}

/** Who signed in offline, if anyone — overrides the staff baked into a cached page. */
export const offlineSession = () => read<OfflineUser>(SESSION);

/** Log out: the session cookie can't be cleared without the server, so cached screens check this. */
export function markSignedOut() {
  try {
    localStorage.removeItem(SESSION);
    localStorage.setItem(SIGNED_OUT, "1");
  } catch {}
}

export const isSignedOut = () => read<number>(SIGNED_OUT) === 1;
