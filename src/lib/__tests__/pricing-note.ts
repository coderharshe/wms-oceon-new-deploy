// npx tsx src/lib/__tests__/pricing-note.ts
import assert from "node:assert/strict";
import { buildBillLine } from "../pricing";

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

const priced = { id: "p1", name: "Parle-G", baseUnitId: "pc", wholesalePrice: 90, retailPrice: 100, taxPercent: 0 };
const unpriced = { ...priced, wholesalePrice: 0 };
const units = [{ unitId: "pc", isBaseUnit: true, factorToBase: 1 }];
const bill = (p: typeof priced, unitPrice?: number) => {
  const issues: string[] = [];
  const line = buildBillLine(p, units, { unitId: "pc", quantity: 1, discount: 0, unitPrice }, "WHOLESALE", issues);
  return { line, issues };
};

check("unpriced product with explicit unitPrice 10: note names Rs 10.00, never Rs 0", () => {
  const { line, issues } = bill(unpriced, 10);
  assert.equal(line.unitPrice.toString(), "10");
  assert.equal(issues.length, 1);
  assert.doesNotMatch(issues[0]!, /Rs 0\b/);
  assert.match(issues[0]!, /no wholesale price set/);
  assert.match(issues[0]!, /Rs 10\.00/);
});

check("unpriced product with no unitPrice: still flagged as billed at Rs 0", () => {
  const { line, issues } = bill(unpriced);
  assert.equal(line.lineTotal.toString(), "0");
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /no wholesale price set, so it was billed at Rs 0\. Set a price and recover/);
});

check("unpriced product with explicit unitPrice 0: flagged as billed at Rs 0", () => {
  const { issues } = bill(unpriced, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /billed at Rs 0\. Set a price/);
});

check("priced product with explicit override: no note, override stored", () => {
  const { line, issues } = bill(priced, 85);
  assert.deepEqual(issues, []);
  assert.equal(line.unitPrice.toString(), "85");
  assert.equal(line.catalogPrice.toString(), "90");
});

check("priced product with explicit unitPrice 0: flagged against catalogue rate", () => {
  const { issues } = bill(priced, 0);
  assert.deepEqual(issues, ["Parle-G: billed at Rs 0 against a catalogue rate of Rs 90."]);
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
