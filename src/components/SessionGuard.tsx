"use client";

import { useEffect, useState } from "react";
import { useLiveEvents } from "@/lib/live-events";

type TakeoverPrompt = { takeoverId: string; expiresAt: number };

// Lives inside PortalShell (every authenticated page): listens for another
// device trying to take over this login, and for this device itself having
// just been kicked by one that already went through.
export default function SessionGuard() {
  const [prompt, setPrompt] = useState<TakeoverPrompt | null>(null);
  const [denied, setDenied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useLiveEvents((data) => {
    if (data.type === "session:takeover_requested") {
      setDenied(false);
      setPrompt({ takeoverId: data.payload.takeoverId, expiresAt: data.payload.expiresAt });
    } else if (data.type === "session:kicked") {
      window.location.href = "/login?reason=elsewhere";
    }
  });

  useEffect(() => {
    if (!prompt || denied) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [prompt, denied]);

  async function deny() {
    if (!prompt) return;
    await fetch("/api/auth/login/takeover-deny", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ takeoverId: prompt.takeoverId }),
    }).catch(() => {});
    setDenied(true);
    setTimeout(() => setPrompt(null), 3000);
  }

  if (!prompt) return null;
  const secondsLeft = Math.max(0, Math.round((prompt.expiresAt - now) / 1000));

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div className="card max-w-md space-y-2 border border-bad text-center shadow-lg">
        {denied ? (
          <p className="font-medium text-good">Login attempt denied — your session continues.</p>
        ) : (
          <>
            <p className="font-medium text-bad">Someone is trying to log in as you on another device.</p>
            <p className="text-sm text-muted">
              If this isn't you, deny it now. Otherwise you'll be signed out here in {secondsLeft}s.
            </p>
            <button className="btn-primary" onClick={deny}>
              Deny — keep my session
            </button>
          </>
        )}
      </div>
    </div>
  );
}
