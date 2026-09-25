import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * True when running as the deployed Worker (Hyperdrive binding present) —
 * used to pick the Drizzle query path instead of Prisma's, since Prisma's
 * query engine (native binary or WASM) cannot run in a Workers isolate.
 * False for local `next dev`, scripts, and build-time — those keep using
 * the existing Prisma-based code.
 */
export function isWorkersRuntime(): boolean {
  try {
    return Boolean(getCloudflareContext().env.HYPERDRIVE);
  } catch {
    return false;
  }
}

/**
 * Reads a plain string var/secret. On Workers these come through the
 * binding `env` object, not `process.env` — but `getCloudflareContext()`
 * only works inside a request's execution context, so this falls back to
 * `process.env` for anything called outside that (build-time, scripts,
 * local `next dev` without the Cloudflare shim active).
 */
export function getEnv(key: string): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, string | undefined>;
    if (env?.[key] !== undefined) return env[key];
  } catch {
    // no active Cloudflare request context — fall through
  }
  return process.env[key];
}
