#!/usr/bin/env node
// Offline-first billing: server API contract, over HTTP against a LOCAL dev
// server (Prisma path) and the local Docker Postgres. Never point this at Neon.
//
// Usage: node scripts/offline-e2e/server-contract.mjs [baseUrl]
//   env DATABASE_URL (default postgresql://wms:wms@localhost:5432/wms)
import pg from "pg";

const base = process.argv[2] ?? process.env.E2E_BASE ?? "http://localhost:3100";
const dbUrl = process.env.DATABASE_URL ?? "postgresql://wms:wms@localhost:5432/wms";
if (!/localhost|127\.0\.0\.1/.test(dbUrl)) throw new Error("refusing to run against a non-local database");
// Prisma stores UTC in timestamp-without-zone columns; read them back as UTC.
pg.types.setTypeParser(1114, (s) => new Date(s.replace(" ", "T") + "Z"));
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const one = async (q, v) => (await db.query(q, v)).rows[0];

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── login ────────────────────────────────────────────────────────────────
// `next dev` runs with the OpenNext shim's local KV, so the one-device rule
// is live: a FIN-1 session left over from an earlier run (or another tester)
// refuses a plain login. Take it over (20s grace), and log out at the end.
const STAFF = process.env.E2E_STAFF ?? "FIN-1";
const creds = JSON.stringify({ staffId: STAFF, password: process.env.E2E_PASSWORD ?? "password123" });
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
let login = await post("/api/auth/login", creds);
if (login.status === 409) {
  const { takeoverId, secret, expiresAt } = await (await post("/api/auth/login/takeover", creds)).json();
  if (!takeoverId) throw new Error(`${STAFF} is logged in elsewhere and takeover is unavailable`);
  console.log(`${STAFF} already logged in — taking the session over (20s)...`);
  await new Promise((r) => setTimeout(r, Math.max(0, expiresAt - Date.now()) + 1000));
  login = await post("/api/auth/login/takeover-status", JSON.stringify({ takeoverId, secret }));
}
if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!cookie) throw new Error(`login gave no session cookie: ${await login.text()}`);

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// ── fixtures ─────────────────────────────────────────────────────────────
const line = await one(`
  SELECT p.id AS "productId", pu."unitId"
  FROM "Product" p JOIN "ProductUnit" pu ON pu."productId" = p.id
  WHERE p.active LIMIT 1`);
const items = (qty = 1) => [{ productId: line.productId, unitId: line.unitId, quantity: qty, discount: 0, unitPrice: 10 }];
const run = Math.random().toString(36).slice(2, 8);
// Request ids must be UUIDs (the routes validate them); one per name per run.
const ids = {};
const rid = (n) => (ids[n] ??= crypto.randomUUID());
const ymdIst = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
const offRef = `OFF-FIN1-${run.toUpperCase()}-001`;
const billReq = rid("bill");
let created;

console.log(`run ${run} against ${base}`);

await check("create with billedAt yesterday: 201, INV/ORD carry yesterday's date, createdAt = billedAt, ids stored", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: billReq, offlineRef: offRef, billedAt: yesterday.toISOString() });
  expect(r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
  created = r.json;
  const d = ymdIst(yesterday);
  expect(created.bill.billNumber.startsWith(`INV-${d}-`), `billNumber ${created.bill.billNumber} not from ${d}`);
  expect(created.order.orderNumber.startsWith(`ORD-${d}-`), `orderNumber ${created.order.orderNumber}`);
  expect(created.order.clientRequestId === billReq && created.order.offlineRef === offRef, "order lacks clientRequestId/offlineRef");
  const row = await one(
    `SELECT o."createdAt" oc, b."createdAt" bc, v."createdAt" vc, o."reviewNotes"
     FROM "Order" o JOIN "Bill" b ON b."orderId" = o.id JOIN "BillVersion" v ON v."billId" = b.id WHERE o.id = $1`,
    [created.order.id]
  );
  for (const k of ["oc", "bc", "vc"]) {
    expect(row[k].getTime() === yesterday.getTime(), `${k} ${row[k].toISOString()} != ${yesterday.toISOString()}`);
  }
  expect(!/accepted window/.test(row.reviewNotes ?? ""), "in-window bill got the window note");
  expect(/^Made on the PC on .+, synced .+\.$/m.test(row.reviewNotes ?? ""), `no made-on/synced note: ${row.reviewNotes}`);
  console.log(`       ${created.order.orderNumber} / ${created.bill.billNumber}`);
});

