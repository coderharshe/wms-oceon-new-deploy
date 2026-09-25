import { Decimal } from "@prisma/client/runtime/library";
import { sql } from "drizzle-orm";
import type { CashTxType, Role } from "@/generated/prisma/client";
import { businessDateString } from "./business-date";

type CashTx = { type: CashTxType; amount: Decimal | number | string };

/** PRD §19: Opening + Sales + Other Receipts - Refunds - Withdrawals - Bank deposits = Expected Cash. */
export function computeExpectedCash(openingCash: Decimal | number | string, transactions: CashTx[]) {
  let expected = new Decimal(openingCash);
  for (const t of transactions) {
    const amount = new Decimal(t.amount);
    if (t.type === "SALE" || t.type === "OTHER_RECEIPT") expected = expected.add(amount);
    else expected = expected.sub(amount); // REFUND | WITHDRAWAL | BANK_DEPOSIT
  }
  return expected;
}

/**
 * A tagged-template SQL runner. The drawer code below is written once as raw
 * SQL and runs on either query layer — Prisma locally, Drizzle on Workers —
 * the same way customers/[id]/billing-context does. Every value selected is
 * cast to text/int so both drivers hand back the same JS types.
 */
export type Q = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

export function prismaQ(tx: { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => unknown }): Q {
  return ((s: TemplateStringsArray, ...v: unknown[]) => tx.$queryRaw(s, ...v)) as Q;
}

export function drizzleQ(tx: { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> }): Q {
  return (async (s: TemplateStringsArray, ...v: unknown[]) => (await tx.execute(sql(s, ...v))).rows) as Q;
}

export async function auditQ(
  q: Q,
  a: { userId: string; role?: Role | null; warehouseId: string; action: string; entityType: string; entityId: string; newValue?: unknown; reason?: string | null }
) {
  await q`INSERT INTO "AuditLog" (id, "userId", role, "warehouseId", action, "entityType", "entityId", "newValue", reason)
          VALUES (${crypto.randomUUID()}, ${a.userId}, ${a.role ?? null}::"Role", ${a.warehouseId}, ${a.action}, ${a.entityType}, ${a.entityId},
                  ${a.newValue === undefined ? null : JSON.stringify(a.newValue)}::jsonb, ${a.reason ?? null})`;
}

export type Drawer = { id: string; openingCash: string; businessDate: string; openedAt: string };

/**
 * One person's cash drawer is a chain of sessions. The drawer opens itself on
 * the first cash movement, carrying over the last count as its opening — the
 * counter never types an opening balance. Counting closes the session; the
 * next movement opens the next one. A session still open from an earlier
 * business day was never counted: it is closed as "not counted", and what the
 * software says was in it carries forward, so today's count covers both days.
 *
 * Must run inside a transaction: the advisory lock serialises everything that
 * touches this drawer until commit. That is what stops a sale landing in a
 * session that is being counted (the sale either commits first and is in the
 * count, or waits and opens the next session), and two first-sales of the day
 * each opening a drawer.
 */
export async function ensureOpenDrawer(q: Q, warehouseId: string, userId: string): Promise<Drawer> {
  await q`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`drawer:${warehouseId}:${userId}`}::text))`;
  const today = businessDateString();
  const open = await q<Drawer>`
    SELECT id, "openingCash"::text AS "openingCash", "businessDate"::text AS "businessDate", "createdAt"::text AS "openedAt"
      FROM "CashSession"
     WHERE "warehouseId" = ${warehouseId} AND "financeUserId" = ${userId} AND status = 'OPEN'
     ORDER BY "createdAt" DESC`;
  const current = open.find((s) => s.businessDate === today);
  const stale = open.filter((s) => s !== current);

  let carry: string | null = null;
  for (const s of stale) {
    const expected = await expectedCash(q, s);
    await q`UPDATE "CashSession" SET status = 'CLOSED', "expectedCash" = ${expected}::numeric, "closedAt" = (now() AT TIME ZONE 'UTC')
             WHERE id = ${s.id}`;
    carry ??= expected; // newest first
  }
  if (current) return current;

  if (carry === null) {
    const [last] = await q<{ carry: string }>`
      SELECT coalesce("actualCash", "expectedCash")::text AS carry FROM "CashSession"
       WHERE "warehouseId" = ${warehouseId} AND "financeUserId" = ${userId} AND status = 'CLOSED'
       ORDER BY "closedAt" DESC NULLS LAST LIMIT 1`;
    carry = last?.carry ?? "0";
  }
  const [created] = await q<Drawer>`
    INSERT INTO "CashSession" (id, "warehouseId", "financeUserId", "businessDate", "openingCash", status)
    VALUES (${crypto.randomUUID()}, ${warehouseId}, ${userId}, ${today}::date, ${carry}::numeric, 'OPEN')
    RETURNING id, "openingCash"::text AS "openingCash", "businessDate"::text AS "businessDate", "createdAt"::text AS "openedAt"`;
  return created!;
}

async function expectedCash(q: Q, drawer: { id: string; openingCash: string }) {
  const txs = await q<CashTx>`SELECT type::text AS type, amount::text AS amount FROM "CashTransaction" WHERE "cashSessionId" = ${drawer.id}`;
  return computeExpectedCash(drawer.openingCash, txs).toString();
}

/** A cash movement into or out of this person's drawer (opens it if needed). */
export async function recordCashMovement(
  q: Q,
  a: { warehouseId: string; userId: string; type: CashTxType; amount: Decimal | number | string; referenceId?: string | null; note?: string | null }
) {
  const drawer = await ensureOpenDrawer(q, a.warehouseId, a.userId);
  const [row] = await q<{ id: string }>`
    INSERT INTO "CashTransaction" (id, "cashSessionId", type, amount, "referenceId", note)
    VALUES (${crypto.randomUUID()}, ${drawer.id}, ${a.type}::"CashTxType", ${a.amount.toString()}::numeric, ${a.referenceId ?? null}, ${a.note ?? null})
    RETURNING id`;
  return row!;
}

/**
 * The count. Closes the current session with what was physically counted.
 * Every bill is recorded as cash, so money paid by UPI is "missing" from the
 * drawer by design — `difference` (counted - software) is normally negative,
 * and that shortfall is what the bank should have received. The real
 * discrepancy only shows once the bank balance is in (src/lib/daybook.ts).
 */
export async function countDrawer(q: Q, a: { warehouseId: string; userId: string; counted: number; note?: string | null }) {
  const drawer = await ensureOpenDrawer(q, a.warehouseId, a.userId);
  const expected = await expectedCash(q, drawer);
  const difference = new Decimal(a.counted).sub(expected).toString();
  await q`UPDATE "CashSession"
             SET status = 'CLOSED', "expectedCash" = ${expected}::numeric, "actualCash" = ${a.counted.toString()}::numeric,
                 difference = ${difference}::numeric, "discrepancyReason" = ${a.note ?? null}, "closedAt" = (now() AT TIME ZONE 'UTC')
           WHERE id = ${drawer.id}`;
  return { id: drawer.id, openingCash: drawer.openingCash, expected, counted: a.counted.toString(), difference };
}
