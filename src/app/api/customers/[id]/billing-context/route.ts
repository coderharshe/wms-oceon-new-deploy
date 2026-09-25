import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

export type BillingContext = {
  outstanding: number;
  creditLimit: number | null;
  lastBill: { orderId: string; orderNumber: string; total: number; paid: number; at: string } | null;
  lastPayment: { amount: number; method: "CASH" | "UPI"; at: string } | null;
  // The rate this customer was last actually charged, per product and unit —
  // Marg's "last deal". From the bill's CURRENT version, not OrderItem, so a
  // rate corrected through Modify Bill is the one offered next time.
  lastRates: { productId: string; unitId: string; unitPrice: number; quantity: number; at: string }[];
};

/**
 * What the counter needs to know about a customer the moment they are picked
 * on the New Order screen: what they owe, how close that is to their limit,
 * their last bill and payment, and the rates they were last billed at.
 *
 * One statement, one round trip — the database is a network hop away and
 * this runs on every customer pick. Written once as a tagged template so the
 * Workers (Drizzle `sql`) and local (Prisma `$queryRaw`) paths share the SQL.
 * Timestamps are cast to timestamptz so the JSON carries a zone; without it a
 * bill from 11pm UTC would show as the wrong day in IST.
 */
function query<T>(tag: (strings: TemplateStringsArray, ...values: unknown[]) => T, id: string): T {
  return tag`
    SELECT
      c."outstandingBalance"::float8 AS "outstanding",
      c."creditLimit"::float8 AS "creditLimit",
      (SELECT json_build_object('orderId', o.id, 'orderNumber', o."orderNumber", 'total', p."amountDue", 'paid', p."amountPaid", 'at', b."createdAt" AT TIME ZONE 'UTC')
         FROM "Bill" b
         JOIN "Order" o ON o.id = b."orderId"
         JOIN "Payment" p ON p."billId" = b.id
        WHERE o."customerId" = c.id AND o.status <> 'CANCELLED'
        ORDER BY b."createdAt" DESC LIMIT 1) AS "lastBill",
      (SELECT json_build_object('amount', t.amount, 'method', t.method, 'at', t.timestamp AT TIME ZONE 'UTC')
         FROM "PaymentTransaction" t
         JOIN "Payment" p ON p.id = t."paymentId"
         JOIN "Bill" b ON b.id = p."billId"
         JOIN "Order" o ON o.id = b."orderId"
        WHERE o."customerId" = c.id AND t.type = 'PAYMENT' AND t.status = 'CONFIRMED'
        ORDER BY t.timestamp DESC LIMIT 1) AS "lastPayment",
      (SELECT coalesce(json_agg(r), '[]'::json) FROM (
         SELECT DISTINCT ON (bi."productId", bi."unitId")
                bi."productId", bi."unitId", bi."unitPrice"::float8 AS "unitPrice", bi.quantity::float8 AS quantity,
                b."createdAt" AT TIME ZONE 'UTC' AS at
           FROM "BillItem" bi
           JOIN "BillVersion" v ON v.id = bi."billVersionId"
           JOIN "Bill" b ON b.id = v."billId" AND v."versionNumber" = b."currentVersion"
           JOIN "Order" o ON o.id = b."orderId"
          WHERE o."customerId" = c.id AND o.status <> 'CANCELLED' AND bi.quantity > 0
          ORDER BY bi."productId", bi."unitId", b."createdAt" DESC
      ) r) AS "lastRates"
    FROM "Customer" c
    WHERE c.id = ${id}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  let row: BillingContext | undefined;
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { sql } = await import("drizzle-orm");
    const result = await getDrizzleDb().execute(query(sql, id));
    row = result.rows[0] as BillingContext | undefined;
  } else {
    const db = (await import("@/lib/db")).getDb();
    row = (await query<Promise<BillingContext[]>>(db.$queryRaw.bind(db), id))[0];
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
