// Extra FINANCE logins for sharded e2e runs (same warehouse as FIN-1). Local DB only.
import pg from "pg";
import bcrypt from "bcryptjs";
const url = process.env.DATABASE_URL_E2E ?? "postgresql://wms:wms@localhost:5432/wms";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("local DB only");
const db = new pg.Client({ connectionString: url });
await db.connect();
const hash = await bcrypt.hash("password123", 10);
const ids = (process.argv[2] ?? "FIN-11,FIN-12,FIN-13").split(",");
for (const s of ids) {
  await db.query(
    `INSERT INTO "User" (id, "staffId", name, "passwordHash", role, "warehouseId", active)
     SELECT 'e2e-' || lower(replace($1,'-','')), $1, 'E2E ' || $1, $2, 'FINANCE', "warehouseId", true FROM "User" WHERE "staffId" = 'FIN-1'
     ON CONFLICT ("staffId") DO NOTHING`, [s, hash]);
}
console.log((await db.query(`SELECT "staffId", role, "warehouseId" FROM "User" WHERE "staffId" = ANY($1)`, [ids])).rows);
await db.end();
