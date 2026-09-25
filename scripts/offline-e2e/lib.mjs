// Shared plumbing for the offline billing browser suite (run.mjs).
// Real Chrome (channel "chrome"), a persistent profile so IndexedDB and the
// service worker survive a "power cut" (closing and relaunching the browser),
// and the LOCAL Docker Postgres for verification. Never point it at Neon.
import { chromium } from "playwright-core";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const DB_URL = process.env.DATABASE_URL_E2E ?? "postgresql://wms:wms@localhost:5432/wms";
if (!/localhost|127\.0\.0\.1/.test(DB_URL) || !/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("refusing to run against anything but localhost");
export const PROFILE = process.env.E2E_PROFILE ?? path.join(os.tmpdir(), "wms-offline-e2e-profile");
// Chrome on Windows: a long profile path silently breaks CacheStorage ("Entry already exists"), so the
// service worker never installs and every offline reload looks broken. Keep it short.
if (PROFILE.length > 60) console.warn(`E2E_PROFILE is ${PROFILE.length} chars — Chrome CacheStorage fails on long Windows paths; the service worker won't install`);

pg.types.setTypeParser(1114, (s) => new Date(s.replace(" ", "T") + "Z")); // timestamp(3) columns hold UTC
export const db = new pg.Client({ connectionString: DB_URL });
export const sql = async (q, v) => (await db.query(q, v)).rows;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log("   ", ...a);
export function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
export async function waitFor(fn, { timeout = 30_000, every = 250, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

// ── browser ──────────────────────────────────────────────────────────────
export const prints = []; // { html, url, at }

export async function launch({ fresh = false } = {}) {
  if (fresh) fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: process.env.HEADED ? false : true,
    viewport: { width: 1400, height: 900 },
    baseURL: BASE,
  });
  // window.print from any frame (the provisional slip's srcdoc iframe, the
  // server invoice iframe) is recorded instead of opening a dialog.
  await ctx.exposeBinding("__e2eRecordPrint", (_src, html, url) => void prints.push({ html, url, at: Date.now() }));
  await ctx.addInitScript(() => {
    // Harness only: while the flag is set the page believes it is offline even
    // when the network is up, so a workaround page load can't start a sync.
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine").get;
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get() {
        try {
          if (localStorage.getItem("__e2e_fake_offline") === "1") return false;
        } catch {}
        return real.call(this);
      },
    });
    window.print = () => {
      try {
        window.__e2eRecordPrint(document.documentElement.outerHTML, location.href);
      } catch {}
    };
  });
  return ctx;
}

/** Signs FIN-1 (or another) in through the context's cookie jar; takes over an old session when needed. */
export const STAFF = process.env.E2E_STAFF ?? "FIN-1";
export const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
export const STAFF_CODE = STAFF.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16) || "PC"; // = staffCode() in src/lib/offline-bills.ts
export async function login(ctx, staffId = STAFF) {
  const creds = { staffId, password: PASSWORD };
  // Still signed in from the last run (persistent profile): don't start a takeover.
  const me = await ctx.request.get("/api/finance/print-settings").catch(() => null);
  if (me?.ok()) return;
  let res = await ctx.request.post("/api/auth/login", { data: creds });
  if (res.status() === 409) {
    const t = await (await ctx.request.post("/api/auth/login/takeover", { data: creds })).json();
    log(`${staffId} logged in elsewhere — taking over (~20s)`);
    await sleep(Math.max(0, t.expiresAt - Date.now()) + 1000);
    res = await ctx.request.post("/api/auth/login/takeover-status", { data: { takeoverId: t.takeoverId, secret: t.secret } });
  }
  expect(res.ok(), `login ${staffId}: ${res.status()} ${await res.text()}`);
}

