import { getCloudflareContext } from "@opennextjs/cloudflare";

export type WmsEvent = { type: string; payload: unknown };

/**
 * Fire-and-forget push to a Durable Object-backed pub/sub scope (see
 * realtime-hub.ts). Never throws and never blocks the caller — a realtime
 * push failing must not break the DB transaction that triggered it.
 *
 * On Workers, an un-awaited fetch left running after the Response is
 * returned gets cancelled with the isolate — ctx.waitUntil() is what keeps
 * it alive to actually reach the Durable Object. Without this, every
 * publish() call was a silent no-op in production (confirmed live: cash
 * payment fired, SSE client never got "payment:updated").
 */
export function publish(scope: string, type: string, payload: unknown) {
  try {
    const { env, ctx } = getCloudflareContext();
    const id = env.REALTIME_HUB.idFromName(scope);
    const stub = env.REALTIME_HUB.get(id);
    const fetchPromise = stub
      .fetch("https://realtime-hub/publish", {
        method: "POST",
        body: JSON.stringify({ type, payload } satisfies WmsEvent),
      })
      .then(() => {})
      .catch(() => {});
    ctx.waitUntil(fetchPromise);
  } catch {
    // no active Cloudflare request context (build-time, scripts, local dev) — no-op
  }
}

/** Opens a live SSE stream from one scope's Durable Object. Used by /api/events. */
export async function subscribeStream(scope: string): Promise<ReadableStream> {
  const env = getCloudflareContext().env;
  const id = env.REALTIME_HUB.idFromName(scope);
  const stub = env.REALTIME_HUB.get(id);
  const res = await stub.fetch("https://realtime-hub/subscribe");
  if (!res.body) throw new Error(`Durable Object scope "${scope}" returned no stream`);
  return res.body;
}
