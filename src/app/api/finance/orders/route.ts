import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { buildBillLine, shortfallIssues, sumBillTotals } from "@/lib/pricing";
import { isWorkersRuntime } from "@/lib/cf-env";

import { claimIdempotencyKey, claimIdempotencyKeyDrizzle, DuplicateRequestError } from "@/lib/idempotency";
import { applyReceivableDelta, recordCashPayment } from "@/lib/payment-service";
import { applyReceivableDeltaDrizzle, recordCashPaymentDrizzle } from "@/lib/drizzle-payment-service";
import { completeIfQcOff } from "@/lib/complete-without-qc";
import { acceptBilledAt } from "@/lib/business-date";

/**
 * Lines where finance typed a rate over the catalogue one. Folded into the
 * BILL_CREATED audit entry so "why was this sold at that price" is answerable
 * later — the bill itself only records what was charged, not what was quoted.
 */
function overrideAudit(lines: { product: { name: string }; unitPrice: Decimal; catalogPrice: Decimal }[]) {
  const overrides = lines
    .filter((l) => !l.unitPrice.eq(l.catalogPrice))
    .map((l) => ({ product: l.product.name, catalogue: l.catalogPrice.toString(), charged: l.unitPrice.toString() }));
  return overrides.length ? { priceOverrides: overrides } : {};
}

/**
 * Customer.creditLimit had no readers at all, so a wholesale customer could
 * be billed unlimited credit. Checked inside the order transaction, against
 * the customer row already fetched there — and reported, never refused: the
 * bill prints and the manager gets the line on their Orders screen.
 */
function creditLimitIssue(
  cust: { shopName: string; creditLimit: unknown; outstandingBalance: unknown },
  total: Decimal
): string | null {
  if (cust.creditLimit === null || cust.creditLimit === undefined) return null; // no limit set = no check
  const limit = new Decimal(cust.creditLimit as Decimal);
  // outstandingBalance is money the customer OWES. Floored at 0 because the
  // field is currently only ever decremented and can go negative — a negative
  // balance must not manufacture extra credit headroom.
  const outstanding = Decimal.max(new Decimal(cust.outstandingBalance as Decimal), 0);
  const projected = outstanding.add(total);
  if (!projected.gt(limit)) return null;
  return `${cust.shopName} is over their credit limit: limit Rs ${limit.toFixed(2)}, already owes Rs ${outstanding.toFixed(2)}, this bill Rs ${total.toFixed(2)} — over by Rs ${projected.sub(limit).toFixed(2)}. Collect or raise the limit.`;
}

// Nothing here refuses a bill. A quantity of 0, a rate of 0, a discount that
// makes no sense: all of them bill, and buildBillLine writes them onto the
// order for the manager. The only hard requirement is knowing WHAT was sold.
const itemSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
  unitId: z.string(),
  discount: z.number().default(0),
  // Finance types a rate over the catalogue one at the counter (a negotiated
  // price, an old stock clearance). Omitted means "use the product's price".
  // OrderItem.unitPrice stores whatever was actually charged either way, so
  // the bill and every report stay correct without touching the master.
  unitPrice: z.number().optional(),
});

/** The name on an anonymous over-the-counter sale, same as the paper pad. */
const WALK_IN = "CASH";

// Counter staff should never have to "add a customer" as a separate step, so
// the billing screen sends the details it has and the order route upserts
// them. Mobile is the identity: an unknown one creates the customer, a known
// one updates the editable fields in place. Changing the mobile therefore
// means a different customer, not a rename.
const customerInput = z
  .object({
    // Plenty of walk-ins have no shop at all, and shopName stays NOT NULL in
    // the schema, so each name falls back to the other and both fall back to
    // CASH rather than costing a migration or refusing the bill.
    ownerName: z.string().trim().optional(),
    shopName: z.string().trim().optional(),
    // Optional, and no length rule beyond "not blank". A 6-digit minimum used
    // to reject the whole bill over a half-typed number, which is a hard
    // failure on a field nobody was required to fill in. Without a number
    // there is no identity to match on, so such a bill always creates a fresh
    // customer rather than silently merging every anonymous sale into one row.
    mobile: z.string().trim().min(1).optional(),
    type: z.enum(["WHOLESALE", "RETAIL"]),
    address: z.string().trim().optional(),
    gstin: z.string().trim().optional(),
  })
  .transform((c) => ({ ...c, ownerName: c.ownerName || c.shopName || WALK_IN, shopName: c.shopName || c.ownerName || WALK_IN }));

