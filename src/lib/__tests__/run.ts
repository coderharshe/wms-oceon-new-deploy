/**
 * Smoke test for the core business logic (unit conversion, pricing, payment
 * adjustment math) — the parts of the PRD that must never be silently wrong.
 * No DB, no framework: plain asserts.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { toBaseQty, fromBaseQty, assertValidUnit } from "../units";
import { buildBillLine, resolveUnitPrice, computeLine, UnpricedProductError } from "../pricing";
import { computePaymentStatus,
  receivableDelta, computeChange, evaluateBillChange } from "../payments";
import { computeExpectedCash } from "../cash";
import { buildDayBook, type SessionRow } from "../daybook";
import { matchedUnitIdFor, barcodesForProduct, findByBarcode } from "../barcode";
import { isUniqueViolation } from "../db-errors";
import { saleUnitPatch } from "../product-units";
import { planBaseUnitChange } from "../base-unit";
import { readError } from "../read-error";
import { billTotals, lineAmount, movingAverageCost, allocateOtherCharges } from "../purchase";
import { nextIndex, firstIndex, carryIndex } from "../dropdown-nav";
import { navIntent } from "../keynav";
import { matchesWordStarts, wordStartPattern } from "../word-search";
import { qcEnabledFromValue } from "../settings";
import { stockLevel, isNegativeStock } from "../stock";
import { buildRevision, BillRevisionError } from "../bill-revision";
import { fmtQty } from "../fmt";
import { evaluate } from "../calc";
import { collectRemovedLines, isActiveLine, catalogueRate } from "../bill-lines";
import { buildInvoiceHtml } from "../invoice";
import { gstLine, gstTotals, hsnSummary, isGstin, gstinChecksumOk, isInterState, panOfGstin, stateCodeOfGstin } from "../gst";
import { rupeesInWords, buildGstInvoiceHtml } from "../gst-invoice";
import { pick, parsePaths, flattenAddress, extractDetails, buildLookupUrl, LookupConfigError } from "../gstin-lookup";
import { buildRegister, inMonth, matchesSearch, toCsv, isStockSettled, isReplayable, GST_ISSUED, GST_DEDUCTED_LATER } from "../gst-register";
import { THEMES, TOKEN_KEYS, DEFAULT_THEME, themeVars, contrast } from "../themes";
import { planMarkUnpaid, MarkUnpaidError } from "../mark-unpaid";
import { searchProducts, rankProducts, mergeLiveResults, paintResults, SEARCH_LIMIT, saveEntry, readEntry, clearEntry, ENTRY_MAX_AGE_MS, ENTRY_KEYS, type CachedProduct } from "../offline-catalog";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  const out = fn();
  // Async checks report failures by rejecting — surface that as a crash rather
  // than a silently "passing" test.
  if (out instanceof Promise) out.catch((err) => { console.error(`not ok - ${name}`); throw err; });
  passed++;
  console.log(`ok - ${name}`);
}

// ── Units ────────────────────────────────────────────────────────────────
const sugarUnits = [
  { unitId: "kg", factorToBase: 1, isBaseUnit: true },
  { unitId: "g", factorToBase: 0.001, isBaseUnit: false },
];
check("500 g converts to 0.5 kg base", () => {
  assert.equal(toBaseQty(sugarUnits, "g", 500).toString(), "0.5");
});
check("base <-> display round-trips", () => {
  const base = toBaseQty(sugarUnits, "g", 250);
  assert.equal(fromBaseQty(sugarUnits, "g", base).toString(), "250");
});

// ── Pricing ─────────────────────────────────────────────────────────────
const product = { wholesalePrice: 90, retailPrice: 100, taxPercent: 5 };
check("wholesale price used in WHOLESALE mode", () => {
  assert.equal(resolveUnitPrice(product, "WHOLESALE").toString(), "90");
});
check("a bigger sale unit costs its factorToBase multiple of the base price", () => {
  // The catalogue import gives 242 products a peti unit, so this is the path
  // that decides what a wholesale customer is actually charged. Without the
  // multiply, a peti of 9 bottles bills as one bottle.
  assert.equal(resolveUnitPrice(product, "WHOLESALE", { factorToBase: 9 }).toString(), "810");
  assert.equal(resolveUnitPrice(product, "RETAIL", { factorToBase: 48 }).toString(), "4800");
  // grams off a kg-based product go the other way
  assert.equal(resolveUnitPrice(product, "WHOLESALE", { factorToBase: 0.001 }).toString(), "0.09");
  // no unit in hand (a QC line added after billing) must not change the price
  assert.equal(resolveUnitPrice(product, "WHOLESALE").toString(), "90");
  // an unpriced product is still refused whatever the unit
  assert.throws(() => resolveUnitPrice({ ...product, wholesalePrice: 0 }, "WHOLESALE", { factorToBase: 9 }), UnpricedProductError);
});
check("a unit carrying its own price wins over the derived one", () => {
  // Rs 680 a peti of 9 is Rs 75.5556 a bottle, which a 2-decimal column can
  // only hold as 75.56 — deriving would bill 680.04. The quoted rate is the
  // one the customer agreed, so it is stored and used as-is.
  const peti = { factorToBase: 9, wholesalePrice: 680, retailPrice: null };
  assert.equal(resolveUnitPrice({ ...product, wholesalePrice: 75.56 }, "WHOLESALE", peti).toString(), "680");
  // no retail price on the unit, so retail still derives from the base
  assert.equal(resolveUnitPrice({ ...product, retailPrice: 75.56 }, "RETAIL", peti).toString(), "680.04");
});
check("retail price used in RETAIL mode, unaffected by later price changes", () => {
  assert.equal(resolveUnitPrice(product, "RETAIL").toString(), "100");
  assert.equal(resolveUnitPrice({ ...product, retailPrice: 999 }, "RETAIL").toString(), "999");
  // the historical order line itself must have captured 100 at sale time —
  // that immutability lives in the DB write path, this only proves the
  // resolver doesn't smuggle in a stale/global mutable price.
});
check("line total includes tax on (qty*price - discount)", () => {
  const { lineTotal, taxAmount } = computeLine(product, 10, 90, 10); // 900-10=890, +5%=44.5
  assert.equal(taxAmount.toString(), "44.5");
  assert.equal(lineTotal.toString(), "934.5");
});

// ── Payments (PRD §15 cases A/B/C, §17 cash change) ────────────────────
check("payment status: unpaid / partial / paid / overpaid", () => {
  assert.equal(computePaymentStatus(1000, 0), "UNPAID");
  assert.equal(computePaymentStatus(1000, 400), "PARTIALLY_PAID");
  assert.equal(computePaymentStatus(1000, 1000), "PAID");
  // Overpayment must not read as a settled bill — it owes the customer money.
  assert.equal(computePaymentStatus(1000, 1200), "REFUND_DUE");
});
check("receivable rises with a bill, falls with payment, never goes negative", () => {
  // Raising a 1000 bill puts 1000 on the customer's account.
  assert.equal(receivableDelta({ due: 0, paid: 0 }, { due: 1000, paid: 0 }).toString(), "1000");
  // A 400 part-payment takes 400 off it — not 1000, and not a negative swing.
  assert.equal(receivableDelta({ due: 1000, paid: 0 }, { due: 1000, paid: 400 }).toString(), "-400");
  // Settling in full clears exactly the remainder.
  assert.equal(receivableDelta({ due: 1000, paid: 400 }, { due: 1000, paid: 1000 }).toString(), "-600");
  // Overpayment floors at zero rather than crediting other bills.
  assert.equal(receivableDelta({ due: 1000, paid: 1000 }, { due: 1000, paid: 1200 }).toString(), "0");
  // Cancelling revises the total to 0 and releases the whole receivable.
  assert.equal(receivableDelta({ due: 1000, paid: 0 }, { due: 0, paid: 0 }).toString(), "-1000");
});
check("cash change = received - due, floored at 0", () => {
  assert.equal(computeChange(1500, 1250).toString(), "250");
  assert.equal(computeChange(1000, 1250).toString(), "0");
});
check("bill revision case A: new total == paid -> settled", () => {
  const r = evaluateBillChange(1000, 1000);
  assert.equal(r.status, "PAID");
});
check("bill revision case B: new total > paid -> additional payment due", () => {
  const r = evaluateBillChange(1200, 1000);
  assert.equal(r.status, "PAYMENT_ADJUSTMENT_REQUIRED");
  assert.equal(r.additionalAmountDue.toString(), "200");
});
check("bill revision case C: new total < paid -> refund due", () => {
  const r = evaluateBillChange(800, 1000);
  assert.equal(r.status, "REFUND_DUE");
  assert.equal(r.refundOrCreditDue.toString(), "200");
});

// ── Cash EOD (PRD §19) ──────────────────────────────────────────────────
check("expected cash = opening + sales + other - refunds - withdrawals", () => {
  const expected = computeExpectedCash(1000, [
    { type: "SALE", amount: 500 },
    { type: "OTHER_RECEIPT", amount: 50 },
    { type: "REFUND", amount: 30 },
    { type: "WITHDRAWAL", amount: 20 },
  ]);
  assert.equal(expected.toString(), "1500"); // 1000+500+50-30-20
});

check("a bank deposit leaves the drawer like a withdrawal", () => {
  assert.equal(computeExpectedCash(100, [{ type: "SALE", amount: 50 }, { type: "BANK_DEPOSIT", amount: 120 }]).toString(), "30");
});

const drawer = (o: Partial<SessionRow>): SessionRow => ({
  id: "s1", day: "2026-09-18", userId: "u1", userName: "Fin", status: "CLOSED", openingCash: "1000", actualCash: null, note: null,
  openedAt: "2026-09-18 03:00:00", closedAt: "2026-09-18 14:00:00", sales: "0", refunds: "0", cashIn: "0", bankDeposits: "0", paidOut: "0", saleCount: 0, ...o,
});
check("day book: what isn't in the drawer is expected in the bank, and the bank is the real check", () => {
  // 5000 billed (all recorded as cash), 3000 counted -> 2000 should have come in by UPI.
  const [day] = buildDayBook({
    since: "2026-09-18",
    sessions: [drawer({ sales: "5000", refunds: "200", actualCash: "3800", saleCount: 12 })],
    upi: [],
    banks: [{ day: "2026-09-18", openingBalance: null, closingBalance: "11800", adjustment: "-50", note: "charges" }],
    prevBank: { closingBalance: "10000" },
  });
  assert.equal(day!.cash.software, "5800"); // 1000 + 5000 - 200
  assert.equal(day!.cash.notInDrawer, "2000");
  assert.equal(day!.bank!.expected, "11950"); // 10000 + 2000 - 50
  assert.equal(day!.bank!.difference, "-150");
  assert.equal(day!.status, "SHORT");
});
check("day book: cash deposited to the bank moves between the two, it isn't counted twice", () => {
  const [day] = buildDayBook({
    since: "2026-09-18",
    sessions: [drawer({ sales: "3000", bankDeposits: "2500", actualCash: "1500" })],
    upi: [],
    banks: [{ day: "2026-09-18", openingBalance: "0", closingBalance: "2500", adjustment: "0", note: null }],
    prevBank: null,
  });
  assert.equal(day!.cash.notInDrawer, "0"); // 1000 + 3000 - 2500 = 1500 counted
  assert.equal(day!.bank!.expected, "2500");
  assert.equal(day!.status, "MATCHED");
});
check("day book: days without a bank entry roll into the next one, days before `since` included", () => {
  const days = buildDayBook({
    since: "2026-09-18",
    sessions: [
      drawer({ id: "a", day: "2026-09-17", sales: "700", actualCash: "1500" }), // 200 not in drawer
      drawer({ id: "b", day: "2026-09-18", openingCash: "1500", sales: "400", actualCash: "1600" }), // 300
    ],
    upi: [{ day: "2026-09-18", amount: "100" }],
    banks: [{ day: "2026-09-18", openingBalance: null, closingBalance: "10600", adjustment: "0", note: null }],
    prevBank: { closingBalance: "10000" },
  });
  assert.equal(days.length, 1);
  assert.equal(days[0]!.bank!.inflow, "600");
  assert.equal(days[0]!.bank!.daysCovered, 2);
  assert.equal(days[0]!.status, "MATCHED");
});
check("day book: two counts in a day — opening is the first, counted is the last", () => {
  const [day] = buildDayBook({
    since: "2026-09-18",
    sessions: [
      drawer({ id: "a", openedAt: "2026-09-18 03:00:00", sales: "500", actualCash: "1400" }),
      drawer({ id: "b", openedAt: "2026-09-18 10:00:00", openingCash: "1400", sales: "300", actualCash: "1650" }),
    ],
    upi: [],
    banks: [],
    prevBank: null,
  });
  assert.equal(day!.cash.opening, "1000");
  assert.equal(day!.cash.software, "1800");
  assert.equal(day!.cash.counted, "1650");
  assert.equal(day!.cash.notInDrawer, "150");
  assert.equal(day!.status, "WAITING_BANK");
});
check("day book: an uncounted or open drawer holds the day's status", () => {
  const [a] = buildDayBook({ since: "2026-09-18", sessions: [drawer({})], upi: [], banks: [], prevBank: null });
  assert.equal(a!.status, "NOT_COUNTED");
  assert.equal(a!.cash.counted, null);
  const [b] = buildDayBook({ since: "2026-09-18", sessions: [drawer({ status: "OPEN", closedAt: null })], upi: [], banks: [], prevBank: null });
  assert.equal(b!.status, "OPEN");
});
check("day book: the first bank entry needs an opening balance", () => {
  const [day] = buildDayBook({
    since: "2026-09-18", sessions: [], upi: [],
    banks: [{ day: "2026-09-18", openingBalance: null, closingBalance: "500", adjustment: "0", note: null }],
    prevBank: null,
  });
  assert.equal(day!.status, "NO_OPENING");
});

// ── Barcodes ────────────────────────────────────────────────────────────
// A product sold loose and by the carton: two codes, two different meanings.
const riceUnits = [
  { unitId: "kg", barcode: "8901000001" },
  { unitId: "box24", barcode: "WMS-20260824-0007" },
  { unitId: "g", barcode: null },
];
check("scanning a unit's barcode resolves to that unit, not the base unit", () => {
  assert.equal(matchedUnitIdFor(riceUnits, "WMS-20260824-0007"), "box24");
  assert.equal(matchedUnitIdFor(riceUnits, "8901000001"), "kg");
});
check("a name/SKU search matches no unit, so the caller keeps its base-unit default", () => {
  assert.equal(matchedUnitIdFor(riceUnits, "Rice"), null);
  assert.equal(matchedUnitIdFor(riceUnits, ""), null);
});
check("barcode match is exact — a partial code must never resolve", () => {
  assert.equal(matchedUnitIdFor(riceUnits, "890100000"), null);
  assert.equal(matchedUnitIdFor(riceUnits, "89010000012"), null);
});
check("a product's codes = its own plus every unit's, deduped, nulls dropped", () => {
  assert.deepEqual(barcodesForProduct({ barcode: "PROD-1", saleUnits: riceUnits }), [
    "PROD-1",
    "8901000001",
    "WMS-20260824-0007",
  ]);
  // Product-level code repeated on its base unit shouldn't appear twice.
  assert.deepEqual(barcodesForProduct({ barcode: "SAME", saleUnits: [{ unitId: "kg", barcode: "SAME" }] }), ["SAME"]);
  assert.deepEqual(barcodesForProduct({ barcode: null, saleUnits: [] }), []);
});
check("QC scan matches only lines on this order", () => {
  const lines = [
    { productId: "p1", barcodes: ["8901000001", "WMS-20260824-0007"] },
    { productId: "p2", barcodes: ["8902222222"] },
  ];
  assert.equal(findByBarcode(lines, "WMS-20260824-0007")?.productId, "p1");
  assert.equal(findByBarcode(lines, "8902222222")?.productId, "p2");
  // A real product, but not on this order — must not resolve.
  assert.equal(findByBarcode(lines, "8909999999"), null);
  assert.equal(findByBarcode(lines, "  "), null);
});
check("a scanner's trailing whitespace/newline still matches", () => {
  const lines = [{ productId: "p1", barcodes: ["8901000001"] }];
  assert.equal(findByBarcode(lines, " 8901000001\n")?.productId, "p1");
});

// ── Unique-violation detection (barcode collisions -> 409, not 500) ──────
check("unique violations are recognised from both Prisma and node-postgres", () => {
  assert.equal(isUniqueViolation({ code: "P2002", meta: { target: ["barcode"] } }, "barcode"), true);
  assert.equal(isUniqueViolation({ code: "23505", constraint: "ProductUnit_barcode_key" }, "barcode"), true);
  // Right error type, wrong column — the caller must not report it as a barcode clash.
  assert.equal(isUniqueViolation({ code: "23505", constraint: "Product_sku_key" }, "barcode"), false);
  // Not a unique violation at all.
  assert.equal(isUniqueViolation({ code: "23503" }, "barcode"), false);
  assert.equal(isUniqueViolation(new Error("boom"), "barcode"), false);
  assert.equal(isUniqueViolation(null), false);
});

// -- Keyboard field navigation on the billing screen ---------------------
check("Enter moves forward, Shift+Enter back, from an ordinary field", () => {
  assert.equal(navIntent("Enter", false, "INPUT", "text"), "next");
  assert.equal(navIntent("Enter", true, "INPUT", "text"), "prev");
  // Shift+Enter is the ONLY way back out of a qty box, so it must work there.
  assert.equal(navIntent("Enter", true, "INPUT", "number"), "prev");
  assert.equal(navIntent("Enter", true, "SELECT", null), "prev");
});
check("Enter is left alone where it already means something", () => {
  assert.equal(navIntent("Enter", false, "BUTTON", null), null);
  assert.equal(navIntent("Enter", false, "TEXTAREA", null), null);
});
check("arrows move fields only in text boxes, never stealing the qty spinner", () => {
  assert.equal(navIntent("ArrowDown", false, "INPUT", "text"), "next");
  assert.equal(navIntent("ArrowUp", false, "INPUT", "tel"), "prev");
  // The two that would break billing if they ever returned an intent:
  // Up/Down must keep bumping the quantity and changing the unit.
  assert.equal(navIntent("ArrowDown", false, "INPUT", "number"), null);
  assert.equal(navIntent("ArrowUp", false, "INPUT", "number"), null);
  assert.equal(navIntent("ArrowDown", false, "SELECT", null), null);
  assert.equal(navIntent("ArrowUp", false, "TEXTAREA", null), null);
});
check("other keys never move focus", () => {
  assert.equal(navIntent("a", false, "INPUT", "text"), null);
  assert.equal(navIntent("Escape", false, "INPUT", "text"), null);
  assert.equal(navIntent("Tab", false, "INPUT", "text"), null);
});

// -- Purchase bills: totals + moving-average cost ------------------------
check("bill totals are computed from lines, never trusted from the client", () => {
  const lines = [
    { quantity: 10, rate: 45.5 },
    { quantity: 2.5, rate: 100 },
  ];
  assert.equal(lineAmount(lines[0]!).toString(), "455");
  const t = billTotals(lines, 36.5, 200);
  assert.equal(t.subtotal.toString(), "705");
  assert.equal(t.total.toString(), "941.5");
  // No GST / no freight is the common case and must not turn into NaN.
  assert.equal(billTotals(lines).total.toString(), "705");
});
check("moving average weights the existing stock against the new receipt", () => {
  // 100 base units on hand at 10/unit, receive 100 more at 20/unit -> 15.
  assert.equal(movingAverageCost({ onHandBefore: 100, previousAvgCost: 10, receivedBaseQty: 100, lineAmount: 2000 }).toString(), "15");
  // First-ever purchase (no prior cost) takes the receipt's own rate.
  assert.equal(movingAverageCost({ onHandBefore: 0, previousAvgCost: null, receivedBaseQty: 50, lineAmount: 600 }).toString(), "12");
  // Stock on hand but no cost history yet - same, no divide-by-a-null.
  assert.equal(movingAverageCost({ onHandBefore: 80, previousAvgCost: null, receivedBaseQty: 20, lineAmount: 400 }).toString(), "20");
  // Rate is per *base* unit: 5 boxes of 24 for 1200 over 120 base units = 10.
  assert.equal(movingAverageCost({ onHandBefore: 0, previousAvgCost: null, receivedBaseQty: 120, lineAmount: 1200 }).toString(), "10");
});

check("freight is split pro-rata and the remainder never goes missing", () => {
  const lines = [{ quantity: 3, rate: 100 }, { quantity: 1, rate: 1 }, { quantity: 1, rate: 1 }];
  const shares = allocateOtherCharges(lines, 100);
  // Shares must add back up to exactly what was charged — paise can move
  // between lines, but none may be invented or lost.
  assert.equal(shares.reduce((a, b) => a.add(b)).toString(), "100");
  assert.equal(shares.length, 3);
});

// ── Search dropdown arrow-key navigation ────────────────────────
const blockedRows = (set: number[]) => (i: number) => set.includes(i);
check("Down moves to the next row and wraps at the end", () => {
  assert.equal(nextIndex(3, 0, 1), 1);
  assert.equal(nextIndex(3, 2, 1), 0);
});
check("Up moves back and wraps at the start", () => {
  assert.equal(nextIndex(3, 1, -1), 0);
  assert.equal(nextIndex(3, 0, -1), 2);
});
check("out-of-stock rows are skipped in both directions", () => {
  assert.equal(nextIndex(4, 0, 1, blockedRows([1, 2])), 3);
  assert.equal(nextIndex(4, 3, -1, blockedRows([1, 2])), 0);
});
check("skipping still wraps past blocked rows at the boundary", () => {
  assert.equal(nextIndex(3, 1, 1, blockedRows([2])), 0);
});
check("a single selectable row stays put rather than looping forever", () => {
  assert.equal(nextIndex(3, 1, 1, blockedRows([0, 2])), 1);
});
check("an all-blocked list highlights nothing", () => {
  assert.equal(firstIndex(2, blockedRows([0, 1])), -1);
  assert.equal(nextIndex(0, -1, 1), -1);
});
check("first selectable row skips leading out-of-stock products", () => {
  assert.equal(firstIndex(3, blockedRows([0])), 1);
  assert.equal(firstIndex(3), 0);
});
check("the highlight stays on its product when the live list replaces the cached one", () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id }));
  assert.equal(carryIndex(rows("a", "b", "c"), 2, rows("c", "a", "b")), 0);
  assert.equal(carryIndex(rows("a", "b"), 1, rows("x", "y")), -1); // the record is gone: nothing highlighted, never row 0
  assert.equal(carryIndex(rows("a"), 1, rows("a")), 0); // was on "add new product", past the rows
  assert.equal(carryIndex(rows("a"), 0, []), -1);
});

// ── Unpriced products must never bill ──────────────────────────
const unpriced = { name: "SUGAR 1KG", wholesalePrice: 0, retailPrice: 0, taxPercent: 0 };
check("a 0.00 price is refused, not treated as free", () => {
  assert.throws(() => resolveUnitPrice(unpriced, "RETAIL"), UnpricedProductError);
  assert.throws(() => resolveUnitPrice(unpriced, "WHOLESALE"), UnpricedProductError);
});
check("the refusal names the product and the mode", () => {
  try {
    resolveUnitPrice(unpriced, "WHOLESALE");
    assert.fail("should have thrown");
  } catch (e) {
    assert.match((e as Error).message, /SUGAR 1KG/);
    assert.match((e as Error).message, /wholesale/);
  }
});
check("a product priced in one mode only still bills in the priced mode", () => {
  const retailOnly = { name: "X", wholesalePrice: 0, retailPrice: 50, taxPercent: 0 };
  assert.equal(resolveUnitPrice(retailOnly, "RETAIL").toString(), "50");
  assert.throws(() => resolveUnitPrice(retailOnly, "WHOLESALE"), UnpricedProductError);
});
check("negative prices are refused too", () => {
  assert.throws(() => resolveUnitPrice({ wholesalePrice: -5, retailPrice: -5, taxPercent: 0 }, "RETAIL"), UnpricedProductError);
});


// ── QC on/off ────────────────────────────────────────────────────────────
check("QC is on unless explicitly set to false", () => {
  assert.equal(qcEnabledFromValue("false"), false);
  assert.equal(qcEnabledFromValue("true"), true);
  assert.equal(qcEnabledFromValue(""), true); // never set — QC must not be skipped by default
});

// ── Negative stock ───────────────────────────────────────────────────────
// ── Billing never refuses ────────────────────────────────────────────────
// The counter cannot stop for a data problem: every one of these used to
// throw and take the whole bill down with it. They must now bill and report.
const billable = { id: "p1", name: "Parle-G", baseUnitId: "pc", wholesalePrice: 90, retailPrice: 100, taxPercent: 0 };
const billableUnits = [
  { unitId: "pc", isBaseUnit: true, factorToBase: 1 },
  { unitId: "peti", isBaseUnit: false, factorToBase: 48 },
];
check("a clean line bills with nothing to report", () => {
  const issues: string[] = [];
  const line = buildBillLine(billable, billableUnits, { unitId: "peti", quantity: 2, discount: 0 }, "WHOLESALE", issues);
  assert.deepEqual(issues, []);
  assert.equal(line.unitPrice.toString(), "4320"); // 90 x 48
  assert.equal(line.baseQty.toString(), "96");
});
check("a unit that is not set up falls back to the base unit and is reported", () => {
  const issues: string[] = [];
  const line = buildBillLine(billable, billableUnits, { unitId: "gone", quantity: 3, discount: 0 }, "WHOLESALE", issues);
  assert.equal(line.unitId, "pc");
  assert.equal(line.baseQty.toString(), "3");
  assert.equal(issues.length, 1);
});
check("an unpriced product bills at zero and is reported", () => {
  const issues: string[] = [];
  const line = buildBillLine({ ...billable, wholesalePrice: 0 }, billableUnits, { unitId: "pc", quantity: 1, discount: 0 }, "WHOLESALE", issues);
  assert.equal(line.lineTotal.toString(), "0");
  assert.equal(issues.length, 1);
});
check("a product with no sale units at all still bills", () => {
  const issues: string[] = [];
  const line = buildBillLine(billable, [], { unitId: "pc", quantity: 5, discount: 0 }, "WHOLESALE", issues);
  assert.equal(line.unitId, "pc"); // the product's own base unit
  assert.equal(line.baseQty.toString(), "5");
  assert.equal(issues.length, 1);
});
check("a unit the product no longer lists converts 1:1 instead of throwing", () => {
  assert.equal(toBaseQty(sugarUnits, "gone", 7).toString(), "7");
});

// ── The basket that survives a reload ────────────────────────────────────
// Node has no localStorage; the store only ever touches these three methods.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
check("a basket saved mid-bill comes back after a reload", () => {
  store.clear();
  saveEntry(ENTRY_KEYS.newOrder, { notes: "half typed", lines: [1, 2, 3] });
  assert.equal(readEntry<{ notes: string }>(ENTRY_KEYS.newOrder)?.notes, "half typed");
});
check("yesterday's abandoned basket is dropped, not offered to today's customer", () => {
  store.clear();
  saveEntry(ENTRY_KEYS.newOrder, { notes: "old" });
  assert.equal(readEntry(ENTRY_KEYS.newOrder, Date.now() + ENTRY_MAX_AGE_MS + 1), null);
  assert.equal(store.size, 0); // and cleared out, so it can't come back later
});
check("a half-written basket reads as no basket", () => {
  store.clear();
  store.set("finance-new-order", "{not json");
  assert.equal(readEntry(ENTRY_KEYS.newOrder), null);
});
check("a billed basket is gone", () => {
  store.clear();
  saveEntry(ENTRY_KEYS.newOrder, { notes: "done" });
  clearEntry(ENTRY_KEYS.newOrder);
  assert.equal(readEntry(ENTRY_KEYS.newOrder), null);
});

// ── Low stock ────────────────────────────────────────────────────────────
check("stock at or below the minimum is low, just above it is near", () => {
  assert.equal(stockLevel(4, 10), "low");
  assert.equal(stockLevel(10, 10), "low"); // at the minimum counts as low, not near
  assert.equal(stockLevel(11, 10), "near");
  assert.equal(stockLevel(12, 10), "near"); // exactly on the 20% band edge
  assert.equal(stockLevel(13, 10), "ok");
  assert.equal(stockLevel(0, null), "ok"); // no minimum set = never warned about
});

// ── Bill revision ────────────────────────────────────────────────────────
// The stock delta is the dangerous half: get its sign wrong and revising a
// paid bill silently creates or destroys inventory.
const revProducts = new Map([
  ["dew", { id: "dew", name: "Dew 2L", wholesalePrice: 75.56, retailPrice: 80, taxPercent: 0 }],
  ["lays", { id: "lays", name: "Lays 10rs", wholesalePrice: 9, retailPrice: 10, taxPercent: 0 }],
]);
const revUnits = new Map([
  ["dew", [
    { unitId: "pc", factorToBase: 1, isBaseUnit: true },
    { unitId: "peti", factorToBase: 9, isBaseUnit: false, wholesalePrice: 680, retailPrice: null },
  ]],
  ["lays", [{ unitId: "pc", factorToBase: 1, isBaseUnit: true }]],
]);
const revArgs = (items: Parameters<typeof buildRevision>[0]["items"], previousItems: { productId: string; quantity: number; unitId: string }[]) =>
  ({ items, sellingMode: "WHOLESALE" as const, products: revProducts as never, unitsByProduct: revUnits as never, previousItems });

check("reducing a line returns stock and drops the total", () => {
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 2, unitId: "peti" }], [{ productId: "dew", quantity: 3, unitId: "peti" }]));
  assert.equal(r.totals.total.toString(), "1360");          // 2 peti at the quoted 680
  assert.equal(r.lines[0]!.changeType, "REDUCED");
  // 2 peti is 18 bottles vs 27 before: 9 base units come back
  assert.equal(r.stockDeltas.get("dew")!.toString(), "-9");
});

check("increasing a line takes more stock", () => {
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 5, unitId: "peti" }], [{ productId: "dew", quantity: 3, unitId: "peti" }]));
  assert.equal(r.lines[0]!.changeType, "INCREASED");
  assert.equal(r.stockDeltas.get("dew")!.toString(), "18");
});

check("a dropped line is recorded as REMOVED at zero, and its stock returns", () => {
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 1, unitId: "peti" }], [
    { productId: "dew", quantity: 1, unitId: "peti" },
    { productId: "lays", quantity: 4, unitId: "pc" },
  ]));
  const removed = r.lines.find((l) => l.productId === "lays")!;
  assert.equal(removed.changeType, "REMOVED");
  assert.equal(removed.quantity.toString(), "0");
  assert.equal(removed.previousQuantity!.toString(), "4");
  assert.equal(r.stockDeltas.get("lays")!.toString(), "-4");
  assert.equal(r.stockDeltas.has("dew"), false); // unchanged line moves no stock
});

check("a line added during revision is ADDED and takes stock", () => {
  const r = buildRevision(revArgs([
    { productId: "dew", quantity: 1, unitId: "peti" },
    { productId: "lays", quantity: 6, unitId: "pc" },
  ], [{ productId: "dew", quantity: 1, unitId: "peti" }]));
  assert.equal(r.lines.find((l) => l.productId === "lays")!.changeType, "ADDED");
  assert.equal(r.stockDeltas.get("lays")!.toString(), "6");
});

check("mixing peti and loose lines nets to one stock delta", () => {
  // 1 peti + 3 loose = 12 bottles, against 9 before -> 3 more leave the shelf
  const r = buildRevision(revArgs([
    { productId: "dew", quantity: 1, unitId: "peti" },
    { productId: "dew", quantity: 3, unitId: "pc" },
  ], [{ productId: "dew", quantity: 1, unitId: "peti" }]));
  assert.equal(r.stockDeltas.get("dew")!.toString(), "3");
});

check("re-billing a line in another unit nets no stock when the base qty matches", () => {
  // 1 peti out, 9 loose in. Same 9 bottles, so the shelf must not move -- the
  // diff is per product in base units, not per line, which is the only reason
  // a remove-and-add of the same goods comes out flat.
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 9, unitId: "pc" }], [{ productId: "dew", quantity: 1, unitId: "peti" }]));
  assert.equal(r.stockDeltas.has("dew"), false);
  assert.equal(r.lines.find((l) => l.unitId === "pc")!.changeType, "ADDED");
  assert.equal(r.lines.find((l) => l.unitId === "peti")!.changeType, "REMOVED");
});

check("a unit switch reprices from the catalogue instead of carrying the old rate", () => {
  // The peti rate is 680. Carrying it onto a loose line would bill one bottle
  // at 680; the catalogue says 75.56, which is what a blank rate must resolve to.
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 9, unitId: "pc" }], [{ productId: "dew", quantity: 1, unitId: "peti" }]));
  assert.equal(r.lines.find((l) => l.unitId === "pc")!.unitPrice.toString(), "75.56");
});

check("an overridden rate is used instead of the catalogue one", () => {
  const r = buildRevision(revArgs([{ productId: "dew", quantity: 1, unitId: "peti", unitPrice: 650 }], [{ productId: "dew", quantity: 1, unitId: "peti" }]));
  assert.equal(r.totals.total.toString(), "650");
});

check("an empty bill and a duplicated line are both refused", () => {
  assert.throws(() => buildRevision(revArgs([], [])), BillRevisionError);
  assert.throws(
    () => buildRevision(revArgs([
      { productId: "dew", quantity: 1, unitId: "peti" },
      { productId: "dew", quantity: 2, unitId: "peti" },
    ], [])),
    BillRevisionError
  );
});


check("stock below zero is negative, and so is over-reserved stock", () => {
  assert.equal(isNegativeStock(-5, -5), true);
  // on hand still positive, but more is reserved than is on the shelf
  assert.equal(isNegativeStock(2, -3), true);
  assert.equal(isNegativeStock(0, 0), false);
  assert.equal(isNegativeStock(10, 4), false);
});

check("the bill prints as one continuous 80mm thermal page", () => {
  const html = buildInvoiceHtml({
    businessName: "Store", billNumber: "INV-1", orderNumber: "ORD-1", date: "2026-09-05", time: "10:00",
    customerName: "Binde Kasan", customerMobile: null, sellingMode: "RETAIL",
    items: [{ name: "Moong Chilka", quantity: "3", unit: "Bag", unitPrice: "3180", lineTotal: "9540" }],
    subtotal: "9540", discountTotal: "0", taxTotal: "0", total: "9540",
  });
  assert.match(html, /@page \{ size: 80mm auto; margin: 0; \}/);
  assert.match(html, /@media print \{/);
  // The counter could not read 12px across a till. Every size is a rem off this
  // one root, so shrinking it here silently shrinks the whole bill again.
  assert.match(html, /html \{ font-size: 14px; \}/);
  assert.match(html, /line-height: 1\.5/);
  // Fixed column widths are what pushed the table off the 80mm roll once the
  // font grew; these three shrink to their own text instead.
  assert.match(html, /td\.qty \{ width: 1%/);
  assert.match(html, /td\.amt \{ width: 1%/);
  assert.match(html, /td\.idx \{ width: 1%/);
});

check("the note typed on the bill is printed on it, escaped", () => {
  const bill = (notes?: string | null) =>
    buildInvoiceHtml({
      businessName: "Store", billNumber: "INV-1", orderNumber: "ORD-1", date: "2026-09-05", time: "10:00",
      customerName: "Binde Kasan", customerMobile: null, sellingMode: "RETAIL", notes,
      items: [{ name: "Moong Chilka", quantity: "3", unit: "Bag", unitPrice: "3180", lineTotal: "9540" }],
      subtotal: "9540", discountTotal: "0", taxTotal: "0", total: "9540",
    });
  assert.match(bill("Deliver Monday"), /Note:<\/strong> Deliver Monday/);
  assert.ok(!bill(null).includes("Note:"));
  assert.ok(!bill("   ").includes("Note:"));
  assert.ok(!bill("<script>x</script>").includes("<script>"));
});


// ── Product search (billing screen) ──────────────────────────────────────
// A cashier who types a common syllable must not be shown a silently
// truncated shelf, and the live result must never delete a list they can
// already see. Both were real bugs: 25 rows against 64 matches, and an
// empty live response blanking the dropdown mid-keystroke.
const catalogue: CachedProduct[] = Array.from({ length: 120 }, (_, i) => ({
  id: `p${i}`,
  sku: `AK-GOLD-RICE-${i}`,
  name: `AK Gold Rice ${i}`,
  barcode: i === 0 ? "8901234567890" : null,
  wholesalePrice: "10", retailPrice: "12", taxPercent: "0",
  baseUnit: { id: "u1", symbol: "kg" },
  saleUnits: [],
}));

check("a partial SKU matches, not just the exact code", () => {
  assert.equal(searchProducts(catalogue, "gold-rice-119").length, 1);
  assert.equal(searchProducts(catalogue, "AK-GOLD").length, SEARCH_LIMIT);
});

check("search returns a full page, not the old 25", () => {
  assert.equal(searchProducts(catalogue, "rice").length, 50);
  assert.equal(SEARCH_LIMIT, 50);
});

check("a barcode still matches exactly", () => {
  assert.deepEqual(searchProducts(catalogue, "8901234567890").map((p) => p.id), ["p0"]);
});

check("an empty live result keeps the cached list standing", () => {
  const cached = searchProducts(catalogue, "rice");
  assert.equal(mergeLiveResults(cached, []).length, cached.length);
});

check("rows on screen hold their places; stock lands on them, extras go after", () => {
  const [a, b, c, d] = catalogue;
  const shown = [{ ...a!, available: null as number | null }, { ...b!, available: null as number | null }];
  const live = [{ ...d!, available: 3 }, { ...c!, available: 9 }, { ...b!, available: 7 }]; // server order, missing `a` entirely
  const merged = mergeLiveResults(shown, live);
  assert.deepEqual(merged.map((p) => p.id), [a!.id, b!.id, d!.id, c!.id]);
  assert.deepEqual(merged.map((p) => p.available), [null, 7, 3, 9]); // `a` unknown, not dropped
});

check("with nothing on screen yet, the live list is what shows", () => {
  assert.deepEqual(mergeLiveResults([], []), []);
  assert.deepEqual(mergeLiveResults([], [catalogue[3]!]), [catalogue[3]!]);
});

check("the product order ignores the order rows arrived in", () => {
  const p = (id: string, name: string) => ({ ...catalogue[0]!, id, name, sku: id, barcode: null });
  const rows = [p("9", "Coke 250ml"), p("2", "COKE 1L"), p("5", "Coke 250ml"), p("1", "Diet Coke"), p("3", "coke 1l")];
  const order = (xs: typeof rows) => rankProducts(xs, "coke").map((x) => x.id);
  assert.deepEqual(order(rows), order([...rows].reverse()));
  assert.deepEqual(order(rows).slice(-1), ["1"]); // contains-only ranks last
  assert.deepEqual(order(rows).slice(2, 4), ["5", "9"]); // identical names settle by id
});

check("the row under the cashier's finger never moves, whatever the server sends", () => {
  // The counter sequence for "coke", to the millisecond:
  const p = (id: string, name: string, available: number | null = null) => ({ ...catalogue[0]!, id, name, sku: id, barcode: null, available });
  const cache = [p("1l", "Coke 1L"), p("250", "Coke 250ml"), p("can", "Coke Can 2L")];
  // 0ms — the local catalogue paints. This is what the cashier reads.
  let painted = paintResults<ReturnType<typeof p>>({ q: "", rows: [] }, "coke", rankProducts(cache, "coke"), true);
  const onScreen = painted.rows.map((r) => r.id);
  assert.deepEqual(onScreen, ["1l", "250", "can"]);
  // 150ms — the server answers in its own collation, drops one the cache had
  // (its 50-row cap is chosen in Postgres order) and adds one the cache lacked.
  painted = paintResults(painted, "coke", rankProducts([p("250", "Coke 250ml", 12), p("new", "Coke Zero", 4), p("can", "Coke Can 2L", 7)], "coke"));
  assert.deepEqual(painted.rows.map((r) => r.id), [...onScreen, "new"]); // same rows, same order, extra last
  assert.deepEqual(painted.rows.map((r) => r.available), [null, 12, 7, 4]); // stock landed on them
  // 900ms — the daily catalogue refresh finishes and the cache repaints.
  assert.equal(paintResults(painted, "coke", rankProducts(cache, "coke"), true), painted); // untouched, stock intact
  // Enter, at any point above, adds the row that was read at 0ms.
  assert.equal(painted.rows[0]!.name, "Coke 1L");
  // A keystroke is the one thing that may rebuild the list.
  assert.deepEqual(paintResults(painted, "coke 2", rankProducts([p("250", "Coke 250ml", 12)], "coke 2"), true).rows.map((r) => r.id), ["250"]);
});

check("each typed part starts a word, in order, on different words", () => {
  assert.equal(matchesWordStarts("Coke Can 2L", "c c 2"), true);
  assert.equal(matchesWordStarts("Coke-Can (2L)", "c c 2"), true); // punctuation separates words
  assert.equal(matchesWordStarts("Coke Can 2L", "cok can 2l"), true);
  assert.equal(matchesWordStarts("Coke 2L", "c c 2"), false); // only one c-word
  assert.equal(matchesWordStarts("2L Coke Can", "c c 2"), false); // wrong order
  assert.equal(matchesWordStarts("Bisc Can", "c c"), false); // "c" inside a word is not a word start
  assert.equal(matchesWordStarts("Coke Can 2L", "coke"), false); // one part is left to starts-with / contains
  assert.equal(wordStartPattern("coke"), null);
});

check("the browser walk and the Postgres regex agree", () => {
  const names = ["Coke Can 2L", "Coke 2L", "2L Coke Can", "Coke-Can (2L)", "Coca Cola 2.5L", "cc 2", "Amul Choco Chip 200g", "a.b c"];
  const queries = ["c c 2", "c 2", "co ca 2.5", "2 c", "c c", "a b c", "choc chip 2", "c.c", "cc 2", "(2l"];
  for (const n of names)
    for (const q of queries)
      assert.equal(matchesWordStarts(n, q), !!wordStartPattern(q) && new RegExp(wordStartPattern(q)!, "i").test(n), `${n} / ${q}`);
});

check("a long run of one-letter parts stays fast", () => {
  const t = Date.now();
  for (let i = 0; i < 2000; i++) matchesWordStarts("a".repeat(30) + " aaaa aaaa aaaa aaaa aaaa aaaa aaaa", "a a a a a a a a a b");
  assert.ok(Date.now() - t < 500);
});

check("word-start matches rank between starts-with and contains", () => {
  const p = (id: string, name: string) => ({ ...catalogue[0]!, id, name, sku: id, barcode: null });
  const shelf = [p("1", "Diet Coke Can 2L"), p("2", "Coke Can 2L"), p("3", "C C 2 Special"), p("4", "Coke 2L")];
  assert.deepEqual(searchProducts(shelf, "c c 2").map((x) => x.name), ["C C 2 Special", "Coke Can 2L", "Diet Coke Can 2L"]);
});

check("names starting with the query come before names that merely contain it", () => {
  const p = (id: string, name: string) => ({ ...catalogue[0]!, id, name, sku: id, barcode: null });
  const shelf = [p("1", "Amul Chocolate"), p("2", "Coke 300ml"), p("3", "Black Coffee"), p("4", "Coca Cola")];
  assert.deepEqual(searchProducts(shelf, "c").map((x) => x.name), ["Coca Cola", "Coke 300ml", "Amul Chocolate", "Black Coffee"]);
});

// ── Removed lines on screen and on paper ─────────────────────────────────
// A revision writes dropped lines into the new version at quantity 0 so the
// history keeps them. Every screen and the printed bill must then leave them
// out, or the customer gets a Rs 0.00 ghost row for goods they never got.
const v = (versionNumber: number, items: { productId: string; unitId: string; changeType: string; quantity: number; previousQuantity?: number }[]) => ({ versionNumber, items });

check("a removed line is not an active line", () => {
  assert.equal(isActiveLine({ productId: "a", unitId: "pc", changeType: "REMOVED", quantity: 0 }), false);
  assert.equal(isActiveLine({ productId: "a", unitId: "pc", changeType: "KEPT", quantity: 2 }), true);
  // Quantity alone is enough -- older rows predate changeType being written.
  assert.equal(isActiveLine({ productId: "a", unitId: "pc", quantity: 0 }), false);
});

check("removals are collected across every version, newest first", () => {
  const removed = collectRemovedLines([
    v(1, [{ productId: "dew", unitId: "peti", changeType: "KEPT", quantity: 1 }]),
    v(2, [{ productId: "lays", unitId: "pc", changeType: "REMOVED", quantity: 0, previousQuantity: 4 }]),
    v(3, [{ productId: "maggi", unitId: "pc", changeType: "REMOVED", quantity: 0, previousQuantity: 2 }]),
  ], 3);
  assert.deepEqual(removed.map((r) => [r.item.productId, r.versionNumber]), [["maggi", 3], ["lays", 2]]);
});

check("a product removed then added back is not listed as removed", () => {
  const removed = collectRemovedLines([
    v(2, [{ productId: "lays", unitId: "pc", changeType: "REMOVED", quantity: 0, previousQuantity: 4 }]),
    v(3, [{ productId: "lays", unitId: "pc", changeType: "ADDED", quantity: 6 }]),
  ], 3);
  assert.deepEqual(removed, []);
});

check("removed, re-added, removed again is reported once at the later version", () => {
  const removed = collectRemovedLines([
    v(2, [{ productId: "lays", unitId: "pc", changeType: "REMOVED", quantity: 0, previousQuantity: 4 }]),
    v(3, [{ productId: "lays", unitId: "pc", changeType: "ADDED", quantity: 6 }]),
    v(4, [{ productId: "lays", unitId: "pc", changeType: "REMOVED", quantity: 0, previousQuantity: 6 }]),
  ], 4);
  assert.equal(removed.length, 1);
  assert.equal(removed[0]!.versionNumber, 4);
});

check("the same product removed in one unit but still billed in another stays listed", () => {
  // Dropping the peti line while keeping loose bottles is a real removal.
  const removed = collectRemovedLines([
    v(2, [
      { productId: "dew", unitId: "peti", changeType: "REMOVED", quantity: 0, previousQuantity: 1 },
      { productId: "dew", unitId: "pc", changeType: "ADDED", quantity: 9 },
    ]),
  ], 2);
  assert.deepEqual(removed.map((r) => r.item.unitId), ["peti"]);
});


// ── What the modify-bill editor shows as a price ─────────────────────────
// catalogueRate is the screen's copy of resolveUnitPrice. Adding a product to
// a bill left the Rate box empty until the server priced it on save, so nobody
// could see what the line would cost. These pin the two to the same answers --
// a drift between them shows finance one price and bills another.
const priced = {
  id: "dew",
  name: "Dew 2L",
  wholesalePrice: "75.56",
  retailPrice: "80",
  saleUnits: [
    { unitId: "pc", factorToBase: "1", isBaseUnit: true, unit: { id: "pc", symbol: "pc" } },
    { unitId: "peti", factorToBase: "9", isBaseUnit: false, wholesalePrice: "680", retailPrice: null, unit: { id: "peti", symbol: "peti" } },
  ],
};

check("a unit with its own quoted rate uses it, not the base price times factor", () => {
  // 680 a peti is not recoverable from a 2-decimal per-bottle price (75.56 x 9
  // = 680.04), which is exactly why a unit may carry its own.
  assert.equal(catalogueRate(priced, "peti", "WHOLESALE"), 680);
  assert.equal(resolveUnitPrice(priced as never, "WHOLESALE", priced.saleUnits[1] as never).toString(), "680");
});

check("a unit with no own rate scales the base price by its factor", () => {
  // Retail has no peti price, so it falls back to 80 x 9.
  assert.equal(catalogueRate(priced, "peti", "RETAIL"), 720);
  assert.equal(resolveUnitPrice(priced as never, "RETAIL", priced.saleUnits[1] as never).toString(), "720");
});

check("the base unit prices at the plain product price", () => {
  assert.equal(catalogueRate(priced, "pc", "WHOLESALE"), 75.56);
  assert.equal(catalogueRate(priced, "pc", "RETAIL"), 80);
});

check("an unpriced product shows nothing rather than Rs 0", () => {
  // Imported products land at 0.00 deliberately -- blank, not free. The server
  // refuses to bill them; the screen must not offer them at zero either.
  const unpriced = { ...priced, wholesalePrice: "0", retailPrice: "0", saleUnits: [priced.saleUnits[0]!] };
  assert.equal(catalogueRate(unpriced, "pc", "WHOLESALE"), null);
  assert.throws(() => resolveUnitPrice(unpriced as never, "WHOLESALE", unpriced.saleUnits[0] as never), UnpricedProductError);
});

check("bill quantities drop the decimals they don't need", () => {
  // A whole-piece line reads "2 PCS", not "2.00 PCS".
  assert.equal(fmtQty(2), "2");
  assert.equal(fmtQty("2.00"), "2");
  // Fractions are real -- half a kilo, a unit conversion that doesn't divide.
  // All three decimals on a fraction: "0.5 kg" was read as 5 kg off a bill.
  assert.equal(fmtQty(2.5), "2.500");
  assert.equal(fmtQty(0.5), "0.500");
  assert.equal(fmtQty("0.250"), "0.250");
  assert.equal(fmtQty(0.75), "0.750");
  assert.equal(fmtQty(0.9999), "1"); // rounds to whole, prints whole
  assert.equal(fmtQty(1 / 3), "0.333");
  assert.equal(fmtQty(0), "0");
});

check("the Alt+C calculator does arithmetic, and nothing else", () => {
  assert.equal(evaluate("12*5+3"), "63");
  assert.equal(evaluate("(100-10)/4"), "22.5");
  assert.equal(evaluate("0.1+0.2"), "0.3"); // no float dust on a till
  // Half-typed, empty, or non-arithmetic input shows nothing rather than throwing.
  assert.equal(evaluate("12*"), "");
  assert.equal(evaluate("  "), "");
  assert.equal(evaluate("1/0"), "");
  assert.equal(evaluate("alert(1)"), "");
  assert.equal(evaluate("fetch`x`"), "");
});

// ── Editing one sale unit's rate ──────────────────────────────────
const peti = { barcode: "890123", wholesalePrice: "680.00", retailPrice: null };
const untouched = { barcode: "890123", barcodeGenerated: false, wholesale: "680.00", retail: "" };

check("an untouched unit sends nothing", () => {
  assert.deepEqual(saleUnitPatch(peti, untouched), {});
});

check("a changed peti rate is sent, the barcode is not", () => {
  assert.deepEqual(saleUnitPatch(peti, { ...untouched, wholesale: "700" }), { wholesalePrice: 700 });
});

check("clearing a rate derives it again rather than pricing it free", () => {
  assert.deepEqual(saleUnitPatch(peti, { ...untouched, wholesale: "" }), { wholesalePrice: null });
});

check("setting a retail rate that had none", () => {
  assert.deepEqual(saleUnitPatch(peti, { ...untouched, retail: "750" }), { retailPrice: 750 });
});

check("a barcode and a rate changed together go in one patch", () => {
  assert.deepEqual(saleUnitPatch(peti, { barcode: "890999", barcodeGenerated: true, wholesale: "700", retail: "" }), {
    barcode: "890999",
    barcodeGenerated: true,
    wholesalePrice: 700,
  });
});

check("clearing a barcode clears the generated flag with it", () => {
  assert.deepEqual(saleUnitPatch(peti, { ...untouched, barcode: "" }), { barcode: null, barcodeGenerated: false });
});

// ── Errors that carry their own way out ───────────────────────────
const asResponse = (status: number, body: unknown) =>
  ({ status, json: async () => body }) as unknown as Response;

check("a server fix travels with the message", async () => {
  const out = await readError(asResponse(409, { error: "2 orders are still open in this unit.", fix: { label: "Open Orders", href: "/manager/orders" } }));
  assert.equal(out.message, "2 orders are still open in this unit.");
  assert.deepEqual(out.fix, { label: "Open Orders", href: "/manager/orders" });
});

check("an expired session always offers the way back in", async () => {
  const out = await readError(asResponse(401, null));
  assert.deepEqual(out.fix, { label: "Sign in again", href: "/login" });
});

check("a plain error still shows, with no invented button", async () => {
  const out = await readError(asResponse(500, { error: "Could not save product" }));
  assert.equal(out.message, "Could not save product");
  assert.equal(out.fix, undefined);
  // Unparseable body, and a malformed fix, both fall back rather than throw.
  assert.equal((await readError(asResponse(500, null), "Fallback")).message, "Fallback");
  assert.equal((await readError(asResponse(409, { error: "x", fix: { label: 12 } }))).fix, undefined);
});

// ── A product whose base unit has been detached ────────────────────
check("removing the base unit leaves every other unit converting correctly", () => {
  // Product.baseUnitId outlives the ProductUnit row, so quantities stay
  // denominated in PCS and a PETI is still 15 of them.
  const withoutBase = [{ unitId: "peti", factorToBase: 15, isBaseUnit: false }];
  assert.equal(toBaseQty(withoutBase, "peti", 2).toString(), "30");
  assert.equal(fromBaseQty(withoutBase, "peti", 30).toString(), "2");
  // The detached unit is no longer sellable, and input validation says so
  // rather than silently converting it at 1.
  assert.throws(() => assertValidUnit(withoutBase, "pcs"));
});

// ── Changing which unit the stock is counted in ──────────────────────
// The base unit is the denominator of every quantity and price stored against
// a product, so a switch rescales all of them — or is refused outright.
function planOrThrow(out: ReturnType<typeof planBaseUnitChange>) {
  if ("error" in out) throw new Error(out.error);
  return out.plan;
}
const asMsg = (out: ReturnType<typeof planBaseUnitChange>) => ("error" in out ? out.error : "no error");

const rice = [
  { unitId: "kg", symbol: "kg", factorToBase: "1.000000", isBaseUnit: true },
  { unitId: "g", symbol: "g", factorToBase: "0.001000", isBaseUnit: false },
];
const ricePrices = { wholesalePrice: "50.00", retailPrice: "60.00", avgCost: "40.0000", minStock: "2.000", maxStock: null };

check("counting in a smaller unit multiplies the stock and divides the price", () => {
  const plan = planOrThrow(planBaseUnitChange(rice, ricePrices, [{ warehouseId: "w1", quantityOnHand: "5.000", quantityReserved: "1.000" }], "g"));
  assert.deepEqual(plan.stock, [{ warehouseId: "w1", quantityOnHand: "5000.000", quantityReserved: "1000.000" }]);
  assert.equal(plan.product.wholesalePrice, "0.05"); // Rs 50 a kg is 5 paise a gram
  assert.equal(plan.product.retailPrice, "0.06");
  assert.equal(plan.product.avgCost, "0.0400");
  assert.equal(plan.product.minStock, "2000.000");
  assert.deepEqual(plan.factors, [
    { unitId: "kg", factorToBase: "1000.000000", isBaseUnit: false },
    { unitId: "g", factorToBase: "1.000000", isBaseUnit: true },
  ]);
});

check("a same-size unit takes over with nothing rescaled at all", () => {
  // The real case: BOX was attached at factor 1, so it is the same size as PCS.
  const units = [
    { unitId: "pcs", symbol: "PCS", factorToBase: "1.000000", isBaseUnit: true },
    { unitId: "box", symbol: "BOX", factorToBase: "1.000000", isBaseUnit: false },
  ];
  const plan = planOrThrow(planBaseUnitChange(units, ricePrices, [{ warehouseId: "w1", quantityOnHand: "31201.000", quantityReserved: "36.000" }], "box"));
  assert.deepEqual(plan.stock, [{ warehouseId: "w1", quantityOnHand: "31201.000", quantityReserved: "36.000" }]);
  assert.equal(plan.product.wholesalePrice, "50.00");
  assert.deepEqual(plan.factors, [
    { unitId: "pcs", factorToBase: "1.000000", isBaseUnit: false },
    { unitId: "box", factorToBase: "1.000000", isBaseUnit: true },
  ]);
});

check("a bigger unit can't become the base while a smaller one is attached", () => {
  // 1 PCS would be 0.066667 PETI — every loose-bottle sale would leak a fraction.
  const coke = [
    { unitId: "pcs", symbol: "PCS", factorToBase: "1.000000", isBaseUnit: true },
    { unitId: "peti", symbol: "PETI", factorToBase: "15.000000", isBaseUnit: false },
  ];
  assert.match(asMsg(planBaseUnitChange(coke, ricePrices, [], "peti")), /A PCS would become 0.066667 PETI/);
});

check("stock that doesn't divide evenly is refused, not rounded away", () => {
  // Factors divide cleanly here (g -> kg is x1000), so only the stock is at fault:
  // 31201.5 g is 31.2015 kg, and the column holds three decimals.
  const grams = [
    { unitId: "g", symbol: "g", factorToBase: "1.000000", isBaseUnit: true },
    { unitId: "kg", symbol: "kg", factorToBase: "1000.000000", isBaseUnit: false },
  ];
  const out = planBaseUnitChange(grams, ricePrices, [{ warehouseId: "w1", quantityOnHand: "31201.500", quantityReserved: "0" }], "kg");
  assert.match(asMsg(out), /doesn't divide into whole kg/);
});

check("the unit that is already the base, and one that isn't attached, are refused", () => {
  assert.match(asMsg(planBaseUnitChange(rice, ricePrices, [], "kg")), /already the base/);
  assert.match(asMsg(planBaseUnitChange(rice, ricePrices, [], "peti")), /not attached/);
});

// ── Themes ───────────────────────────────────────────────────────────────
// A preset with a missing token, or one where the text sinks into its own
// background, is only discoverable by someone staring at a till screen.
check("every theme defines all seven tokens and stays readable", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const k of TOKEN_KEYS) {
      assert.match(t.tokens[k] ?? "", /^\d+ \d+ \d+$/, `${name}.${k}`);
    }
    // WCAG AA body text is 4.5:1 — text on both the cards and the page behind.
    assert.ok(contrast(t.tokens.ink, t.tokens.paper) >= 4.5, `${name}: ink on paper`);
    assert.ok(contrast(t.tokens.ink, t.tokens.surface) >= 4.5, `${name}: ink on surface`);
    // Secondary text and the white-on-accent buttons only owe AA-large, 3:1.
    assert.ok(contrast(t.tokens.muted, t.tokens.paper) >= 3, `${name}: muted on paper`);
    assert.ok(contrast("255 255 255", t.tokens.accent) >= 3, `${name}: white on accent`);
    // Borders and the hover tint have to be findable against what they sit on.
    assert.ok(contrast(t.tokens.line, t.tokens.paper) >= 1.2, `${name}: line on paper`);
    assert.ok(contrast(t.tokens["surface-hi"], t.tokens.paper) >= 1.08, `${name}: hover on paper`);
  }
});

check("an unknown or missing theme name falls back to the default", () => {
  const fallback = themeVars(DEFAULT_THEME);
  assert.deepEqual(themeVars("nonesuch"), fallback);
  assert.deepEqual(themeVars(""), fallback);
  assert.deepEqual(themeVars(undefined), fallback);
  assert.equal((fallback as Record<string, string>)["--c-paper"], "255 255 255");
});

// ───────────────────────── GST tax invoice ─────────────────────────
// The whole point of the rounding in gst.ts is matching what Tally prints, so
// the check is a real supplier invoice (vikas.pdf, AMIT AGENCIES AM/25-26/17)
// reproduced to the paisa. If these numbers move, our invoice has stopped
// agreeing with the ones the shop's own buyers hold.
check("a Tally GST invoice is reproduced to the paisa", () => {
  const atta5 = gstLine({ quantity: 15, rate: 1350, taxPercent: 5 }, true, false);
  assert.equal(atta5.rateExcl, 1285.71);
  assert.equal(atta5.taxable, 19285.65);
  assert.equal(atta5.cgst, 482.14);
  assert.equal(atta5.sgst, 482.14);

  const atta10 = gstLine({ quantity: 20, rate: 1300, taxPercent: 5 }, true, false);
  assert.equal(atta10.rateExcl, 1238.1);
  assert.equal(atta10.taxable, 24762);
  assert.equal(atta10.cgst, 619.05);

  const t = gstTotals([atta5, atta10]);
  assert.equal(t.taxable, 44047.65);
  assert.equal(t.cgst, 1101.19);
  assert.equal(t.sgst, 1101.19);
  assert.equal(t.igst, 0);
  assert.equal(t.tax, 2202.38);
  assert.equal(t.total, 46250.03);

  assert.equal(rupeesInWords(t.total), "INR Forty Six Thousand Two Hundred Fifty and Three paise Only");
  assert.equal(rupeesInWords(t.tax), "INR Two Thousand Two Hundred Two and Thirty Eight paise Only");

  // The HSN summary has to reconcile with the lines above it, not merely be close.
  const rows = hsnSummary([{ ...atta5, hsn: "110100" }, { ...atta10, hsn: "110112" }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.cgst, 482.14);
  assert.equal(rows[1]!.taxable, 24762);
  assert.equal(rows.reduce((s, r) => s + r.taxable, 0), t.taxable);
  assert.equal(rows.reduce((s, r) => s + r.tax, 0), t.tax);
});

check("one product billed in two units keeps a unit per line, not per product", () => {
  // The `per` column is resolved per line. Keying it by product printed the
  // last line's unit on every line of that product — invisible until units
  // became switchable on the screen, and wrong on the customer's copy.
  const saleUnits = [
    { unitId: "u-bag", isBaseUnit: false, factorToBase: 50, unit: { id: "u-bag", symbol: "BAG" } },
    { unitId: "u-kg", isBaseUnit: true, factorToBase: 1, unit: { id: "u-kg", symbol: "KG" } },
  ];
  const symbolOf = (unitId: string) => saleUnits.find((u) => u.unitId === unitId)?.unit.symbol ?? "";
  const items = [
    { productId: "p1", unitId: "u-bag", quantity: 2, rate: 1350, taxPercent: 5 },
    { productId: "p1", unitId: "u-kg", quantity: 5, rate: 30, taxPercent: 5 },
  ];
  const units = items.map((it) => symbolOf(it.unitId));
  assert.deepEqual(units, ["BAG", "KG"]);

  // And the rendered invoice really carries both.
  const lines = items.map((it) => ({
    ...gstLine(it, true, false),
    name: "Atta",
    hsn: "110100",
    quantity: it.quantity,
    unit: symbolOf(it.unitId),
  }));
  const html = buildGstInvoiceHtml({
    seller: { name: "S", address: "A", gstin: "06AQNPG1418P1ZK", email: null },
    buyer: { name: "B", address: null, gstin: null, stateCode: "06", mobile: null },
    invoiceNo: "GST-1", date: "2026-09-18", lines, interState: false,
  });
  assert.ok(html.includes("2 BAG"), "first line keeps BAG");
  assert.ok(html.includes("5 KG"), "second line keeps KG");
  // Mixed units cannot be summed into one label, so the total is a bare count.
  assert.ok(!html.includes("7 BAG"), "mixed units are not labelled with one unit");
});

check("tax-exclusive rates add the tax on top instead of backing it out", () => {
  const l = gstLine({ quantity: 10, rate: 100, taxPercent: 18 }, false, false);
  assert.equal(l.taxable, 1000);
  assert.equal(l.rateIncl, 118);
  assert.equal(l.cgst, 90);
  assert.equal(l.total, 1180);
});

check("CGST and SGST are rounded separately so the three printed figures agree", () => {
  // 100.10 at 5%: halves round to 1.25 + 1.25 = 2.50, while one rounded 5%
  // would print 5.01 — a bill whose own tax lines do not add up.
  const l = gstLine({ quantity: 1, rate: 100.1, taxPercent: 5 }, false, false);
  assert.equal(l.cgst + l.sgst, l.tax);
  assert.equal(gstTotals([l]).total, l.taxable + l.cgst + l.sgst);
});

check("an out-of-state buyer is charged IGST at the full rate, not split", () => {
  const inter = gstLine({ quantity: 20, rate: 1300, taxPercent: 5 }, true, true);
  assert.equal(inter.igst, 1238.1);
  assert.equal(inter.cgst, 0);
  assert.equal(inter.tax, 1238.1);
  // Same money either way — only the heads it is charged under change.
  assert.equal(inter.total, gstLine({ quantity: 20, rate: 1300, taxPercent: 5 }, true, false).total);
});

check("place of supply follows the GSTIN, and an unknown one stays intra-state", () => {
  assert.ok(isGstin("06AQNPG1418P1ZK"));
  assert.ok(isGstin("27AAPFU0939F1ZV"));
  assert.ok(!isGstin("06AQNPG1418P1Z")); // one character short
  assert.ok(!isGstin("AQNPG1418P1ZK06"));
  // Right shape, wrong check digit — the regex alone would have accepted it,
  // and a typo'd GSTIN on a tax invoice is a legal problem, not a cosmetic one.
  assert.ok(!isGstin("06AQNPG1418P1ZZ"), "bad check digit is refused");
  assert.ok(!isGstin("06AQNPG1418P1ZA"));
  assert.ok(gstinChecksumOk("06AQNPG1418P1ZK"));
  assert.equal(stateCodeOfGstin("06AQNPG1418P1ZK"), "06");
  assert.equal(panOfGstin("06AQNPG1418P1ZK"), "AQNPG1418P");
  assert.equal(stateCodeOfGstin("nonsense"), null);
  assert.equal(isInterState("06AQNPG1418P1ZK", "07"), true);
  assert.equal(isInterState("06AQNPG1418P1ZK", "06"), false);
  // An unregistered buyer has no state to read — must not silently become IGST.
  assert.equal(isInterState("06AQNPG1418P1ZK", null), false);
});

check("the rendered GST invoice carries the figures, and escapes what staff typed", () => {
  const lines = [
    { ...gstLine({ quantity: 15, rate: 1350, taxPercent: 5 }, true, false), name: "<script>Atta", hsn: "110100", quantity: 15, unit: "BAG" },
    { ...gstLine({ quantity: 20, rate: 1300, taxPercent: 5 }, true, false), name: "Atta 10kg", hsn: "110112", quantity: 20, unit: "BAG" },
  ];
  const html = buildGstInvoiceHtml({
    seller: { name: "AMIT AGENCIES", address: "BADSHAPUR", gstin: "06AQNPG1418P1ZK", email: null },
    buyer: { name: "VIKAS KUMAR", address: null, gstin: null, stateCode: "06", mobile: null },
    invoiceNo: "GST-20260918-0001",
    date: "2026-09-16",
    lines,
    interState: false,
  });
  assert.ok(html.includes("19285.65"), "taxable value");
  assert.ok(html.includes("110100"), "HSN summary row");
  assert.ok(html.includes("Haryana"), "state read off the GSTIN");
  assert.ok(html.includes("AQNPG1418P"), "PAN read off the GSTIN");
  assert.ok(html.includes("16-Sep-26"), "Tally-style date");
  assert.ok(!html.includes("<script>"), "staff-typed text is escaped");
  // Two HSNs at one rate are ONE tax line on the bill, carrying both — the
  // per-HSN split belongs in the summary table, not the foot.
  assert.equal(html.match(/Outward Cgst/g)?.length, 1, "one CGST row per rate, not per HSN");
  assert.ok(html.includes(">1101.19<"), "the single CGST row carries both HSNs");
});


// ───────────────────── GST invoice register ─────────────────────
const issuedLog = (entityId: string, rec: Record<string, unknown>, at = "2026-09-18T06:30:00.000Z", userId: string | null = "u1") => ({
  entityId, timestamp: at, userId, action: GST_ISSUED,
  newValue: { customerId: "c1", customerName: "Vikas Kumar", total: 100, taxable: 95, tax: 5, interState: false, placeOfSupply: "06", inclusive: true, lines: 1, stockDeducted: false, supersedes: null, key: `gst-invoices/w1/${entityId}.html`, items: [{ productId: "p1", unitId: "u1", name: "Atta", unit: "BAG", hsn: "110100", quantity: 1, rate: 100, taxPercent: 5 }], ...rec },
});

check("the register folds later stock deductions onto the invoice they belong to", () => {
  // Both actions land against the same entityId. Treating them as separate
  // rows would invent a second invoice that was never issued.
  const rows = buildRegister(
    [issuedLog("GST-1", {}), { entityId: "GST-1", timestamp: "2026-09-18T07:00:00.000Z", userId: "u2", action: GST_DEDUCTED_LATER, newValue: { lines: 1 } }],
    new Map([["u1", "Finance One"]])
  );
  assert.equal(rows.length, 1, "one invoice, not two");
  assert.equal(rows[0]!.deductedLater, true);
  assert.equal(rows[0]!.stockDeducted, false, "it was not deducted at issue time");
  assert.equal(isStockSettled(rows[0]!), true, "but the stock IS accounted for");
  assert.equal(rows[0]!.issuedBy, "Finance One");
});

check("a revision is visible from both the old invoice and the new one", () => {
  const rows = buildRegister([issuedLog("GST-1", {}), issuedLog("GST-2", { supersedes: "GST-1" })], new Map());
  const byNo = new Map(rows.map((r) => [r.invoiceNo, r]));
  assert.equal(byNo.get("GST-1")!.supersededBy, "GST-2", "the old one says it was replaced");
  assert.equal(byNo.get("GST-2")!.supersedes, "GST-1", "the new one says what it replaced");
  // Neither can be read alone and mistaken for the whole truth.
  assert.equal(byNo.get("GST-2")!.supersededBy, null);
});

check("an invoice with no stored lines is view-only, never replayable", () => {
  // Rows written before the register stored line detail cannot be re-issued
  // or deducted from — the screen must not offer a button that would 404.
  const [row] = buildRegister([issuedLog("GST-OLD", { items: undefined })], new Map());
  assert.equal(isReplayable(row!), false);
  assert.deepEqual(row!.items, [], "missing items normalise to empty, not undefined");
});

check("the month filter uses the business timezone, not UTC", () => {
  // 2026-09-30 20:00 UTC is 01:30 IST on 1 Oct — an October invoice.
  assert.equal(inMonth("2026-09-30T20:00:00.000Z", "2026-10"), true);
  assert.equal(inMonth("2026-09-30T20:00:00.000Z", "2026-09"), false);
  assert.equal(inMonth("2026-09-18T06:30:00.000Z", "2026-09"), true);
  assert.equal(inMonth("2026-09-18T06:30:00.000Z", ""), true, "no month set means no filtering");
});

check("register search matches invoice number and customer, case-insensitively", () => {
  const [row] = buildRegister([issuedLog("GST-20260918-0001", {})], new Map());
  assert.ok(matchesSearch(row!, "gst-2026"));
  assert.ok(matchesSearch(row!, "VIKAS"));
  assert.ok(matchesSearch(row!, ""), "an empty search matches everything");
  assert.ok(!matchesSearch(row!, "nobody"));
});

check("CSV export neutralises spreadsheet formulas in customer names", () => {
  // A name starting with = is executed by Excel on open. The accountant opens
  // this file, so the cell has to be inert.
  const rows = buildRegister([issuedLog("GST-1", { customerName: '=cmd|calc!A1' })], new Map());
  const csv = toCsv(rows);
  assert.ok(!/,=cmd/.test(csv), "the = must not start a cell");
  assert.ok(csv.includes("'=cmd|calc!A1"), "it is prefixed so Excel reads it as text");
  // And a comma in a name must not split into an extra column.
  const withComma = toCsv(buildRegister([issuedLog("GST-2", { customerName: "Shah, Sons" })], new Map()));
  assert.ok(withComma.includes('"Shah, Sons"'));
  assert.equal(withComma.split(String.fromCharCode(13, 10)).length, 2, "header plus exactly one row");
});


// ───────────────────── GSTIN lookup (provider-agnostic) ─────────────────────
check("provider JSON is read by configured paths, in whatever shape it arrives", () => {
  const body = { taxpayerInfo: { lgnm: "AMIT AGENCIES", tradeNam: "Amit Traders", pradr: { addr: { bnm: "House 294", st: "Bara Bazar", dst: "Gurgaon", pncd: "122101" } } } };
  const paths = parsePaths("name:taxpayerInfo.lgnm, tradeName:taxpayerInfo.tradeNam, address:taxpayerInfo.pradr.addr");
  const d = extractDetails(body, paths);
  assert.equal(d.legalName, "AMIT AGENCIES");
  assert.equal(d.tradeName, "Amit Traders");
  assert.equal(d.address, "House 294, Bara Bazar, Gurgaon, 122101");

  // Another provider, flat strings and an array — same code, different paths.
  const flat = { data: [{ legal_name: "X Ltd", address: "12 Main Rd, Sohna" }] };
  const d2 = extractDetails(flat, parsePaths("name:data.0.legal_name, address:data.0.address"));
  assert.equal(d2.legalName, "X Ltd");
  assert.equal(d2.address, "12 Main Rd, Sohna");
});

check("a missing or mistyped path yields null rather than throwing", () => {
  assert.equal(pick({ a: { b: 1 } }, "a.b.c.d"), undefined);
  assert.equal(pick(null, "a"), undefined);
  const d = extractDetails({ a: 1 }, parsePaths("name:nope.nothing"));
  assert.equal(d.legalName, null);
  assert.deepEqual(parsePaths("garbage, name:a.b,"), { name: "a.b" }, "junk segments are skipped");
});

check("a repeated city in a GSTN address is not printed twice", () => {
  // GSTN echoes the city in both dst and loc on many records.
  assert.equal(flattenAddress({ st: "Bara Bazar", dst: "Gurgaon", loc: "Gurgaon" }), "Bara Bazar, Gurgaon");
  assert.equal(flattenAddress("  12 Main Rd  "), "12 Main Rd");
  assert.equal(flattenAddress(null), null);
  assert.equal(flattenAddress({ a: "", b: "   " }), null, "all-empty is nothing, not an empty join");
});

check("the lookup URL is substituted and refuses anything but a public https host", () => {
  const u = buildLookupUrl("https://p.example/v?gst={gstin}&key={key}", "06AQNPG1418P1ZK", "s3cr et");
  assert.ok(u.includes("gst=06AQNPG1418P1ZK"));
  assert.ok(u.includes("key=s3cr%20et"), "the key is url-encoded, not pasted raw");

  // A settings typo must not turn this authenticated route into a way to
  // probe the inside of the network.
  for (const bad of ["http://p.example/v", "https://localhost/v", "https://127.0.0.1/v", "https://10.0.0.5/v", "https://192.168.1.1/v", "https://172.16.0.9/v", "https://169.254.169.254/latest/meta-data"]) {
    assert.throws(() => buildLookupUrl(bad, "06AQNPG1418P1ZK", "k"), LookupConfigError, bad);
  }
  assert.throws(() => buildLookupUrl("", "06AQNPG1418P1ZK", "k"), LookupConfigError, "unconfigured");
});

// ───────────────────── Mark a bill unpaid ─────────────────────
check("mark unpaid voids cash payments and takes their SALE rows back out of an open drawer", () => {
  const cash = { type: "PAYMENT", method: "CASH", status: "CONFIRMED", sessionStatus: "OPEN" };
  const plan = planMarkUnpaid([
    { ...cash, id: "p1", cashTxId: "c1" },
    { ...cash, id: "p2", cashTxId: null, sessionStatus: null }, // paid before the drawer existed
    { ...cash, id: "f1", cashTxId: null, status: "FAILED" },
  ].filter((r) => r.status !== "FAILED"));
  assert.deepEqual(plan, { voidIds: ["p1", "p2"], cashTxIds: ["c1"] });
});

check("mark unpaid refuses UPI, refunds, pending UPI, a counted drawer, and a bill with nothing paid", () => {
  const cash = { id: "p1", type: "PAYMENT", method: "CASH", status: "CONFIRMED", cashTxId: "c1", sessionStatus: "OPEN" };
  assert.throws(() => planMarkUnpaid([]), MarkUnpaidError);
  assert.throws(() => planMarkUnpaid([{ ...cash, method: "UPI", cashTxId: null, sessionStatus: null }]), MarkUnpaidError);
  assert.throws(() => planMarkUnpaid([cash, { ...cash, id: "r1", type: "REFUND" }]), MarkUnpaidError);
  assert.throws(() => planMarkUnpaid([cash, { ...cash, id: "u1", method: "UPI", status: "PENDING" }]), MarkUnpaidError);
  assert.throws(() => planMarkUnpaid([{ ...cash, sessionStatus: "CLOSED" }]), MarkUnpaidError);
});

console.log(`
${passed} checks passed.`);
