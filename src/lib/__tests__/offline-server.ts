// Server side of offline-first billing: the billedAt window and numbers that
// join the day the bill was made. Run: npx tsx src/lib/__tests__/offline-server.ts
import assert from "node:assert/strict";
import { acceptBilledAt, businessDateCompact } from "../business-date";
import { nextNumber } from "../numbering";
import { nextNumberDrizzle } from "../drizzle-numbering";

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

const now = new Date("2026-09-17T06:30:00.000Z"); // 12:00 IST
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, DAY = 86_400_000;

async function main() {
  await check("no billedAt = now, no issue", () => {
    assert.deepEqual(acceptBilledAt(undefined, now), { at: now, backdated: false, issue: null });
  });
  await check("earlier the same business day: kept, no note", () => {
    const r = acceptBilledAt(ago(3 * 3600_000), now); // 09:00 IST
    assert.deepEqual([r.backdated, r.issue, r.at.toISOString()], [true, null, ago(3 * 3600_000)]);
  });
  await check("yesterday: kept, with a made-on/synced note", () => {
    const r = acceptBilledAt(ago(DAY), now);
    assert.equal(r.backdated, true);
    assert.equal(r.at.toISOString(), ago(DAY));
    assert.equal(r.issue, "Made on the PC on 16 Sept 2026, synced 17 Sept 2026.");
  });
  await check("exactly 7 days back and 5 minutes ahead are inside", () => {
    assert.equal(acceptBilledAt(ago(7 * DAY), now).backdated, true);
    assert.deepEqual(acceptBilledAt(ago(-5 * MIN), now), { at: new Date(ago(-5 * MIN)), backdated: true, issue: null });
  });
  await check("just past 7 days / 5 minutes ahead = now + issue", () => {
    for (const t of [ago(7 * DAY + 1000), ago(-5 * MIN - 1000)]) {
      const r = acceptBilledAt(t, now);
      assert.deepEqual([r.at, r.backdated], [now, false]);
      assert.match(r.issue ?? "", /outside the accepted window/);
    }
  });
  await check("explicit offset is honoured", () => {
    const r = acceptBilledAt("2026-09-17T09:00:00+05:30", now);
    assert.deepEqual([r.backdated, r.at.toISOString(), r.issue], [true, "2026-09-17T03:30:00.000Z", null]);
  });
  await check("no zone / not ISO / garbled = out of window, never a refusal", () => {
    for (const t of ["2026-09-17T09:00:00", "2026-09-17", "Wed Sep 17 2026 09:00:00 GMT+0530", "1789000000000", "not a date"]) {
      const r = acceptBilledAt(t, now);
      assert.deepEqual([r.at, r.backdated], [now, false], t);
      assert.match(r.issue ?? "", /outside the accepted window/, t);
    }
  });

  // Numbers: the date part AND the counter key follow the date passed in, so
  // a bill made yesterday takes yesterday's next number, not today's.
  const fakePrisma = (keys: unknown[]) => ({ $queryRaw: async (_s: TemplateStringsArray, ...v: unknown[]) => (keys.push(v[0]), [{ value: 7 }]) });
  await check("nextNumber uses the given day for key and number", async () => {
    const keys: unknown[] = [];
    const yesterday = new Date("2026-09-16T17:00:00.000Z"); // 22:30 IST on the 16th
    assert.equal(await nextNumber(fakePrisma(keys) as never, "bill", "INV", yesterday), "INV-20260916-0007");
    assert.deepEqual(keys, ["bill:20260916"]);
  });
  await check("IST late evening is still that IST day", () => {
    assert.equal(businessDateCompact(new Date("2026-09-16T19:00:00.000Z")), "20260917"); // 00:30 IST 17th
    assert.equal(businessDateCompact(new Date("2026-09-16T18:00:00.000Z")), "20260916"); // 23:30 IST 16th
  });
  await check("nextNumberDrizzle uses the given day too", async () => {
    let query: any;
    const tx = { execute: async (q: unknown) => ((query = q), { rows: [{ value: 12 }] }) };
    assert.equal(await nextNumberDrizzle(tx as never, "order", "ORD", new Date("2026-09-10T06:00:00.000Z")), "ORD-20260910-0012");
    assert.ok(JSON.stringify(query.queryChunks).includes("order:20260910"));
  });
  await check("no date = today (existing callers unchanged)", async () => {
    const keys: unknown[] = [];
    assert.match(await nextNumber(fakePrisma(keys) as never, "order", "ORD"), new RegExp(`^ORD-${businessDateCompact()}-0007$`));
  });

  if (failed) {
    console.log(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}

main();
