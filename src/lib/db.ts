import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Returns a Prisma Client wired to Postgres via the driver-adapter pattern
 * (required on Workers — Prisma's default query engine binary can't run in
 * a V8 isolate). On Workers the connection string comes from the Hyperdrive
 * binding (env.HYPERDRIVE.connectionString); locally it's DATABASE_URL,
 * same Postgres either way, same schema, same queries — one code path.
 *
 * Cached per isolate (module-level singleton, same as the old dev-mode
 * pattern) so only the first call in an isolate's lifetime pays init cost;
 * Hyperdrive itself does the actual connection pooling, so this client
 * doesn't need to maintain a large pool of its own.
 */
const globalForDb = globalThis as unknown as { prismaClient?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForDb.prismaClient) return globalForDb.prismaClient;

  let connectionString =
    process.env.DATABASE_URL ||
    process.env.STORAGE_PRISMA_DATABASE_URL ||
    process.env.STORAGE_DATABASE_URL ||
    process.env.STORAGE_POSTGRES_URL;
  try {
    const env = getCloudflareContext().env;
    if (env.HYPERDRIVE?.connectionString) connectionString = env.HYPERDRIVE.connectionString;
  } catch {
    // no active Cloudflare request context (e.g. plain `next dev`, scripts) — use DATABASE_URL
  }
  if (!connectionString) throw new Error("No database connection string (DATABASE_URL or HYPERDRIVE binding)");

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // Workers isolates are reused across requests but can also be evicted at
  // any time — caching here is purely an optimization, not a requirement.
  globalForDb.prismaClient = client;
  return client;
}
