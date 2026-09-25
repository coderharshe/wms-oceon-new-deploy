import { isWorkersRuntime } from "./cf-env";
import { drizzleQ, prismaQ, type Q } from "./cash";

/**
 * Runs raw-SQL cash/bank work in one transaction on whichever query layer this
 * runtime uses. Imports stay dynamic so Workers never loads Prisma.
 */
export async function inTransaction<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    return getDrizzleDb().transaction((tx) => fn(drizzleQ(tx as never)));
  }
  const { getDb } = await import("./db");
  return getDb().$transaction((tx) => fn(prismaQ(tx)));
}
