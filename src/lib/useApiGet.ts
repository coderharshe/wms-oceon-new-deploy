"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * GET-and-render-gate for client components: loading/error/data state plus
 * a `reload()` for retry buttons and SSE-triggered refreshes.
 *
 * Every page in this app used to do `fetch(url).then(r=>r.json()).then(setState)`
 * with no `.catch` and no `res.ok` check — a rejected fetch or a non-JSON
 * error body (e.g. an unhandled 500 returning HTML) threw inside the promise
 * chain with nothing to catch it, leaving the page stuck on "Loading…"
 * forever. This centralizes the fix.
 */
export function useApiGet<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(url !== null);

  const seq = useRef(0); // ignore a stale response if a newer request has since started
  const loaded = useRef(false); // has this url resolved at least once? gates the loading flash

  const reload = useCallback(() => {
    if (!url) return;
    const id = ++seq.current;
    // Only flash "Loading…" on the first fetch for this url — SSE/poll-
    // triggered reloads should update quietly, not yank the page back to a
    // loading state every time a realtime event fires.
    if (!loaded.current) setLoading(true);

    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null); // never let a bad body throw unhandled
        if (!res.ok) {
          const message = body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
          throw new Error(message);
        }
        return body as T;
      })
      .then((body) => {
        if (id !== seq.current) return;
        loaded.current = true;
        setData(body);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        loaded.current = true;
        setError(err instanceof Error ? err.message : "Something went wrong");
        setLoading(false);
      });
  }, [url]);

  useEffect(() => {
    loaded.current = false;
    if (url === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    reload();
    // ponytail: no AbortController — `seq` guards a stale response from
    // overwriting a newer one while mounted, and React already no-ops
    // setState after unmount. Add real cancellation only if a slow request
    // needs to actually stop hitting the network.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { data, error, loading, reload };
}
