/**
 * Signing in with no internet (src/lib/offline-login.ts): only a password
 * that signed in online on this PC gets through, and log out sticks.
 * Run: npx tsx src/lib/__tests__/offline-login.ts
 */
import assert from "node:assert/strict";
import { rememberLogin, offlineLogin, offlineSession, markSignedOut, isSignedOut } from "../offline-login";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

(async () => {
assert.equal(await offlineLogin("FIN-1", "pw"), "unknown", "never signed in online here");
await rememberLogin("fin-1", "pw", { name: "Asha", role: "FINANCE" });
assert.ok(!(store.get("offline-logins") ?? "").includes('"pw"'), "password stored in the clear");
assert.equal(await offlineLogin("FIN-1", "nope"), "wrong");
assert.equal(offlineSession(), null, "a wrong password started a session");
assert.deepEqual(await offlineLogin(" Fin-1 ", "pw"), { staffId: "FIN-1", name: "Asha", role: "FINANCE" });
assert.equal(offlineSession()?.staffId, "FIN-1");
markSignedOut();
assert.ok(isSignedOut() && offlineSession() === null, "log out didn't stick");
await offlineLogin("FIN-1", "pw");
assert.ok(!isSignedOut(), "signing in offline must lift the log out");
await rememberLogin("FIN-1", "new", { name: "Asha", role: "FINANCE" });
assert.equal(await offlineLogin("FIN-1", "pw"), "wrong", "old password still works after an online sign-in with a new one");
assert.equal(offlineSession(), null, "online sign-in must end the offline session");
console.log("offline-login: all checks passed");
})();