/** A separate cookie jar (plain fetch) for MGR-1 API calls, so FIN-1's browser session is untouched. */
export async function apiSession(staffId) {
  const post = (p, body, cookie) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const creds = { staffId, password: "password123" };
  let res = await post("/api/auth/login", creds);
  if (res.status === 409) {
    const t = await (await post("/api/auth/login/takeover", creds)).json();
    await sleep(Math.max(0, t.expiresAt - Date.now()) + 1000);
    res = await post("/api/auth/login/takeover-status", { takeoverId: t.takeoverId, secret: t.secret });
  }
  expect(res.ok, `login ${staffId}: ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: r.status, json };
  };
}

export const fakeOffline = (page, on) =>
  page.evaluate((on) => (on ? localStorage.setItem("__e2e_fake_offline", "1") : localStorage.removeItem("__e2e_fake_offline")), on).catch(() => {});

// ── IndexedDB from the page (opens whatever version is on disk) ─────────
export const idb = {
  all: (page, store) =>
    page.evaluate(
      (store) =>
        new Promise((res, rej) => {
          const r = indexedDB.open("taresh-offline");
          r.onsuccess = () => {
            const d = r.result;
            if (!d.objectStoreNames.contains(store)) return d.close(), res([]);
            const g = d.transaction(store).objectStore(store).getAll();
            g.onsuccess = () => (d.close(), res(g.result));
            g.onerror = () => rej(g.error);
          };
          r.onerror = () => rej(r.error);
        }),
      store
    ),
  put: (page, store, value) =>
    page.evaluate(
      ([store, value]) =>
        new Promise((res, rej) => {
          const r = indexedDB.open("taresh-offline");
          r.onsuccess = () => {
            const d = r.result;
            const t = d.transaction(store, "readwrite");
            t.objectStore(store).put(value);
            t.oncomplete = () => (d.close(), res());
            t.onerror = () => rej(t.error);
          };
        }),
      [store, value]
    ),
  clear: (page, stores) =>
    page.evaluate(
      (stores) =>
        new Promise((res) => {
          const r = indexedDB.open("taresh-offline");
          r.onsuccess = () => {
            const d = r.result;
            const have = stores.filter((s) => d.objectStoreNames.contains(s));
            if (!have.length) return d.close(), res();
            const t = d.transaction(have, "readwrite");
            have.forEach((s) => t.objectStore(s).clear());
            t.oncomplete = () => (d.close(), res());
          };
          r.onerror = () => res();
        }),
      stores
    ),
};

/** Local bills made since `sinceIso`, oldest first. */
export async function localBillsSince(page, sinceIso) {
  return (await idb.all(page, "localBills")).filter((b) => b.billedAt >= sinceIso).sort((a, b) => a.billedAt.localeCompare(b.billedAt));
}

// ── UI ───────────────────────────────────────────────────────────────────
export async function headerText(page) {
  return page
    .locator("button", { hasText: /Synced ✓|Waiting to sync|Needs attention/ })
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "");
}

/** Keyboard-only bill on /finance/orders/new. Assumes the page is already open and idle. */
export async function keyboardBill(page, { name, product = "0 hell can", productName = "0 HELL CAN", qty = "3", submit = true }) {
  await page.getByRole("button", { name: /Generate Bill/ }).waitFor();
  await page.keyboard.press("Alt+E");
  await page.keyboard.type(name);
  await page.keyboard.press("F5");
  await page.keyboard.type(product);
  await page.locator('[role="option"]', { hasText: productName }).first().waitFor({ timeout: 15_000 });
  await sleep(400); // live results replace cached ones; let the list settle
  const top = await page.locator('[role="option"][aria-selected="true"]').first().innerText();
  expect(top.startsWith(productName), `highlighted product is "${top}", wanted ${productName}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type(qty);
  await page.keyboard.press("Enter");
  if (submit) await page.keyboard.press("F10");
}

export async function sqlForRequestIds(ids) {
  return sql(
    `SELECT o.id, o."clientRequestId", o."offlineRef", o."orderNumber", o."createdAt" oc, o."needsReview", o."reviewNotes",
            b.id bill_id, b."billNumber", b."createdAt" bc, b."currentVersion",
            (SELECT count(*)::int FROM "BillVersion" v WHERE v."billId" = b.id) versions,
            (SELECT min(v."createdAt") FROM "BillVersion" v WHERE v."billId" = b.id) vc,
            (SELECT count(*)::int FROM "Payment" p WHERE p."billId" = b.id) payments,
            (SELECT p."amountDue"::float FROM "Payment" p WHERE p."billId" = b.id LIMIT 1) due,
            (SELECT p."amountPaid"::float FROM "Payment" p WHERE p."billId" = b.id LIMIT 1) paid,
            (SELECT count(*)::int FROM "PaymentTransaction" t JOIN "Payment" p ON p.id = t."paymentId" WHERE p."billId" = b.id) txns,
            (SELECT json_agg(json_build_object('amount', t.amount::float, 'received', t."amountReceived"::float, 'clickedAt', t."clickedAt", 'ts', t.timestamp)) FROM "PaymentTransaction" t JOIN "Payment" p ON p.id = t."paymentId" WHERE p."billId" = b.id) txn_rows,
            (SELECT json_agg(json_build_object('qty', i.quantity::float, 'price', i."unitPrice"::float)) FROM "OrderItem" i WHERE i."orderId" = o.id) items
     FROM "Order" o LEFT JOIN "Bill" b ON b."orderId" = o.id
     WHERE o."clientRequestId" = ANY($1) ORDER BY o."createdAt"`,
    [ids]
  );
}

export const istYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
