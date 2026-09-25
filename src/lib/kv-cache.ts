import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Read-through cache for hot, rarely-changing reads (product search, unit
 * list) — cuts Hyperdrive round-trips on the highest-QPS endpoints. Never
 * used for anything transactional; a cache miss or Workers-less local dev
 * just falls through to `compute()` directly, so this is purely additive.
 */
export async function cachedJson<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  let kv: KVNamespace | undefined;
  try {
    kv = getCloudflareContext().env.CACHE_KV;
  } catch {
    // no active Cloudflare context — skip caching entirely
  }
  if (!kv) return compute();

  const hit = await kv.get<T>(key, "json");
  if (hit !== null) return hit;

  const value = await compute();
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  return value;
}

/** Clears a cachedJson() key after a write that makes it stale (e.g. a new unit). */
export async function invalidateJson(key: string) {
  try {
    await getCloudflareContext().env.CACHE_KV?.delete(key);
  } catch {
    // no active Cloudflare context (local dev) — cachedJson never cached it either
  }
}