await check("out-of-range billedAt (10 days ago): still 201, billed now, needsReview with window note", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("old"), offlineRef: `OFF-OLD-${run}`, billedAt: tenDaysAgo.toISOString() });
  expect(r.status === 201, `status ${r.status}`);
  expect(r.json.bill.billNumber.startsWith(`INV-${ymdIst(now)}-`), `billNumber ${r.json.bill.billNumber}`);
  expect(r.json.order.needsReview === true && /outside the accepted window/.test(r.json.order.reviewNotes), `review ${r.json.order.needsReview} ${r.json.order.reviewNotes}`);
  // Drizzle (mode: string) returns UTC wall time with no zone; Prisma an ISO string.
  const createdAt = new Date(/Z|[+-]\d\d:?\d\d$/.test(r.json.order.createdAt) ? r.json.order.createdAt : r.json.order.createdAt.replace(" ", "T") + "Z");
  expect(Math.abs(createdAt.getTime() - Date.now()) < 60_000, `createdAt ${r.json.order.createdAt}`);
  console.log(`       ${r.json.bill.billNumber}: ${r.json.order.reviewNotes}`);
});

await check("garbled / zone-less billedAt is not refused (billed now + window note)", async () => {
  for (const [n, billedAt] of [["garbled", "yesterday-ish"], ["nozone", yesterday.toISOString().replace("Z", "")]]) {
    const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid(n), offlineRef: `OFF-${n}-${run}`, billedAt });
    expect(r.status === 201 && r.json.bill.billNumber.startsWith(`INV-${ymdIst(now)}-`) && /outside the accepted window/.test(r.json.order.reviewNotes ?? ""), `${n}: ${r.status} ${r.json.order?.reviewNotes}`);
  }
});

await check("billedAt without offlineRef is ignored: dated now, today's number, no note", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("noref"), billedAt: yesterday.toISOString() });
  expect(r.status === 201, `status ${r.status}`);
  expect(r.json.bill.billNumber.startsWith(`INV-${ymdIst(now)}-`), `billNumber ${r.json.bill.billNumber}`);
  expect(!/Made on the PC|accepted window/.test(r.json.order.reviewNotes ?? ""), `notes ${r.json.order.reviewNotes}`);
  const { oc } = await one(`SELECT "createdAt" oc FROM "Order" WHERE id = $1`, [r.json.order.id]);
  expect(Math.abs(oc.getTime() - Date.now()) < 60_000, `createdAt ${oc.toISOString()}`);
});

await check("non-UUID request ids are refused with 400 (create, revise, cash)", async () => {
  const create = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: "" });
  const create2 = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: "not-a-uuid" });
  const revise = await api("POST", `/api/finance/orders/${created.order.id}/revise`, { items: items(1), reason: "x", clientRequestId: "not-a-uuid" });
  const cash = await api("POST", "/api/finance/payments/cash", { orderRequestId: "not-a-uuid", amountReceived: 5 });
  const codes = [create.status, create2.status, revise.status, cash.status].join(",");
  expect(codes === "400,400,400,400", `statuses ${codes}`);
});

await check("duplicate of an order in another warehouse: order null, bill null", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("wh"), offlineRef: `OFF-WH-${run}` });
  expect(r.status === 201, `create ${r.status}`);
  const whId = `test-wh-${run}`;
  await db.query(`INSERT INTO "Warehouse" (id, name, code) VALUES ($1, $1, $1)`, [whId]);
  await db.query(`UPDATE "Order" SET "warehouseId" = $1 WHERE id = $2`, [whId, r.json.order.id]);
  try {
    const dup = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("wh"), offlineRef: `OFF-WH-${run}` });
    expect(dup.status === 200 && JSON.stringify(dup.json) === '{"duplicate":true,"order":null,"bill":null}', `got ${dup.status} ${JSON.stringify(dup.json)}`);
  } finally {
    await db.query(`UPDATE "Order" SET "warehouseId" = $1 WHERE id = $2`, [r.json.order.warehouseId, r.json.order.id]);
    await db.query(`DELETE FROM "Warehouse" WHERE id = $1`, [whId]);
  }
});

