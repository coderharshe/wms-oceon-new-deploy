"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startQueueFlusher } from "@/lib/offline-queue";

const CORE_PAGES = ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"];
const WARM_EVERY_MS = 5 * 60 * 1000;
let coreWarmed = false; // once per page load

// A request on a "connected but dead" line never fails on its own — the button
// that sent it just waits forever. Every browser fetch that didn't bring its
// own signal now gives up after FETCH_TIMEOUT_MS and rejects, which every
// caller already handles as "network error". Callers that need longer (the
// backup) pass their own signal.
const FETCH_TIMEOUT_MS = 45_000;
if (typeof window !== "undefined" && !(window.fetch as { timed?: boolean }).timed) {
  const raw = window.fetch.bind(window);
  const timed: typeof fetch = (input, init) =>
    init?.signal || input instanceof Request ? raw(input, init) : raw(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  Object.assign(timed, { timed: true });
  window.fetch = timed;
}

/** Asks the service worker to store these pages' HTML so an offline reload (power cut, restart) opens them. */
export function warmPages(urls: string[]) {
  if (!("serviceWorker" in navigator) || !navigator.onLine) return;
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm", urls })).catch(() => {});
}

export default function RegisterServiceWorker() {
  const pathname = usePathname();
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    startQueueFlusher();
  }, []);

  // In-app navigation only ever fetches RSC payloads, so the finance screens' HTML is
  // fetched here instead — keyed on pathname because login reaches /finance client-side.
  useEffect(() => {
    if (coreWarmed || !pathname?.startsWith("/finance") || !navigator.onLine) return;
    coreWarmed = true;
    try {
      const last = Number(sessionStorage.getItem("sw-warmed-at"));
      if (Date.now() - last < WARM_EVERY_MS) return;
      sessionStorage.setItem("sw-warmed-at", String(Date.now()));
    } catch {
      /* no sessionStorage: the once-per-load flag still throttles */
    }
    warmPages(CORE_PAGES);
  }, [pathname]);
  return null;
}
