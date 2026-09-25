import type { Prisma } from "@/generated/prisma/client";
import { businessDateCompact } from "./business-date";

/**
 * Atomically issues the next sequence number for `key` and formats it as
 * PREFIX-YYYYMMDD-NNNN. The INSERT..ON CONFLICT..RETURNING takes a row lock,
 * so two concurrent requests never get the same number (PRD §37, §43 rule 1-2).
 *
 * The counter key is scoped to the business date, so the printed sequence is
 * genuinely "today's Nth", which is what the YYYYMMDD-NNNN shape claims. A
 * global key made ORD-20260830-0523 mean "the 523rd order ever".
 */
export async function nextNumber(
  tx: Prisma.TransactionClient,
  key: string,
  prefix: string,
  // An offline bill synced later passes the time it was made, so its number
  // joins that day's series rather than the day it happened to reach us.
  at: Date = new Date()
): Promise<string> {
  const datePart = businessDateCompact(at);
  const dailyKey = `${key}:${datePart}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (key, value) VALUES (${dailyKey}, 1)
    ON CONFLICT (key) DO UPDATE SET value = "Counter".value + 1
    RETURNING value
  `;
  const seq = rows[0]!.value;
  return `${prefix}-${datePart}-${String(seq).padStart(4, "0")}`;
}