const createSchema = z.object({
  warehouseId: z.string().optional(), // required for ADMIN, ignored otherwise
  customer: customerInput.optional(),
  sellingMode: z.enum(["WHOLESALE", "RETAIL"]),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
  // Save without billing yet — no stock reserved, no bill/order numbers spent
  // beyond the order number itself. Finance resumes it later via
  // POST /api/finance/orders/[id]/finalize.
  draft: z.boolean().default(false),
  // The counter is paid in cash as the slip is handed over, so a new bill is
  // recorded as paid the moment it exists. Set when the bill goes on credit
  // instead — the customer owes it and it shows up as unpaid everywhere.
  unpaid: z.boolean().default(false),
  // Client-generated, one per submission. A billing screen that loses the
  // response after the server already committed will retry the same click —
  // without this that retry is a second order with stock reserved twice.
  // Same mechanism the stock-in and cash-payment routes already use.
  // Also stored on Order.clientRequestId (unique) — a UUID, so it can never
  // be mistaken for, or planted as, another order's id.
  clientRequestId: z.string().uuid().optional(),
  // Offline-first billing (src/lib/offline-bills.ts). offlineRef is the
  // provisional OFF-… number printed on the slip while the till was offline;
  // billedAt is when the PC made the bill. billedAt is a plain string, not
  // z.datetime(): a garbled clock value must not refuse the bill, it is
  // noted for the manager instead (acceptBilledAt).
  offlineRef: z.string().trim().max(40).optional(),
  billedAt: z.string().optional(),
});

/**
 * The answer to a re-sent bill the server already committed. The offline
 * till needs the real order and INV numbers to replace its provisional slip,
 * so the order is looked up by the clientRequestId it was stored under. A
 * key claimed before Order.clientRequestId existed finds nothing — the
 * duplicate is still reported, just without ids. Neither are ids handed to a
 * till in another warehouse.
 */
