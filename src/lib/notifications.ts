import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { publish } from "./realtime";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Creates an in-app notification and pushes it over SSE. Target one of:
 * userId (a specific person), or role+warehouseId (everyone with that role
 * in that warehouse), or role alone (e.g. all ADMIN).
 */
export async function notify(
  tx: Tx,
  args: {
    userId?: string;
    role?: Role;
    warehouseId?: string;
    type: string;
    title: string;
    message: string;
  }
) {
  const notification = await tx.notification.create({
    data: {
      userId: args.userId,
      role: args.role,
      warehouseId: args.warehouseId,
      type: args.type,
      title: args.title,
      message: args.message,
    },
  });
  // Push only to whoever the notification is actually for — a plain
  // `warehouse:<id>` scope would hand every role in the warehouse everyone
  // else's notifications too (SSE route subscribes each client to both the
  // shared scope and their own role-scoped one; see /api/events).
  const scope = args.userId
    ? `user:${args.userId}`
    : args.warehouseId
    ? `warehouse:${args.warehouseId}:${args.role ?? "ALL"}`
    : `role:${args.role ?? "ALL"}`;
  publish(scope, "notification", notification);
  return notification;
}
