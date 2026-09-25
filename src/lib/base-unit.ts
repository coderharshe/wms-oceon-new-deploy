import { Decimal } from "@prisma/client/runtime/library";

/**
 * Changing which unit a product's stock is counted in.
 *
 * The base unit is the denominator of everything stored for a product: the
 * on-hand and reserved quantities, the min/max levels, the wholesale/retail
 * prices and avgCost (all *per base unit*), and every other unit's
 * factorToBase. So it can't just be re-flagged — switching from PCS to BOX
 * where a BOX is 12 PCS means 240 on hand becomes 20, a Rs 5 piece becomes a
 * Rs 60 box, and a PETI of 60 PCS becomes a PETI of 5 BOX.
 *
 * What is NOT rescaled: InventoryMovement rows (history — they record the
 * numbers as they stood, and rewriting them would falsify the audit trail),
 * and order/bill/QC/purchase lines, which each carry their own unitId and are
 * therefore already independent of the base.
 */

// The scales the columns actually store (prisma/schema.prisma). A rescale that
// doesn't land exactly on these would round stock into or out of existence, so
// it is refused rather than rounded — a manager can't be asked to notice that
// 31201 pieces quietly became 2080.067 boxes.
const QTY_DP = 3; // Inventory quantities, Product.min/maxStock
const FACTOR_DP = 6; // ProductUnit.factorToBase
const PRICE_DP = 2; // Product.wholesale/retailPrice
const COST_DP = 4; // Product.avgCost

export type PlanUnit = { unitId: string; symbol: string; factorToBase: string | number; isBaseUnit: boolean };
export type PlanProduct = {
  wholesalePrice: string | number;
  retailPrice: string | number;
  avgCost: string | number | null;
  minStock: string | number | null;
  maxStock: string | number | null;
};
export type PlanStock = { warehouseId: string; quantityOnHand: string | number; quantityReserved: string | number };

export type BaseUnitPlan = {
  factors: { unitId: string; factorToBase: string; isBaseUnit: boolean }[];
  product: { wholesalePrice: string; retailPrice: string; avgCost: string | null; minStock: string | null; maxStock: string | null };
  stock: { warehouseId: string; quantityOnHand: string; quantityReserved: string }[];
};

/** The rescaled value, or null if it doesn't fit the column exactly. */
function exact(v: Decimal, dp: number): string | null {
  return v.toDecimalPlaces(dp).eq(v) ? v.toFixed(dp) : null;
}

/**
 * Every value that has to change, or a message safe to show the manager
 * verbatim saying why the switch can't be made.
 */
export function planBaseUnitChange(
  units: PlanUnit[],
  product: PlanProduct,
  stock: PlanStock[],
  newUnitId: string
): { error: string } | { plan: BaseUnitPlan } {
  const target = units.find((u) => u.unitId === newUnitId);
  if (!target) return { error: "That unit is not attached to this product." };
  if (target.isBaseUnit) return { error: `${target.symbol} is already the base unit.` };

  // How many old base units one new base unit is worth. Every stored quantity
  // is divided by it, every per-unit price multiplied by it.
  const k = new Decimal(target.factorToBase);
  if (k.lte(0)) return { error: `${target.symbol} has no usable size — set how many base units it is worth first.` };

  const oldBase = units.find((u) => u.isBaseUnit);
  const from = oldBase?.symbol ?? "the base unit";

  const factors: BaseUnitPlan["factors"] = [];
  for (const u of units) {
    const scaled = exact(new Decimal(u.factorToBase).div(k), FACTOR_DP);
    if (scaled === null) {
      return {
        error: `A ${u.symbol} would become ${new Decimal(u.factorToBase).div(k).toDecimalPlaces(6)} ${target.symbol} — not a whole number, so every sale in ${u.symbol} would leak a fraction. The base has to be the smallest unit: detach ${u.symbol} first if the stock is really counted in ${target.symbol}.`,
      };
    }
    factors.push({ unitId: u.unitId, factorToBase: scaled, isBaseUnit: u.unitId === newUnitId });
  }

  const scaledStock: BaseUnitPlan["stock"] = [];
  for (const s of stock) {
    const onHand = exact(new Decimal(s.quantityOnHand).div(k), QTY_DP);
    const reserved = exact(new Decimal(s.quantityReserved).div(k), QTY_DP);
    if (onHand === null || reserved === null) {
      const bad = onHand === null ? s.quantityOnHand : s.quantityReserved;
      return {
        error: `${bad} ${from} in stock doesn't divide into whole ${target.symbol} (${new Decimal(bad).div(k)}). Count the stock into ${target.symbol} first, or pick a unit it divides into exactly.`,
      };
    }
    scaledStock.push({ warehouseId: s.warehouseId, quantityOnHand: onHand, quantityReserved: reserved });
  }

  // Prices are per base unit, so they move the other way: a bigger base unit
  // costs proportionally more.
  const wholesalePrice = exact(new Decimal(product.wholesalePrice).mul(k), PRICE_DP);
  const retailPrice = exact(new Decimal(product.retailPrice).mul(k), PRICE_DP);
  if (wholesalePrice === null || retailPrice === null) {
    return { error: `A ${target.symbol} price would land on a fraction of a paisa. Round the product's price first, then switch.` };
  }
  const avgCost = product.avgCost == null ? null : exact(new Decimal(product.avgCost).mul(k), COST_DP);
  if (product.avgCost != null && avgCost === null) {
    return { error: `The average cost doesn't rescale exactly to ${target.symbol}.` };
  }
  const minStock = product.minStock == null ? null : exact(new Decimal(product.minStock).div(k), QTY_DP);
  const maxStock = product.maxStock == null ? null : exact(new Decimal(product.maxStock).div(k), QTY_DP);
  if ((product.minStock != null && minStock === null) || (product.maxStock != null && maxStock === null)) {
    return { error: `The minimum/maximum stock level doesn't divide into whole ${target.symbol}. Clear or round it first.` };
  }

  return { plan: { factors, product: { wholesalePrice, retailPrice, avgCost, minStock, maxStock }, stock: scaledStock } };
}
