"use client";

import { useEffect, useRef } from "react";

// ONE /api/events connection per tab, shared by every listener (session guard,
// bell, order page, QC queue), and none at all while the tab is hidden.
// Each EventSource is a request that never ends; over HTTP/1.1 (forced by
// HTTPS-scanning antivirus or a proxy) Chrome allows only 6 per site, and the
// old 4-per-bill-page setup used them up across two tabs — after that every
// reload and every button's fetch queued forever behind them.
//
// Listeners get { type: "resync" } whenever the stream (re)connects after the
// first time: anything published while it was down or the tab was hidden was
// missed, so they should refetch.

export type LiveEvent = { type: string; payload?: any };
type Sub = { fn: (e: LiveEvent) => void; orderId?: string };

const subs = new Set<Sub>();
let es: EventSource | null = null;
let url = "";
let connectedBefore = false;

function emit(e: LiveEvent) {
  for (const s of subs) {
    try {
      s.fn(e);
    } catch {
      /* one broken listener must not starve the rest */
    }
  }
}

function sync() {
  // ponytail: one order scope per tab — a tab only ever shows one order at a time.
  const orderId = [...subs].find((s) => s.orderId)?.orderId;
  const want = subs.size && !document.hidden ? "/api/events" + (orderId ? `?orderId=${encodeURIComponent(orderId)}` : "") : "";
  if (want === url) return;
  es?.close();
  es = null;
  url = want;
  if (!want) return;
  es = new EventSource(want);
  es.onopen = () => {
    if (connectedBefore) emit({ type: "resync" });
    connectedBefore = true;
  };
  es.onmessage = (m) => {
    try {
      emit(JSON.parse(m.data));
    } catch {
      /* keepalive or partial frame */
    }
  };
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", sync);

export function subscribeLiveEvents(fn: (e: LiveEvent) => void, orderId?: string) {
  const sub = { fn, orderId };
  subs.add(sub);
  sync();
  return () => {
    subs.delete(sub);
    sync();
  };
}

/** Calls `fn` for every live event; always the latest `fn`, without reconnecting when it changes. */
export function useLiveEvents(fn: (e: LiveEvent) => void, orderId?: string) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribeLiveEvents((e) => ref.current(e), orderId), [orderId]);
}
