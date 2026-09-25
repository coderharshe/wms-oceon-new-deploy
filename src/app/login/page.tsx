"use client";

import { Suspense, useState, useRef, useEffect, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Copyright from "@/components/Copyright";
import InstallButton from "@/components/InstallButton";
import { ErrorNote } from "@/components/ErrorNote";
import { rememberLogin, offlineLogin, OFFLINE_ROLES } from "@/lib/offline-login";

// Screens the service worker keeps for offline use (RegisterServiceWorker's CORE_PAGES).
const OFFLINE_PAGES = ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"];

type Takeover = { takeoverId: string; secret: string; expiresAt: number };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("reason") === "elsewhere" ? "You were signed out — this account was used to log in on another device." : null
  );
  const [loading, setLoading] = useState(false);
  const [instantMode, setInstantMode] = useState(true);
  const [staffIdVal, setStaffIdVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");
  const [alreadyIn, setAlreadyIn] = useState<{ staffId: string; password: string } | null>(null);
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const passwordRef = useRef<HTMLInputElement>(null);
  const alreadyInRef = useRef<{ staffId: string; password: string } | null>(null);

  function finishLogin(next: string) {
    router.push(next);
    router.refresh();
  }

  async function executeLogin(staffId: string, password: string, force = false) {
    setError(null);
    setLoading(true);

    const res = navigator.onLine
      ? await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId, password, force }),
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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const staffId = String(form.get("staffId") || staffIdVal);
    const password = String(form.get("password") || passwordVal);
    await executeLogin(staffId, password, instantMode);
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

  // Poll while a takeover is pending; this same poll is what finalizes it once grace period elapses
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

  function quickLogin(id: string) {
    setStaffIdVal(id);
    setPasswordVal("password123");
    executeLogin(id, "password123", true);
  }

  if (takeover) {
    const secondsLeft = Math.max(0, Math.round((takeover.expiresAt - now) / 1000));
    return (
      <div className="card w-80 space-y-4 text-center p-6 shadow-xl border border-line">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
          <span className="text-xl font-bold animate-pulse">{secondsLeft}s</span>
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink">Signing out other device…</h1>
          <p className="text-xs text-muted mt-1">
            Waiting {secondsLeft}s for normal handover. You can also force instant sign in below without waiting.
          </p>
        </div>
        <button
          className="btn-primary w-full bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 shadow-sm"
          disabled={loading}
          onClick={() => {
            if (alreadyInRef.current) {
              setTakeover(null);
              executeLogin(alreadyInRef.current.staffId, alreadyInRef.current.password, true);
            }
          }}
        >
          ⚡ Instant Sign In Now (Skip Wait)
        </button>
        <button
          className="btn w-full text-xs text-muted hover:text-ink"
          onClick={() => setTakeover(null)}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (alreadyIn) {
    return (
      <div className="card w-80 space-y-4 text-center p-6 shadow-xl border border-line">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink">Active on Another Device</h1>
          <p className="text-xs text-muted mt-1">This account ({alreadyIn.staffId}) is currently active on another device.</p>
        </div>

        <div className="space-y-2 pt-1">
          <button
            className="btn-primary w-full bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 shadow-sm"
            disabled={loading}
            onClick={() => executeLogin(alreadyIn.staffId, alreadyIn.password, true)}
          >
            ⚡ Instant Sign In (0s Wait)
          </button>
          <button
            className="btn w-full py-2 text-xs text-muted hover:text-ink"
            disabled={loading}
            onClick={requestTakeover}
          >
            {loading ? "Requesting…" : "Standard Handover (20s Grace)"}
          </button>
          <button
            className="btn w-full text-xs text-muted hover:text-ink"
            onClick={() => setAlreadyIn(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card w-80 space-y-4 p-6 shadow-xl border border-line">
      <div className="text-center pb-1">
        <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-surface font-black text-xl shadow-md">
          O
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">OCEON-WMS</h1>
        <p className="text-xs text-muted mt-0.5">Enterprise Warehouse & Billing System</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Staff ID</label>
        <input
          name="staffId"
          value={staffIdVal}
          onChange={(e) => setStaffIdVal(e.target.value)}
          placeholder="e.g. ADMIN-1 or FIN-1"
          autoFocus
          required
          className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-hidden focus:ring-2 focus:ring-accent/20"
          autoComplete="username"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted">Password</label>
        <input
          ref={passwordRef}
          name="password"
          value={passwordVal}
          onChange={(e) => setPasswordVal(e.target.value)}
          placeholder="••••••••"
          type="password"
          required
          className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-hidden focus:ring-2 focus:ring-accent/20"
          autoComplete="current-password"
        />
      </div>

      {/* Instant Sign-in Toggle */}
      <div className="flex items-center justify-between rounded-lg bg-surface/80 p-2.5 border border-line text-xs">
        <div className="flex items-center gap-2">
          <input
            id="instantMode"
            type="checkbox"
            checked={instantMode}
            onChange={(e) => setInstantMode(e.target.checked)}
            className="h-4 w-4 rounded border-line text-accent focus:ring-accent cursor-pointer"
          />
          <label htmlFor="instantMode" className="cursor-pointer font-medium text-ink flex items-center gap-1">
            ⚡ Instant Sign In
          </label>
        </div>
        <span className="text-[11px] text-muted">No 20s delay</span>
      </div>

      {error && <ErrorNote error={error} onDismiss={() => setError(null)} />}

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 shadow-sm"
      >
        {loading ? (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Signing in…
          </span>
        ) : (
          <span>Sign In to OCEON-WMS</span>
        )}
      </button>

      {/* 1-Click Quick Demo Sign In */}
      <div className="pt-2 border-t border-line">
        <p className="text-[11px] text-muted text-center mb-2 font-medium">⚡ Quick 1-Click Instant Sign In:</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => quickLogin("ADMIN-1")}
            className="px-2 py-1.5 text-xs font-semibold rounded bg-surface hover:bg-accent hover:text-white border border-line text-ink transition-colors text-center"
          >
            👑 Admin
          </button>
          <button
            type="button"
            onClick={() => quickLogin("MGR-1")}
            className="px-2 py-1.5 text-xs font-semibold rounded bg-surface hover:bg-accent hover:text-white border border-line text-ink transition-colors text-center"
          >
            📦 Manager
          </button>
          <button
            type="button"
            onClick={() => quickLogin("FIN-1")}
            className="px-2 py-1.5 text-xs font-semibold rounded bg-surface hover:bg-accent hover:text-white border border-line text-ink transition-colors text-center"
          >
            💳 Finance
          </button>
          <button
            type="button"
            onClick={() => quickLogin("QC-1")}
            className="px-2 py-1.5 text-xs font-semibold rounded bg-surface hover:bg-accent hover:text-white border border-line text-ink transition-colors text-center"
          >
            🔬 QC
          </button>
        </div>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <InstallButton />
      <Copyright />
    </div>
  );
}