async function duplicateBill(clientRequestId: string, warehouseId: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, bill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDrizzleDb()
      .select({ id: order.id, orderNumber: order.orderNumber, offlineRef: order.offlineRef, clientRequestId: order.clientRequestId, warehouseId: order.warehouseId, billId: bill.id, billNumber: bill.billNumber })
      .from(order)
      .leftJoin(bill, eq(bill.orderId, order.id))
      .where(eq(order.clientRequestId, clientRequestId))
      .then((rows) => rows.filter((r) => r.warehouseId === warehouseId));
    return {
      duplicate: true,
      order: row ? { id: row.id, orderNumber: row.orderNumber, offlineRef: row.offlineRef, clientRequestId: row.clientRequestId } : null,
      bill: row?.billId ? { id: row.billId, billNumber: row.billNumber } : null,
    };
  }
  const db = (await import("@/lib/db")).getDb();
  const row = await db.order.findUnique({
    where: { clientRequestId },
    select: { id: true, orderNumber: true, offlineRef: true, clientRequestId: true, warehouseId: true, bill: { select: { id: true, billNumber: true } } },
  }).then((r) => (r?.warehouseId === warehouseId ? r : null));
  return { duplicate: true, order: row ? { id: row.id, orderNumber: row.orderNumber, offlineRef: row.offlineRef, clientRequestId: row.clientRequestId } : null, bill: row?.bill ?? null };
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE", "BILLING", "QC"]);
  if (isErrorResponse(session)) return session;

  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const warehouseId = session.role === "ADMIN" ? req.nextUrl.searchParams.get("warehouseId") ?? undefined : session.warehouseId!;
  const since = req.nextUrl.searchParams.get("since") ? new Date(req.nextUrl.searchParams.get("since")!) : null;
  const until = req.nextUrl.searchParams.get("until") ? new Date(req.nextUrl.searchParams.get("until")!) : null;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order, customer, bill, payment } = await import("@/generated/drizzle/schema");
    const { eq, and, or, ilike, inArray, desc, gte, lte } = await import("drizzle-orm");
    const db = getDrizzleDb();

    const conditions = [];
    if (warehouseId) conditions.push(eq(order.warehouseId, warehouseId));
    if (status) conditions.push(eq(order.status, status as any));
    if (since) conditions.push(gte(order.createdAt, since.toISOString()));
    if (until) conditions.push(lte(order.createdAt, until.toISOString()));
    let orderIdsMatchingQ: string[] | null = null;
    if (q) {
      const matchingCustomers = await db.select({ id: customer.id }).from(customer).where(ilike(customer.shopName, `%${q}%`));
      const customerIds = matchingCustomers.map((c) => c.id);
      conditions.push(
        customerIds.length
          ? or(ilike(order.orderNumber, `%${q}%`), ilike(order.offlineRef, `%${q}%`), inArray(order.customerId, customerIds))!
          : or(ilike(order.orderNumber, `%${q}%`), ilike(order.offlineRef, `%${q}%`))!
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const orders = await db.select().from(order).where(where).orderBy(desc(order.createdAt)).limit(100);
    if (orders.length === 0) return NextResponse.json([]);

    const orderIds = orders.map((o) => o.id);
    const customerIds = [...new Set(orders.map((o) => o.customerId))];
    const [customers, bills] = await Promise.all([
      customerIds.length ? db.select().from(customer).where(inArray(customer.id, customerIds)) : Promise.resolve([]),
      db.select().from(bill).where(inArray(bill.orderId, orderIds)),
    ]);
    const billIds = bills.map((b) => b.id);
    const payments = billIds.length ? await db.select().from(payment).where(inArray(payment.billId, billIds)) : [];
    const paymentByBill = new Map(payments.map((p) => [p.billId, p]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const billByOrder = new Map(bills.map((b) => [b.orderId, { ...b, payment: paymentByBill.get(b.id) ?? null }]));

    return NextResponse.json(orders.map((o) => ({ ...o, customer: customerMap.get(o.customerId) ?? null, bill: billByOrder.get(o.id) ?? null })));
  }

  const db = (await import("@/lib/db")).getDb();
  const orders = await db.order.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      ...(status ? { status: status as any } : {}),
      ...(since || until ? { createdAt: { gte: since ?? undefined, lte: until ?? undefined } } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              // The provisional OFF-… number off an offline slip.
              { offlineRef: { contains: q, mode: "insensitive" } },
              { customer: { shopName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { customer: true, bill: { include: { payment: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "FINANCE", "BILLING"]);
  if (isErrorResponse(session)) return session;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // No customer on the request is a cash sale, not a reason to refuse the
  // bill — the same walk-in the shop writes on a paper estimate.
  const body = {
    ...parsed.data,
    customer: parsed.data.customer ?? { ownerName: WALK_IN, shopName: WALK_IN, type: parsed.data.sellingMode },
  };
  // Every problem found while billing, in the order it was found. Written onto
  // the order as reviewNotes so the manager's Orders screen can list it; the
  // bill itself is never held up for any of them.
  const issues: string[] = [];

  // An offline bill keeps the time it was made on the PC. Only a bill that
  // carries an offlineRef came through the offline till, so only it may be
  // backdated — anything else posting a billedAt is dated now. Only an
  // accepted billedAt overrides createdAt; otherwise the DB default stands.
  const billed = acceptBilledAt(body.offlineRef ? body.billedAt : undefined);
  if (billed.issue) issues.push(billed.issue);
  const createdAt = billed.backdated ? billed.at : undefined;

  const warehouseId = session.role === "ADMIN" ? body.warehouseId : session.warehouseId!;
  if (!warehouseId) return NextResponse.json({ error: "warehouseId is required" }, { status: 400 });
  const forbidden = assertWarehouseAccess(session, warehouseId);
  if (forbidden) return forbidden;

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, orderItem, product, productUnit, bill, billVersion, billItem, payment, customer } = await import("@/generated/drizzle/schema");
      const { eq, inArray, and } = await import("drizzle-orm");
      const { nextNumberDrizzle } = await import("@/lib/drizzle-numbering");
      const { reserveStockBatchDrizzle } = await import("@/lib/drizzle-inventory");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const { publish } = await import("@/lib/realtime");
      const db = getDrizzleDb();

      const result = await db.transaction(async (tx) => {
        if (body.clientRequestId) await claimIdempotencyKeyDrizzle(tx, body.clientRequestId);
        let cust;
        {
          const details = body.customer;
          const [existing] = details.mobile
            ? (await tx.select().from(customer).where(eq(customer.mobile, details.mobile)))
            : [];
          if (existing) {
            // Only write when something actually differs — an unchanged
            // customer must not generate an audit entry per order.
            const changed =
              existing.shopName !== details.shopName ||
              existing.type !== details.type ||
              (details.ownerName ?? null) !== (existing.ownerName ?? null) ||
              (details.address ?? null) !== (existing.address ?? null) ||
              (details.gstin ?? null) !== (existing.gstin ?? null);
            if (changed) {
              const [updated] = await tx
                .update(customer)
                .set({
                  shopName: details.shopName,
                  type: details.type,
                  ownerName: details.ownerName ?? existing.ownerName,
                  address: details.address ?? existing.address,
                  gstin: details.gstin ?? existing.gstin,
                })
                .where(eq(customer.id, existing.id))
                .returning();
              cust = updated;
              await writeAuditDrizzle({
                userId: session.sub, role: session.role, warehouseId,
                action: "CUSTOMER_UPDATED", entityType: "Customer", entityId: existing.id,
                oldValue: { shopName: existing.shopName, type: existing.type },
                newValue: { shopName: details.shopName, type: details.type },
              }, tx);
            } else {
              cust = existing;
            }
          } else {
            // onConflict, not a plain insert: two counters billing the same
            // new mobile at once both used to insert, one tripped the unique
            // index, and that bill died. Now the loser updates instead.
            const [created] = await tx
              .insert(customer)
              .values({ id: crypto.randomUUID(), ...details })
              .onConflictDoUpdate({ target: customer.mobile, set: { shopName: details.shopName, type: details.type } })
              .returning();
            cust = created;
            await writeAuditDrizzle({
              userId: session.sub, role: session.role, warehouseId,
              action: "CUSTOMER_CREATED", entityType: "Customer", entityId: created!.id, newValue: details,
            }, tx);
          }
        }
        if (!cust) throw new Error("Customer not found");

        const productIds = body.items.map((i) => i.productId);
        // No `active` filter: a product switched off after the cashier picked
        // it is still what the customer is walking out with. It bills, with a
        // note, rather than disappearing off the bill.
        const products = await tx.select().from(product).where(inArray(product.id, productIds));
        const saleUnits = await tx.select().from(productUnit).where(inArray(productUnit.productId, productIds));
        const saleUnitsByProduct = new Map<string, typeof saleUnits>();
        for (const su of saleUnits) saleUnitsByProduct.set(su.productId, [...(saleUnitsByProduct.get(su.productId) ?? []), su]);
        const productMap = new Map(products.map((p) => [p.id, p]));

        // A product that has vanished from the catalogue since the cashier
        // picked it cannot be a line at all (OrderItem points at it), so it is
        // the one thing dropped — loudly. Everything else bills.
        const lines = body.items.flatMap((item) => {
          const p = productMap.get(item.productId);
          if (!p) {
            issues.push(`A product on this bill (${item.productId}) is no longer in the catalogue, so its line could not be billed. Check what the customer took and revise the bill.`);
            return [];
          }
          if (!p.active) issues.push(`${p.name} is switched off in the catalogue but was billed anyway. Switch it back on or check what was sold.`);
          return [buildBillLine(p as any, (saleUnitsByProduct.get(p.id) ?? []) as any, item, body.sellingMode, issues)];
        });

        const orderNumber = await nextNumberDrizzle(tx, "order", "ORD", billed.at);
        const [ord] = await tx
          .insert(order)
          .values({
            id: crypto.randomUUID(),
            orderNumber,
            warehouseId,
            customerId: cust.id,
            financeUserId: session.sub,
            sellingMode: body.sellingMode,
            status: body.draft ? "DRAFT" : "BILLED",
            notes: body.notes,
            clientRequestId: body.clientRequestId || null,
            offlineRef: body.offlineRef || null,
            createdAt: createdAt?.toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .returning();
        await tx.insert(orderItem).values(
          lines.map((l) => ({
            id: crypto.randomUUID(),
            orderId: ord!.id,
            productId: l.product.id,
            quantity: l.quantity.toString(),
            unitId: l.unitId,
            unitPrice: l.unitPrice.toString(),
            discount: l.discount.toString(),
            taxAmount: l.taxAmount.toString(),
            lineTotal: l.lineTotal.toString(),
          }))
        );

        // Whatever went wrong with this bill goes onto the order itself, for
        // the manager's Orders screen to list and clear. One extra write, and
        // only on the bills that have something wrong with them.
        const flagIssues = async () => {
          if (issues.length === 0) return;
          const reviewNotes = issues.join("\n");
          await tx.update(order).set({ needsReview: true, reviewNotes }).where(eq(order.id, ord!.id));
          Object.assign(ord!, { needsReview: true, reviewNotes });
        };

        // Draft: stop here — no stock reserved, no bill yet. Finance
        // finalizes it later (POST .../finalize), which is where reservation
        // and billing actually happen.
        if (body.draft) {
          await flagIssues();
          return { order: ord, bill: null };
        }

        // Reserve stock now that the order row exists to reference. Never
        // refuses — a line the shelf can't cover reserves anyway and comes
        // back as a shortfall for the manager.
        const short = await reserveStockBatchDrizzle(tx, {
          warehouseId,
          orderId: ord!.id,
          userId: session.sub,
          lines: lines.map((line) => ({ productId: line.product.id, baseQty: line.baseQty })),
        });
        issues.push(...shortfallIssues(short, (id) => productMap.get(id)?.name ?? id));

        const totals = sumBillTotals(lines);
        const overLimit = creditLimitIssue(cust, totals.total);
        if (overLimit) issues.push(overLimit);
        const billNumber = await nextNumberDrizzle(tx, "bill", "INV", billed.at);
        const [newBill] = await tx
          .insert(bill)
          .values({ id: crypto.randomUUID(), billNumber, orderId: ord!.id, warehouseId, paymentStatus: "UNPAID", currentVersion: 1, createdAt: createdAt?.toISOString() })
          .returning();
        const [version] = await tx
          .insert(billVersion)
          .values({
            id: crypto.randomUUID(),
            billId: newBill!.id,
            versionNumber: 1,
            versionType: "FINANCE",
            subtotal: totals.subtotal.toString(),
            discountTotal: totals.discountTotal.toString(),
            taxTotal: totals.taxTotal.toString(),
            total: totals.total.toString(),
            createdByUserId: session.sub,
            createdAt: createdAt?.toISOString(),
          })
          .returning();
        await tx.insert(billItem).values(
          lines.map((l) => ({
            id: crypto.randomUUID(),
            billVersionId: version!.id,
            productId: l.product.id,
            quantity: l.quantity.toString(),
            unitId: l.unitId,
            unitPrice: l.unitPrice.toString(),
            discount: l.discount.toString(),
            taxAmount: l.taxAmount.toString(),
            lineTotal: l.lineTotal.toString(),
            changeType: "KEPT" as const,
          }))
        );
        const [pay] = await tx.insert(payment).values({ id: crypto.randomUUID(), billId: newBill!.id, amountDue: totals.total.toString(), amountPaid: "0" }).returning();
        // The bill now exists and is unpaid: that is money the customer owes.
        // Every other mutation of it routes through applyReceivableDelta too.
        await applyReceivableDeltaDrizzle(tx, cust.id, { due: 0, paid: 0 }, { due: totals.total, paid: 0 });
        // ...and then settled in the same breath, unless finance said the
        // bill is on credit. A zero-total bill has nothing to collect.
        if (!body.unpaid && totals.total.gt(0)) {
          await recordCashPaymentDrizzle(tx, { billId: newBill!.id, amountReceived: totals.total, userId: session.sub, warehouseId, orderId: ord!.id });
        }


        await writeAuditDrizzle({
          userId: session.sub,
          role: session.role,
          warehouseId,
          action: "BILL_CREATED",
          entityType: "Bill",
          entityId: newBill!.id,
          newValue: { billNumber, total: totals.total.toString(), orderId: ord!.id, ...overrideAudit(lines) },
        }, tx);

        await flagIssues();
        return { order: ord, bill: { ...newBill, versions: [{ ...version, items: [] }], payment: pay } };
      });

      publish(`warehouse:${warehouseId}`, "order:created", { orderId: result.order!.id });
      // Paid on creation, so with QC off the order is already finished —
      // same follow-up the cash route does, and outside the transaction for
      // the same reason.
      if (result.bill && !body.unpaid) await completeIfQcOff(result.order!.id, session.sub);
      return NextResponse.json(result, { status: 201 });
    }

    const db = (await import("@/lib/db")).getDb();
    const { nextNumber } = await import("@/lib/numbering");
    const { reserveStockBatch } = await import("@/lib/inventory");
    const { writeAudit } = await import("@/lib/audit");
    const { publish } = await import("@/lib/realtime");

    const result = await db.$transaction(async (tx) => {
      if (body.clientRequestId) await claimIdempotencyKey(tx, body.clientRequestId);
      let customer = null;
      {
        const details = body.customer;
        const existing = details.mobile ? await tx.customer.findUnique({ where: { mobile: details.mobile } }) : null;
        if (existing) {
          const changed =
            existing.shopName !== details.shopName ||
            existing.type !== details.type ||
            (details.ownerName ?? null) !== existing.ownerName ||
            (details.address ?? null) !== existing.address ||
            (details.gstin ?? null) !== existing.gstin;
          if (changed) {
            customer = await tx.customer.update({
              where: { id: existing.id },
              data: {
                shopName: details.shopName,
                type: details.type,
                ownerName: details.ownerName ?? existing.ownerName,
                address: details.address ?? existing.address,
                gstin: details.gstin ?? existing.gstin,
              },
            });
            await writeAudit({
              userId: session.sub, role: session.role, warehouseId,
              action: "CUSTOMER_UPDATED", entityType: "Customer", entityId: existing.id,
              oldValue: { shopName: existing.shopName, type: existing.type },
              newValue: { shopName: details.shopName, type: details.type },
            }, tx);
          } else {
            customer = existing;
          }
        } else {
          // upsert, not create: two counters billing the same new mobile at
          // once both used to insert, one tripped the unique index, and that
          // bill died. Now the loser updates instead.
          customer = details.mobile
            ? await tx.customer.upsert({
                where: { mobile: details.mobile },
                create: details,
                update: { shopName: details.shopName, type: details.type },
              })
            : await tx.customer.create({ data: details });
          await writeAudit({
            userId: session.sub, role: session.role, warehouseId,
            action: "CUSTOMER_CREATED", entityType: "Customer", entityId: customer.id, newValue: details,
          }, tx);
        }
      }
      if (!customer) throw new Error("Customer not found");

      // No `active` filter — see the Workers path above.
      const products = await tx.product.findMany({
        where: { id: { in: body.items.map((i) => i.productId) } },
        include: { saleUnits: true },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      // A product that has vanished from the catalogue since the cashier
      // picked it cannot be a line at all (OrderItem points at it), so it is
      // the one thing dropped — loudly. Everything else bills.
      const lines = body.items.flatMap((item) => {
        const product = productMap.get(item.productId);
        if (!product) {
          issues.push(`A product on this bill (${item.productId}) is no longer in the catalogue, so its line could not be billed. Check what the customer took and revise the bill.`);
          return [];
        }
        if (!product.active) issues.push(`${product.name} is switched off in the catalogue but was billed anyway. Switch it back on or check what was sold.`);
        return [buildBillLine(product, product.saleUnits, item, body.sellingMode, issues)];
      });

      const orderNumber = await nextNumber(tx, "order", "ORD", billed.at);
      const order = await tx.order.create({
        data: {
          orderNumber,
          warehouseId,
          customerId: customer.id,
          financeUserId: session.sub,
          sellingMode: body.sellingMode,
          status: body.draft ? "DRAFT" : "BILLED",
          notes: body.notes,
          clientRequestId: body.clientRequestId || undefined,
          offlineRef: body.offlineRef || undefined,
          createdAt,
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              quantity: l.quantity,
              unitId: l.unitId,
              unitPrice: l.unitPrice,
              discount: l.discount,
              taxAmount: l.taxAmount,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });

      // Whatever went wrong with this bill goes onto the order itself, for
      // the manager's Orders screen to list and clear. One extra write, and
      // only on the bills that have something wrong with them.
      const flagIssues = async () => {
        if (issues.length === 0) return order;
        return tx.order.update({ where: { id: order.id }, data: { needsReview: true, reviewNotes: issues.join("\n") } });
      };

      // Draft: stop here — no stock reserved, no bill yet. Finance finalizes
      // it later (POST .../finalize), which is where reservation and billing
      // actually happen.
      if (body.draft) return { order: await flagIssues(), bill: null };

      // One batched call, not a per-line loop: it aggregates duplicate
      // products and locks rows in sorted productId order, so two tills
      // billing the same two products in opposite order can't deadlock each
      // other. Mirrors reserveStockBatchDrizzle on the Workers path above.
      const short = await reserveStockBatch(tx, {
        warehouseId,
        orderId: order.id,
        userId: session.sub,
        lines: lines.map((line) => ({ productId: line.product.id, baseQty: line.baseQty })),
      });
      issues.push(...shortfallIssues(short, (id) => productMap.get(id)?.name ?? id));

      const totals = sumBillTotals(lines);
      const overLimit = creditLimitIssue(customer, totals.total);
      if (overLimit) issues.push(overLimit);
      const billNumber = await nextNumber(tx, "bill", "INV", billed.at);
      const bill = await tx.bill.create({
        data: {
          billNumber,
          orderId: order.id,
          warehouseId,
          paymentStatus: "UNPAID",
          currentVersion: 1,
          createdAt,
          versions: {
            create: {
              versionNumber: 1,
              createdAt,
              versionType: "FINANCE",
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              total: totals.total,
              createdByUserId: session.sub,
              items: {
                create: lines.map((l) => ({
                  productId: l.product.id,
                  quantity: l.quantity,
                  unitId: l.unitId,
                  unitPrice: l.unitPrice,
                  discount: l.discount,
                  taxAmount: l.taxAmount,
                  lineTotal: l.lineTotal,
                  changeType: "KEPT",
                })),
              },
            },
          },
          payment: { create: { amountDue: totals.total, amountPaid: 0 } },
        },
        include: { versions: { include: { items: true } }, payment: true },
      });

      // The bill now exists and is unpaid: that is money the customer owes.
      await applyReceivableDelta(tx, customer.id, { due: 0, paid: 0 }, { due: totals.total, paid: 0 });
      // ...and then settled in the same breath, unless finance said the bill
      // is on credit. A zero-total bill has nothing to collect.
      if (!body.unpaid && totals.total.gt(0)) {
        await recordCashPayment(tx, { billId: bill.id, amountReceived: totals.total, userId: session.sub, warehouseId, orderId: order.id });
      }

      await writeAudit(
        {
          userId: session.sub,
          role: session.role,
          warehouseId,
          action: "BILL_CREATED",
          entityType: "Bill",
          entityId: bill.id,
          newValue: { billNumber, total: totals.total.toString(), orderId: order.id, ...overrideAudit(lines) },
        },
        tx
      );

      return { order: await flagIssues(), bill };
    }, { timeout: 15000 });

    publish(`warehouse:${warehouseId}`, "order:created", { orderId: result.order.id });
    // Paid on creation, so with QC off the order is already finished — same
    // follow-up the cash route does, and outside the transaction for the same
    // reason.
    if (result.bill && !body.unpaid) await completeIfQcOff(result.order.id, session.sub);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // A retried submission of a click the server already committed. The order
    // exists — say so rather than creating a second one.
    if (err instanceof DuplicateRequestError) {
      return NextResponse.json(await duplicateBill(body.clientRequestId!, warehouseId), { status: 200 });
    }
    // Nothing else refuses a bill any more: a unit that isn't set up, a
    // product with no price, stock the shelf doesn't have and a customer over
    // their credit limit all bill and land on the order as reviewNotes. What
    // reaches here is the database being unreachable, which no flag can bill
    // through — it is a 500 the till can retry.
    throw err;
  }
}