await check("an order whose clientRequestId equals another order's id: id lookup wins (GET + revise)", async () => {
  // A (older) carries B's id as its clientRequestId — only possible by
  // planting it in the DB now that ids are UUID-validated, but the lookup
  // must still prefer the real id.
  const a = (await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("plantA") })).json;
  const b = (await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: rid("plantB") })).json;
  await db.query(`UPDATE "Order" SET "clientRequestId" = $1 WHERE id = $2`, [b.order.id, a.order.id]);
  try {
    const got = await api("GET", `/api/finance/orders/${b.order.id}`);
    expect(got.status === 200 && got.json.id === b.order.id, `GET returned ${got.json.id}, want B ${b.order.id}`);
    const rev = await api("POST", `/api/finance/orders/${b.order.id}/revise`, { items: items(2), reason: "planted", expectedVersion: 1 });
    expect(rev.status === 200 && rev.json.versionNumber === 2, `revise ${rev.status} ${JSON.stringify(rev.json)}`);
    const vs = (await db.query(`SELECT "orderId", "currentVersion" cv FROM "Bill" WHERE "orderId" = ANY($1)`, [[a.order.id, b.order.id]])).rows;
    const cv = Object.fromEntries(vs.map((v) => [v.orderId, v.cv]));
    expect(cv[b.order.id] === 2 && cv[a.order.id] === 1, `versions A=${cv[a.order.id]} B=${cv[b.order.id]}`);
  } finally {
    await db.query(`UPDATE "Order" SET "clientRequestId" = NULL WHERE id = $1`, [a.order.id]);
  }
});

await check("same clientRequestId again: 200 duplicate with order + bill, one order in DB", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), clientRequestId: billReq, offlineRef: offRef, billedAt: yesterday.toISOString() });
  expect(r.status === 200, `status ${r.status}`);
  const want = { duplicate: true, order: { id: created.order.id, orderNumber: created.order.orderNumber, offlineRef: offRef, clientRequestId: billReq }, bill: { id: created.bill.id, billNumber: created.bill.billNumber } };
  expect(JSON.stringify(r.json) === JSON.stringify(want), `got ${JSON.stringify(r.json)}`);
  const { n } = await one(`SELECT count(*)::int n FROM "Order" WHERE "clientRequestId" = $1`, [billReq]);
  expect(n === 1, `${n} orders`);
  console.log(`       ${JSON.stringify(r.json)}`);
});

await check("draft path stores clientRequestId, no bill", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1), draft: true, clientRequestId: rid("draft") });
  expect(r.status === 201 && r.json.bill === null && r.json.order.clientRequestId === rid("draft") && r.json.order.status === "DRAFT", `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
});

await check("online bill without billedAt: today's number, no review", async () => {
  const r = await api("POST", "/api/finance/orders", { sellingMode: "RETAIL", items: items(1) });
  expect(r.status === 201 && r.json.bill.billNumber.startsWith(`INV-${ymdIst(now)}-`) && !/accepted window/.test(r.json.order.reviewNotes ?? "") && r.json.order.clientRequestId === null, JSON.stringify(r.json.order).slice(0, 200));
});

await check("cash by orderRequestId: 200; re-send = duplicate; unknown = 404; both/neither = 400", async () => {
  const body = { orderRequestId: billReq, amountReceived: 5, clickedAt: new Date(now.getTime() - 60_000).toISOString(), clientRequestId: rid("cash") };
  const r = await api("POST", "/api/finance/payments/cash", body);
  expect(r.status === 200 && r.json.transaction, `status ${r.status} ${JSON.stringify(r.json)}`);
  const again = await api("POST", "/api/finance/payments/cash", body);
  expect(again.status === 200 && again.json.duplicate === true, `re-send ${again.status} ${JSON.stringify(again.json)}`);
  const { paid } = await one(`SELECT "amountPaid"::float paid FROM "Payment" WHERE "billId" = $1`, [created.bill.id]);
  expect(paid === 5, `amountPaid ${paid}`);
  const missing = await api("POST", "/api/finance/payments/cash", { orderRequestId: rid("nope"), amountReceived: 5 });
  expect(missing.status === 404, `unknown ${missing.status}`);
  const both = await api("POST", "/api/finance/payments/cash", { billId: created.bill.id, orderRequestId: billReq, amountReceived: 5 });
  const neither = await api("POST", "/api/finance/payments/cash", { amountReceived: 5 });
  expect(both.status === 400 && neither.status === 400, `both ${both.status} neither ${neither.status}`);
});

await check("revise by clientRequestId with stale expectedVersion: 409 conflict, nothing written", async () => {
  const before = await one(`SELECT b."currentVersion" cv, (SELECT count(*)::int FROM "BillVersion" WHERE "billId" = b.id) nv FROM "Bill" b WHERE b.id = $1`, [created.bill.id]);
  const r = await api("POST", `/api/finance/orders/${billReq}/revise`, { items: items(3), reason: "offline edit", expectedVersion: 0, clientRequestId: rid("rev-stale") });
  expect(r.status === 409, `status ${r.status} ${JSON.stringify(r.json)}`);
  const want = { error: "This bill was changed by someone else (now version 1). Check it and redo your change.", conflict: true, currentVersion: 1 };
  expect(JSON.stringify(r.json) === JSON.stringify(want), `body ${JSON.stringify(r.json)}`);
  const after = await one(`SELECT b."currentVersion" cv, (SELECT count(*)::int FROM "BillVersion" WHERE "billId" = b.id) nv FROM "Bill" b WHERE b.id = $1`, [created.bill.id]);
  expect(after.cv === before.cv && after.nv === before.nv, `bill changed ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  const key = await one(`SELECT key FROM "IdempotencyKey" WHERE key = $1`, [rid("rev-stale")]);
  expect(!key, "idempotency key was kept for a refused edit");
  console.log(`       ${JSON.stringify(r.json)}`);
});

