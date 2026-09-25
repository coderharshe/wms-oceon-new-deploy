import type { Prisma } from "@/generated/prisma/client";
import { sql } from "drizzle-orm";

/** Thrown when a key was already claimed — the caller's mutation must NOT run again. */
export class DuplicateRequestError extends Error {}

/**
 * Same atomic INSERT..ON CONFLICT row-lock pattern as src/lib/numbering.ts —
 * claims `key` once; a second claim of the same key (a retried offline-queue
 * flush, see offline-queue.ts) throws instead of letting the caller's
 * mutation run twice.
 */
export async function claimIdempotencyKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  const rows = await tx.$queryRaw<{ key: string }[]>`
    INSERT INTO "IdempotencyKey" (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING RETURNING key
  `;
  if (rows.length === 0) throw new DuplicateRequestError();
}

export async function claimIdempotencyKeyDrizzle(tx: import("./drizzle-db").DrizzleDbOrTx, key: string): Promise<void> {
  const result = await tx.execute(sql`INSERT INTO "IdempotencyKey" (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING RETURNING key`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  if (rows.length === 0) throw new DuplicateRequestError();
}
