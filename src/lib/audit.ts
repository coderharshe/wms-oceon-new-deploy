import { getDb } from "./db";
import type { PrismaClient, Role } from "@/generated/prisma/client";

type AuditInput = {
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
};

/**
 * Every sensitive mutation calls this (PRD §33). Deliberately a plain insert,
 * not a queue/outbox — one Postgres row per event is enough at this scale,
 * and it can run inside the same transaction as the mutation it records.
 */
export async function writeAudit(input: AuditInput, tx: { auditLog: PrismaClient["auditLog"] } = getDb()) {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      role: input.role ?? null,
      warehouseId: input.warehouseId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue === undefined ? undefined : (input.oldValue as object),
      newValue: input.newValue === undefined ? undefined : (input.newValue as object),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
