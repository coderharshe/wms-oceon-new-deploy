import { Decimal } from "@prisma/client/runtime/library";
import { computeLine, resolveUnitPrice, sumBillTotals } from "./pricing";
import { assertValidUnit, toBaseQty, UnitError } from "./units";

/**
 * A finance- or manager-initiated bill revision, as opposed to the QC one in
 * qc-service.ts. Same accounting underneath — both end at
 * applyBillRevisionAdjustment, which moves the receivable, restates amountDue,
 * writes the PaymentAdjustment and recomputes payment status — but the inputs
 * are edited lines rather than a QC verdict.
 *
 * Everything here is pure so the Prisma and Drizzle routes cannot drift on the
 * arithmetic; each does only its own reads and writes.
 */

export class BillRevisionError extends Error {}

export type RevisionInput = {
  productId: string;
  quantity: number;
  unitId: string;
  discount?: number;
  /** Set to charge a rate other than the catalogue one. */
  unitPrice?: number;
};

type ProductLike = {
  id: string;
  name: string;
  wholesalePrice: Decimal | number | string;
  retailPrice: Decimal | number | string;
  taxPercent: Decimal | number | string;
};

type UnitLike = {
  unitId: string;
  factorToBase: Decimal | number | string;
  isBaseUnit: boolean;
  wholesalePrice?: Decimal | number | string | null;
  retailPrice?: Decimal | number | string | null;
};

type PreviousLine = { productId: string; quantity: Decimal | number | string; unitId: string };

export type RevisedLine = {
  productId: string;
  productName: string;
  quantity: Decimal;
  unitId: string;
  unitPrice: Decimal;
  discount: Decimal;
  taxAmount: Decimal;
  lineTotal: Decimal;
  changeType: "KEPT" | "REDUCED" | "INCREASED" | "ADDED" | "REMOVED";
  previousQuantity: Decimal | null;
  /** Signed, in base units: positive means this revision takes MORE stock. */
  baseQtyDelta: Decimal;
  baseQty: Decimal;
};

export function buildRevision(args: {
  items: RevisionInput[];
  sellingMode: "WHOLESALE" | "RETAIL";
  products: Map<string, ProductLike>;
  unitsByProduct: Map<string, UnitLike[]>;
  previousItems: PreviousLine[];
}) {
  const { items, sellingMode, products, unitsByProduct, previousItems } = args;
  if (items.length === 0) throw new BillRevisionError("A bill must keep at least one line — cancel the order instead");

  // Two lines for the same product in the same unit would each look like the
  // whole line when diffing against the previous version, so the stock delta
  // would be computed twice. Merge them the way the billing screen does.
  const seen = new Set<string>();
  for (const it of items) {
    const key = `${it.productId}:${it.unitId}`;
    if (seen.has(key)) throw new BillRevisionError("The same product and unit appears twice — combine them into one line");
    seen.add(key);
  }

  const baseQtyOf = (list: PreviousLine[], productId: string) =>
    list
      .filter((l) => l.productId === productId)
      .reduce((sum, l) => {
        const units = unitsByProduct.get(productId) ?? [];
        return sum.add(toBaseQty(units as never, l.unitId, l.quantity));
      }, new Decimal(0));

  const lines: RevisedLine[] = items.map((item) => {
    const product = products.get(item.productId);
    if (!product) throw new BillRevisionError(`Product ${item.productId} not found or inactive`);
    const units = unitsByProduct.get(item.productId) ?? [];
    assertValidUnit(units as never, item.unitId);

    const unit = units.find((u) => u.unitId === item.unitId);
    const unitPrice = item.unitPrice != null ? new Decimal(item.unitPrice) : resolveUnitPrice(product, sellingMode, unit);
    const quantity = new Decimal(item.quantity);
    const discount = new Decimal(item.discount ?? 0);
    const { taxAmount, lineTotal } = computeLine(product, quantity, unitPrice, discount);

    const prior = previousItems.filter((p) => p.productId === item.productId && p.unitId === item.unitId);
    const previousQuantity = prior.length ? prior.reduce((s, p) => s.add(new Decimal(p.quantity)), new Decimal(0)) : null;
    const changeType = previousQuantity === null
      ? ("ADDED" as const)
      : quantity.eq(previousQuantity)
        ? ("KEPT" as const)
        : quantity.lt(previousQuantity)
          ? ("REDUCED" as const)
          : ("INCREASED" as const);

    const baseQty = toBaseQty(units as never, item.unitId, quantity);
    return { productId: item.productId, productName: product.name, quantity, unitId: item.unitId, unitPrice, discount, taxAmount, lineTotal, changeType, previousQuantity, baseQty, baseQtyDelta: new Decimal(0) };
  });

  // Lines dropped entirely are still part of the version, recorded at zero, so
  // the bill history shows what was removed rather than silently losing it.
  const keptKeys = new Set(lines.map((l) => `${l.productId}:${l.unitId}`));
  for (const prev of previousItems) {
    if (keptKeys.has(`${prev.productId}:${prev.unitId}`)) continue;
    const product = products.get(prev.productId);
    if (!product) continue;
    lines.push({
      productId: prev.productId,
      productName: product.name,
      quantity: new Decimal(0),
      unitId: prev.unitId,
      unitPrice: new Decimal(0),
      discount: new Decimal(0),
      taxAmount: new Decimal(0),
      lineTotal: new Decimal(0),
      changeType: "REMOVED",
      previousQuantity: new Decimal(prev.quantity),
      baseQty: new Decimal(0),
      baseQtyDelta: new Decimal(0),
    });
  }

  // Stock moves per product, not per line: the same product can appear as a
  // peti line and a loose line, and only the net change matters to inventory.
  const productIds = new Set([...lines.map((l) => l.productId), ...previousItems.map((p) => p.productId)]);
  const stockDeltas = new Map<string, Decimal>();
  for (const productId of productIds) {
    const before = baseQtyOf(previousItems, productId);
    const after = lines
      .filter((l) => l.productId === productId)
      .reduce((s, l) => s.add(l.baseQty), new Decimal(0));
    const delta = after.sub(before);
    if (!delta.isZero()) stockDeltas.set(productId, delta);
  }

  const totals = sumBillTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxAmount: l.taxAmount, lineTotal: l.lineTotal })));
  const changed = lines.some((l) => l.changeType !== "KEPT");
  return { lines, totals, stockDeltas, changed };
}

export { UnitError };
