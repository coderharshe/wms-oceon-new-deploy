import { NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { putFile, listFiles } from "@/lib/r2";
import { isWorkersRuntime } from "@/lib/cf-env";

// Logical backup (not pg_dump — Workers can't run that): the tables that
// matter for reconstructing what happened, as JSON, timestamped in R2.
// ponytail: full-table dump, no incremental/delta export; fine at this
// data volume — revisit only if the JSON export itself becomes slow.
export async function POST() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  let dump: Record<string, unknown>;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { buildBackupDump } = await import("@/lib/drizzle-backup");
    dump = await buildBackupDump(getDrizzleDb());
  } else {
    const db = (await import("@/lib/db")).getDb();
    const [orders, bills, billVersions, payments, paymentTransactions, inventoryRows, inventoryMovements, customers] = await Promise.all([
      db.order.findMany(),
      db.bill.findMany(),
      db.billVersion.findMany({ include: { items: true } }),
      db.payment.findMany(),
      db.paymentTransaction.findMany(),
      db.inventory.findMany(),
      db.inventoryMovement.findMany(),
      db.customer.findMany(),
    ]);
    dump = { orders, bills, billVersions, payments, paymentTransactions, inventory: inventoryRows, inventoryMovements, customers };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `backups/${timestamp}.json`;
  await putFile(key, JSON.stringify({ exportedAt: timestamp, ...dump }, null, 2), "application/json");

  const session_ = session;
  if (isWorkersRuntime()) {
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    await writeAuditDrizzle({ userId: session_.sub, role: session_.role, action: "BACKUP_EXPORTED", entityType: "Backup", entityId: key });
  } else {
    await (await import("@/lib/audit")).writeAudit({ userId: session_.sub, role: session_.role, action: "BACKUP_EXPORTED", entityType: "Backup", entityId: key });
  }
  return NextResponse.json({ key, url: `/api/files/${key}` });
}

export async function GET() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const objects = await listFiles("backups/");
  return NextResponse.json(objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
}