await check("revise with right expectedVersion twice (same clientRequestId): applied once, second = duplicate", async () => {
  const body = { items: items(2), reason: "offline edit", expectedVersion: 1, clientRequestId: rid("rev") };
  const r = await api("POST", `/api/finance/orders/${billReq}/revise`, body);
  expect(r.status === 200 && r.json.versionNumber === 2, `first ${r.status} ${JSON.stringify(r.json)}`);
  const again = await api("POST", `/api/finance/orders/${billReq}/revise`, body);
  expect(again.status === 200 && JSON.stringify(again.json) === '{"duplicate":true}', `second ${again.status} ${JSON.stringify(again.json)}`);
  const { cv, nv } = await one(`SELECT b."currentVersion" cv, (SELECT count(*)::int FROM "BillVersion" WHERE "billId" = b.id) nv FROM "Bill" b WHERE b.id = $1`, [created.bill.id]);
  expect(cv === 2 && nv === 2, `currentVersion ${cv}, versions ${nv}`);
});

await check("revise by order id, no expectedVersion (existing callers) still works; unknown id = 404", async () => {
  const r = await api("POST", `/api/finance/orders/${created.order.id}/revise`, { items: items(2), reason: "online edit" });
  expect(r.status === 200 && r.json.versionNumber === 3, `status ${r.status} ${JSON.stringify(r.json)}`);
  const missing = await api("POST", `/api/finance/orders/${rid("nope")}/revise`, { items: items(2), reason: "x" });
  expect(missing.status === 404, `unknown ${missing.status}`);
});

await check("two revisions of the same version at once: exactly one applies, the other gets 409", async () => {
  const send = (n) => api("POST", `/api/finance/orders/${billReq}/revise`, { items: items(n), reason: "race", expectedVersion: 3, clientRequestId: rid(`race-${n}`) });
  const rs = await Promise.all([send(4), send(5)]);
  const codes = rs.map((r) => r.status).sort().join(",");
  expect(codes === "200,409", `statuses ${codes} ${JSON.stringify(rs.map((r) => r.json))}`);
  const { cv, nv } = await one(`SELECT b."currentVersion" cv, (SELECT count(*)::int FROM "BillVersion" WHERE "billId" = b.id) nv FROM "Bill" b WHERE b.id = $1`, [created.bill.id]);
  expect(cv === 4 && nv === 4, `currentVersion ${cv}, versions ${nv}`);
});

await check("GET order by clientRequestId (and by id)", async () => {
  const r = await api("GET", `/api/finance/orders/${billReq}`);
  expect(r.status === 200 && r.json.id === created.order.id && r.json.offlineRef === offRef && r.json.clientRequestId === billReq, `status ${r.status}`);
  const byId = await api("GET", `/api/finance/orders/${created.order.id}`);
  expect(byId.status === 200 && byId.json.id === created.order.id, `by id ${byId.status}`);
  const missing = await api("GET", `/api/finance/orders/${rid("nope")}`);
  expect(missing.status === 404, `unknown ${missing.status}`);
});

await check("search by offlineRef (case-insensitive, partial)", async () => {
  const r = await api("GET", `/api/finance/orders?q=${encodeURIComponent(`fin1-${run}`)}`);
  expect(r.status === 200 && r.json.length === 1 && r.json[0].id === created.order.id, `status ${r.status} n=${r.json.length}`);
});

await check("print-settings returns businessName", async () => {
  const r = await api("GET", "/api/finance/print-settings");
  expect(r.status === 200 && typeof r.json.businessName === "string" && r.json.businessName.length > 0 && Object.keys(r.json).length === 1, `${r.status} ${JSON.stringify(r.json)}`);
  console.log(`       ${JSON.stringify(r.json)}`);
});

await api("POST", "/api/auth/logout");
await db.end();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
