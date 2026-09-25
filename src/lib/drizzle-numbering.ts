import { sql } from "drizzle-orm";
import type { getDrizzleDb } from "./drizzle-db";
import { businessDateCompact } from "./business-date";

type Tx = import("./drizzle-db").DrizzleDbOrTx;

/**
 * Drizzle equivalent of src/lib/numbering.ts's nextNumber — same atomic
 * INSERT..ON CONFLICT row-lock pattern, same business-date-scoped counter key
 * (on Workers `new Date()` is UTC, which flips the date part mid-evening IST).
 */
export async function nextNumberDrizzle(tx: Tx, key: string, prefix: string, at: Date = new Date()): Promise<string> {
  const datePart = businessDateCompact(at);
  const dailyKey = `${key}:${datePart}`;
  const result = await tx.execute(sql`
    INSERT INTO "Counter" (key, value) VALUES (${dailyKey}, 1)
    ON CONFLICT (key) DO UPDATE SET value = "Counter".value + 1
    RETURNING value
  `);
  // node-postgres driver returns the raw pg QueryResult ({ rows: [...] }).
  const rows = (result as unknown as { rows?: { value: number }[] }).rows ?? (result as unknown as { value: number }[]);
  const seq = rows[0]!.value;
  return `${prefix}-${datePart}-${String(seq).padStart(4, "0")}`;
}
