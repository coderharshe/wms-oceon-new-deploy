"use client";

import { Suspense, useState, useRef, useEffect, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Copyright from "@/components/Copyright";
import InstallButton from "@/components/InstallButton";
import { ErrorNote } from "@/components/ErrorNote";
import { rememberLogin, offlineLogin, OFFLINE_ROLES } from "@/lib/offline-login";

// Screens the service worker keeps for offline use (RegisterServiceWorker's CORE_PAGES).
const OFFLINE_PAGES = ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"];

// `secret` is returned only to the device that proved credentials to start
// the takeover — the SSE broadcast carries just the id. Possession of the id
// alone must not be enough to mint a session on someone else's account.
type Takeover = { takeoverId: string; secret: string; expiresAt: number };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("reason") === "elsewhere" ? "You were signed out — this account was used to log in on another device." : null
  );
  const [loading, setLoading] = useState(false);
  const [alreadyIn, setAlreadyIn] = useState<{ staffId: string; password: string } | null>(null);
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const passwordRef = useRef<HTMLInputElement>(null);
  // Outlives alreadyIn (cleared once the takeover starts) so the granted
  // sign-in can still be remembered for offline use.
  const alreadyInRef = useRef<{ staffId: string; password: string } | null>(null);

  function finishLogin(next: string) {
    router.push(next);
    router.refresh();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const staffId = String(form.get("staffId"));
    const password = String(form.get("password"));
    // No answer in 10s is treated like no internet: a dead Wi-Fi line never
    // fails on its own, and the counter can't wait out the 45s default.
    const res = navigator.onLine
      ? await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, password }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null)
      : null;
    if (!res) return signInOffline(staffId, password);
    setLoading(false);
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (body.error === "ALREADY_LOGGED_IN") {
        setAlreadyIn({ staffId, password });
        return;
      }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
      passwordRef.current?.select();
      return;
    }
    const user = await res.json().catch(() => null);
    if (user) await rememberLogin(staffId, password, user);
    finishLogin(params.get("next") ?? "/");
  }

  async function signInOffline(staffId: string, password: string) {
    const user = await offlineLogin(staffId, password);
    setLoading(false);
    if (user === "unknown") return setError("No internet. This Staff ID hasn't signed in on this PC before — it can sign in offline only after one sign-in with internet.");
    if (user === "wrong") {
      setError("Invalid credentials");
      return passwordRef.current?.select();
    }
    if (!OFFLINE_ROLES.includes(user.role)) return setError("No internet. Only billing works offline — sign in once the internet is back.");
    // A full page load, not router.push: offline, only the service worker's
    // saved copy of a screen can open, and a client-side move never asks it.
    const next = params.get("next");
    window.location.assign(next && OFFLINE_PAGES.includes(next) ? next : "/finance/orders/new");
  }

  async function requestTakeover() {
    if (!alreadyIn) return;
    alreadyInRef.current = alreadyIn;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login/takeover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alreadyIn),
    });
    setLoading(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not sign out the other device");
      setAlreadyIn(null);
      return;
    }
    setAlreadyIn(null);
    setTakeover({ takeoverId: body.takeoverId, secret: body.secret, expiresAt: body.expiresAt });
  }

  // Poll while a takeover is pending; this same poll is what finalizes it
  // once the grace period elapses (see /api/auth/login/takeover-status).
  useEffect(() => {
    if (!takeover) return;
    let cancelled = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const res = await fetch("/api/auth/login/takeover-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeoverId: takeover.takeoverId, secret: takeover.secret }),
      });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (body.status === "granted") {
        clearInterval(poll);
        clearInterval(tick);
        if (alreadyInRef.current) await rememberLogin(alreadyInRef.current.staffId, alreadyInRef.current.password, body);
        finishLogin(params.get("next") ?? "/");
      } else if (body.status === "denied" || body.status === "expired") {
        clearInterval(poll);
        clearInterval(tick);
        setTakeover(null);
        setError(body.status === "denied" ? "Login denied by the other device." : "That request expired — try again.");
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeover]);

  if (takeover) {
    const secondsLeft = Math.max(0, Math.round((takeover.expiresAt - now) / 1000));
    return (
      <div className="card w-72 space-y-3 text-center">
        <h1 className="text-lg font-semibold">Signing out other device…</h1>
        <p className="text-sm text-muted">
          The other device has {secondsLeft}s to deny this. You'll be signed in automatically once it passes.
        </p>
      </div>
    );
  }

  if (alreadyIn) {
    return (
      <div className="card w-72 space-y-3 text-center">
        <h1 className="text-lg font-semibold">Already logged in elsewhere</h1>
        <p className="text-sm text-muted">This account is currently active on another device.</p>
        <button className="btn-primary w-full" disabled={loading} onClick={requestTakeover}>
          {loading ? "Requesting…" : "Sign out other device"}
        </button>
        <button className="btn w-full" onClick={() => setAlreadyIn(null)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card w-72 space-y-3">
      <div>
        <h1 className="text-xl font-semibold">Taresh</h1>
        <p className="text-xs text-muted">Sign in</p>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Staff ID</label>
        <input name="staffId" autoFocus required className="w-full" autoComplete="username" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Password</label>
        <input
          ref={passwordRef}
          name="password"
          type="password"
          required
          className="w-full"
          autoComplete="current-password"
        />
      </div>
      {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <InstallButton />
      <Copyright />
    </div>
  );
}
