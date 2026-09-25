import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/generated/drizzle/schema";
import * as relations from "@/generated/drizzle/relations";

/**
 * Drizzle-backed database access for the Cloudflare Workers deployment —
 * Prisma Client's query engine (native binary AND its WASM "client" engine)
 * cannot run inside a Worker isolate (confirmed platform restriction: no
 * dynamic WebAssembly.Module() compilation, no filesystem for the native
 * binary). Drizzle has no query-engine step — it compiles to SQL in plain
 * JS — so it works on Workers with the same Hyperdrive connection.
 *
 * Prisma stays the source of truth for schema/migrations (schema.prisma) —
 * this is a second query layer read against the same Postgres database, not
 * a second schema to maintain. `src/generated/drizzle` is produced by
 * `drizzle-kit introspect` against the Prisma-migrated database.
 */
const globalForDrizzle = globalThis as unknown as { drizzleClient?: ReturnType<typeof drizzle<typeof schema & typeof relations>> };

// `max: 1` alone didn't fix concurrent-write 500s under load (measured: 8/8
// clean, 12/15, 17/30 — the failure rate climbs well within realistic
// multi-till concurrency, not just synthetic extremes) — the bottleneck is
// Hyperdrive/Neon's connection-*acceptance rate* under a burst of
// simultaneous new connections, not client-side pool sizing. Retrying the
// connection attempt with backoff turns "everyone's burst lands in the same
// instant and some get rejected" into "the rejected ones land a beat later
// and succeed" — standard mitigation for this failure class.
//
// Wrapping `pool.connect()` here — not every one of the 45 call sites — is
// deliberate: `pg.Pool.query()` is implemented as `connect()` + release
// internally, so both plain reads and `db.transaction()` (which needs its
// own dedicated client for BEGIN/COMMIT) route through this one method.
function withConnectRetry(pool: Pool): Pool {
  const rawConnect = pool.connect.bind(pool);
  const ATTEMPTS = 4;
  const BASE_DELAY_MS = 150;
  pool.connect = (async (...args: unknown[]) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        // @ts-expect-error — pg's connect() has both callback and promise
        // overloads; this shim only needs to support the promise form,
        // which is the only one drizzle-orm/node-postgres actually calls.
        return await rawConnect(...args);
      } catch (err) {
        lastErr = err;
        if (attempt < ATTEMPTS - 1) {
          const delay = BASE_DELAY_MS * (attempt + 1) + Math.random() * BASE_DELAY_MS;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastErr;
  }) as unknown as typeof pool.connect;
  return pool;
}

export function getDrizzleDb() {
  let connectionString = process.env.DATABASE_URL;
  let onWorkers = false;
  try {
    const env = getCloudflareContext().env;
    if (env.HYPERDRIVE?.connectionString) {
      connectionString = env.HYPERDRIVE.connectionString;
      onWorkers = true;
    }
  } catch {
    // no active Cloudflare request context (local scripts) — use DATABASE_URL
  }
  if (!connectionString) throw new Error("No database connection string (DATABASE_URL or HYPERDRIVE binding)");

  // On Workers, a Pool cached across requests/isolate lifetime goes stale —
  // the underlying socket gets torn down between invocations but the Pool
  // object doesn't know, so a later query on it hangs forever (the Workers
  // runtime kills the request after ~30s with "code had hung"). Hyperdrive
  // does the real connection pooling on Cloudflare's side, so a fresh local
  // Pool per request costs nothing extra — just don't cache it here. Local
  // `next dev` (long-lived Node process, no isolate recycling) keeps the
  // module-level cache since that pattern is safe there.
  // max: 1 — a single Workers request only ever needs one connection at a
  // time (every call site awaits sequentially, never runs queries in
  // parallel on the same client). Left at pg's default (max: 10) each fresh
  // per-request Pool over-provisions for a need it doesn't have, and a burst
  // of concurrent requests each trying to stand up their own 10-connection
  // pool is exactly what blew through Hyperdrive's connection budget under
  // load-test concurrency ("Timed out waiting for an open slot in the
  // pool" — pg's own Pool, not Hyperdrive's).
  if (onWorkers) {
    return drizzle(withConnectRetry(new Pool({ connectionString, max: 1 })), { schema: { ...schema, ...relations } });
  }

  if (globalForDrizzle.drizzleClient) return globalForDrizzle.drizzleClient;
  const client = drizzle(new Pool({ connectionString }), { schema: { ...schema, ...relations } });
  globalForDrizzle.drizzleClient = client;
  return client;
}

export * as dz from "@/generated/drizzle/schema";

// The `tx` passed into db.transaction(async (tx) => ...) is a structurally
// similar but distinct type from the base client (missing `$client`) — this
// union is what every drizzle-*.ts service function's `db`/`tx` param uses,
// so the same function works whether called at the top level or inside a
// transaction (matching how the Prisma-based lib functions take `tx: ...`).
export type DrizzleClient = ReturnType<typeof getDrizzleDb>;
export type DrizzleTx = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
export type DrizzleDbOrTx = DrizzleClient | DrizzleTx;

