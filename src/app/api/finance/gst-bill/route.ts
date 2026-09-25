import { NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { getSetting } from "@/lib/settings";
import { toBaseQty, assertValidUnit, UnitError } from "@/lib/units";
import { gstLine, gstTotals, isGstin, isInterState, stateCodeOfGstin, STATE_CODES } from "@/lib/gst";
import { buildGstInvoiceHtml } from "@/lib/gst-invoice";
import { putFile } from "@/lib/r2";
import { invoiceStamp } from "@/lib/fmt";

/**
 * Issues a GST tax invoice (the A4 registered-dealer document, not the 80mm
 * counter slip). Deliberately standalone: it does not create an Order or a
 * Bill and never touches payments or QC — Finance uses it for the sales that
 * need a proper tax invoice, alongside the normal till flow.
 *
 * `deductStock` is the one place it does reach into the rest of the system:
 * a GST bill for goods that physically left the shop should move stock, one
 * for a bill raised against goods already deducted elsewhere should not, and
 * only the person raising it knows which this is. Unticked is the default —
 * inventing a stock movement is worse than missing one, since a miss shows up
 * on the next count while a phantom deduction silently oversells.
 */

const lineSchema = z.object({
  productId: z.string(),
  unitId: z.string(),
  hsn: z.string().max(8).optional(),
  // What prints in "Description of Goods". Blank falls back to the catalogue
  // name — the counter may need to say "Atta 5KG (loose)" on the invoice
  // without renaming the product for everyone. The chosen product still
  // decides the stock that moves, and the audit row records the override.
  description: z.string().trim().max(120).optional(),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  taxPercent: z.number().min(0).max(100),
});

const schema = z.object({
  customerId: z.string(),
  items: z.array(lineSchema).min(1),
  // Whether the rates below already carry the tax. The screen has the toggle;
  // the server needs it because it recomputes every figure itself.
  inclusive: z.boolean(),
  // Normally derived from the buyer's GSTIN, but an unregistered buyer has no
  // GSTIN to read a state off, so the screen can say where the supply went.
  placeOfSupply: z.string().regex(/^\d{2}$/).optional(),
  deductStock: z.boolean().optional(),
  // Set when this invoice replaces an earlier one (the "Modify" button on the
  // invoice list). A tax invoice already given to a customer is not edited in
  // place — a corrected one is issued with its own number and the old one is
  // marked superseded, so both stay answerable.
  supersedes: z.string().max(40).optional(),
  shipTo: z.string().max(200).optional(),
  terms: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const warehouseId = session.warehouseId;
  if (input.deductStock && !warehouseId) {
    return NextResponse.json({ error: "No warehouse on this session — cannot deduct stock" }, { status: 400 });
  }
  if (input.placeOfSupply && !STATE_CODES[input.placeOfSupply]) {
    return NextResponse.json({ error: "Unknown place-of-supply state code" }, { status: 400 });
  }

  // A tax invoice without a valid seller GSTIN is not a tax invoice — refuse
  // rather than print a document that claims to be one.
  const [sellerName, sellerGstin, sellerAddress, sellerEmail] = await Promise.all([
    getSetting("BUSINESS_NAME"),
    getSetting("BUSINESS_GSTIN"),
    getSetting("BUSINESS_ADDRESS"),
    getSetting("BUSINESS_EMAIL"),
  ]);
  if (!isGstin(sellerGstin)) {
    return NextResponse.json({ error: "Set a valid business GSTIN in Admin → Settings before raising a GST invoice" }, { status: 400 });
  }

  try {
    if (isWorkersRuntime()) return await runDrizzle(session, input, { sellerName, sellerGstin, sellerAddress, sellerEmail }, warehouseId);
    return await runPrisma(session, input, { sellerName, sellerGstin, sellerAddress, sellerEmail }, warehouseId);
  } catch (err) {
    if (err instanceof UnitError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ShortfallError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

type Input = z.infer<typeof schema>;
type Session = Exclude<Awaited<ReturnType<typeof requireRole>>, NextResponse>;
type Seller = { sellerName: string; sellerGstin: string; sellerAddress: string; sellerEmail: string };

class ShortfallError extends Error {}

/** What one issued invoice looks like in the audit log — the register reads
 *  exactly this shape back, so it lives next to the route that writes it. */
function gstInvoiceRecord(input: Input, out: Awaited<ReturnType<typeof render>>, customerName: string) {
  return {
    customerId: input.customerId,
    // The name AS PRINTED. A customer renamed later must not silently rewrite
    // what an already-issued tax invoice says it was made out to.
    customerName,
    total: out.totals.total,
    taxable: out.totals.taxable,
    tax: out.totals.tax,
    interState: out.interState,
    placeOfSupply: out.buyerState,
    inclusive: input.inclusive,
    lines: out.lineCount,
    stockDeducted: !!input.deductStock,
    supersedes: input.supersedes ?? null,
    key: out.key,
    items: out.items,
  };
}

/** Shared by both branches: the money, the document, and where it's stored. */
async function render(
  input: Input,
  seller: Seller,
  invoiceNo: string,
  warehouseId: string | null,
  buyer: { name: string; address: string | null; gstin: string | null; mobile: string | null },
  // Keyed by product, but the unit is resolved PER LINE: the same product can
  // legitimately appear twice in different units (2 BAG and 5 KG of one atta),
  // and a precomputed symbol per product printed the last line's unit on both.
  products: Map<string, { name: string; unitSymbolOf: (unitId: string) => string }>
) {
  const buyerState = input.placeOfSupply ?? stateCodeOfGstin(buyer.gstin) ?? stateCodeOfGstin(seller.sellerGstin);
  const interState = isInterState(seller.sellerGstin, buyerState);
  const lines = input.items.map((it) => ({
    ...gstLine(it, input.inclusive, interState),
    name: it.description?.trim() || products.get(it.productId)?.name || "",
    unit: products.get(it.productId)?.unitSymbolOf(it.unitId) ?? "",
    hsn: it.hsn?.trim() ?? "",
    quantity: it.quantity,
  }));
  const totals = gstTotals(lines);
  // Not toISOString(): the Worker runs on UTC, so a morning sale in IST would
  // print yesterday's date on a tax document. invoiceStamp exists for this.
  const { date } = invoiceStamp(new Date());
  const html = buildGstInvoiceHtml({
    seller: { name: seller.sellerName || "Store", address: seller.sellerAddress, gstin: seller.sellerGstin.trim().toUpperCase(), email: seller.sellerEmail || null },
    buyer: { name: buyer.name, address: buyer.address, gstin: buyer.gstin, stateCode: buyerState, mobile: buyer.mobile },
    shipTo: input.shipTo,
    invoiceNo,
    date,
    terms: input.terms,
    notes: input.notes,
    lines,
    interState,
  });
  // The warehouse rides in the key. /api/files/[...key] enforces PRD §6 on
  // everything it serves and resolves an `invoices/<billNumber>.html` key by
  // looking the number up on Bill — which a standalone GST invoice has no row
  // in, so under that prefix every non-admin would 404 on the document they
  // had just issued. Its own prefix, with the owner in the path, is the shape
  // that route already uses for purchase bills.
  const key = `gst-invoices/${warehouseId ?? "none"}/${invoiceNo}.html`;
  await putFile(key, html, "text/html");
  // The audit row is the ONLY record of a GST invoice — there is no Bill or
  // Order behind it — so it has to carry enough to rebuild the invoice, not
  // just summarise it. A bare line count was enough to show a total but not
  // to re-issue a corrected invoice or to move the stock afterwards, which is
  // what the register's Modify and "Deduct now" buttons both need.
  const items = input.items.map((it, i) => ({
    productId: it.productId,
    unitId: it.unitId,
    name: lines[i]!.name,
    unit: lines[i]!.unit,
    hsn: lines[i]!.hsn,
    quantity: it.quantity,
    rate: it.rate,
    taxPercent: it.taxPercent,
    renamed: !!it.description?.trim() && it.description.trim() !== products.get(it.productId)?.name,
  }));
  return { key, totals, interState, lineCount: lines.length, items, buyerState };
}

async function runPrisma(session: Session, input: Input, seller: Seller, warehouseId: string | null) {
  const db = (await import("@/lib/db")).getDb();
  const { nextNumber } = await import("@/lib/numbering");
  const { adjustStock } = await import("@/lib/inventory");
  const { writeAudit } = await import("@/lib/audit");

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: { saleUnits: { include: { unit: true } } },
  });
  if (products.length !== productIds.length) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const byId = new Map(
    products.map((p) => [
      p.id,
      { name: p.name, saleUnits: p.saleUnits, unitSymbolOf: (unitId: string) => p.saleUnits.find((u) => u.unitId === unitId)?.unit.symbol ?? "" },
    ])
  );
  const nameUnit = new Map([...byId].map(([id, p]) => [id, { name: p.name, unitSymbolOf: p.unitSymbolOf }]));

  const invoiceNo = await db.$transaction(async (tx) => {
    // ponytail: reuses the app's PREFIX-YYYYMMDD-NNNN counter rather than a
    // Tally-style FY series (AM/25-26/17). The string is still unique and
    // monotonic within the financial year, which is what the rule asks for.
    // Swap in an FY-scoped key here if the accountant wants the other shape.
    const no = await nextNumber(tx, "gst-invoice", "GST");
    if (input.deductStock) {
      for (const it of input.items) {
        const p = byId.get(it.productId)!;
        assertValidUnit(p.saleUnits, it.unitId);
        const baseQty = toBaseQty(p.saleUnits, it.unitId, it.quantity);
        const { after } = await adjustStock(tx, {
          productId: it.productId,
          warehouseId: warehouseId!,
          deltaBaseQty: baseQty.neg(),
          movementType: "SALE",
          referenceType: "GST_INVOICE",
          referenceId: no,
          userId: session.sub,
        });
        if (after.lessThan(new Decimal(0))) throw new ShortfallError(`Not enough stock for ${p.name}`);
      }
    }
    return no;
  });

  const customerNameForRecord = customer.shopName;
  const out = await render(input, seller, invoiceNo, warehouseId, { name: customer.shopName, address: customer.address, gstin: customer.gstin, mobile: customer.mobile }, nameUnit);
  await writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId,
    action: "GST_INVOICE_ISSUED",
    entityType: "GstInvoice",
    entityId: invoiceNo,
    newValue: gstInvoiceRecord(input, out, customerNameForRecord),
  });
  return NextResponse.json({ invoiceNo, key: out.key, url: `/api/files/${out.key}`, total: out.totals.total }, { status: 201 });
}

async function runDrizzle(session: Session, input: Input, seller: Seller, warehouseId: string | null) {
  const { getDrizzleDb } = await import("@/lib/drizzle-db");
  const { customer: customerT, product: productT, productUnit, unit: unitT } = await import("@/generated/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { nextNumberDrizzle } = await import("@/lib/drizzle-numbering");
  const { adjustStockDrizzle } = await import("@/lib/drizzle-inventory");
  const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
  const db = getDrizzleDb();

  const [customer] = await db.select().from(customerT).where(eq(customerT.id, input.customerId));
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await db.select().from(productT).where(inArray(productT.id, productIds));
  if (products.length !== productIds.length) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const saleUnits = await db
    .select({ productId: productUnit.productId, unitId: productUnit.unitId, factorToBase: productUnit.factorToBase, isBaseUnit: productUnit.isBaseUnit, symbol: unitT.symbol })
    .from(productUnit)
    .leftJoin(unitT, eq(unitT.id, productUnit.unitId))
    .where(inArray(productUnit.productId, productIds));

  const unitsOf = (productId: string) => saleUnits.filter((u) => u.productId === productId);
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const nameUnit = new Map(
    productIds.map((id) => [
      id,
      { name: nameOf.get(id) ?? "", unitSymbolOf: (unitId: string) => unitsOf(id).find((u) => u.unitId === unitId)?.symbol ?? "" },
    ])
  );

  const invoiceNo = await db.transaction(async (tx) => {
    const no = await nextNumberDrizzle(tx, "gst-invoice", "GST");
    if (input.deductStock) {
      for (const it of input.items) {
        const us = unitsOf(it.productId);
        assertValidUnit(us, it.unitId);
        const baseQty = toBaseQty(us, it.unitId, it.quantity);
        const { after } = await adjustStockDrizzle(tx, {
          productId: it.productId,
          warehouseId: warehouseId!,
          deltaBaseQty: baseQty.neg(),
          movementType: "SALE",
          referenceType: "GST_INVOICE",
          referenceId: no,
          userId: session.sub,
        });
        if (after.lessThan(new Decimal(0))) throw new ShortfallError(`Not enough stock for ${nameOf.get(it.productId) ?? "product"}`);
      }
    }
    return no;
  });

  const customerNameForRecord = customer.shopName;
  const out = await render(input, seller, invoiceNo, warehouseId, { name: customer.shopName, address: customer.address, gstin: customer.gstin, mobile: customer.mobile }, nameUnit);
  await writeAuditDrizzle({
    userId: session.sub,
    role: session.role,
    warehouseId,
    action: "GST_INVOICE_ISSUED",
    entityType: "GstInvoice",
    entityId: invoiceNo,
    newValue: gstInvoiceRecord(input, out, customerNameForRecord),
  });
  return NextResponse.json({ invoiceNo, key: out.key, url: `/api/files/${out.key}`, total: out.totals.total }, { status: 201 });
}
