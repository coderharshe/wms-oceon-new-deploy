import { notification } from "@/generated/drizzle/schema";
import type { getDrizzleDb } from "./drizzle-db";
import { publish } from "./realtime";

import type { Role } from "@/generated/prisma/client";

type Tx = import("./drizzle-db").DrizzleDbOrTx;

/** Drizzle equivalent of src/lib/notifications.ts's notify — same targeting/scope logic. */
export async function notifyDrizzle(
  tx: Tx,
  args: { userId?: string; role?: Role; warehouseId?: string; type: string; title: string; message: string }
) {
  const [row] = await tx
    .insert(notification)
    .values({
      id: crypto.randomUUID(),
      userId: args.userId ?? null,
      role: args.role ?? null,
      warehouseId: args.warehouseId ?? null,
      type: args.type,
      title: args.title,
      message: args.message,
    })
    .returning();

  const scope = args.userId
    ? `user:${args.userId}`
    : args.warehouseId
    ? `warehouse:${args.warehouseId}:${args.role ?? "ALL"}`
    : `role:${args.role ?? "ALL"}`;
  publish(scope, "notification", row);
  return row;
}
