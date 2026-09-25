import { getDrizzleDb } from "./drizzle-db";
import { auditLog } from "@/generated/drizzle/schema";
import type { Role } from "@/generated/prisma/client";

// Drizzle equivalent of src/lib/audit.ts's writeAudit — used on Workers,
// where Prisma's query engine can't run. Same fields, same PRD §33 shape.
export async function writeAuditDrizzle(input: {
  userId?: string | null;
  role?: Role | null;
  warehouseId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}, tx?: import("./drizzle-db").DrizzleDbOrTx) {
  // Callers already inside a transaction should pass their `tx`: without it
  // getDrizzleDb() opens a second Pool + TLS connection mid-transaction (on
  // Workers nothing is cached), which costs a round trip and burns one of
  // Hyperdrive's 20 origin connections. Passing tx also means the audit row
  // rolls back with the thing it describes, instead of recording a bill that
  // never existed.
  const db = tx ?? getDrizzleDb();
  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    userId: input.userId ?? null,
    role: input.role ?? null,
    warehouseId: input.warehouseId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}
