// Local read-cache for product/customer/unit lookups — the reference data
// every search box on Finance/QC screens hits. Stale-while-revalidate: read
// whatever's cached instantly, kick a background refresh, never block the
// screen on the network. Native IndexedDB — one small object per store,
// not worth a dependency for.
import { matchesWordStarts } from "./word-search";

const DB_NAME = "taresh-offline";
// 2 added "bills", 3 added "outbox" + "localBills" (offline-bills.ts). ONE
// opener for every module: offline-queue.ts used to open this same database
// at version 1 while this file opened it at 2, and opening at a lower
// version than the one on disk throws VersionError — the outbox silently
// stopped working the moment the bill cache existed.
const DB_VERSION = 3;
const STORES = ["products", "customers", "units"] as const;
const REFRESH_MAX_AGE_MS = 24 * 60 * 60 * 1000; // "daily data" — see meta.syncedAt

export type CachedProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  wholesalePrice: string;
  retailPrice: string;
  taxPercent: string;
  baseUnit: { id: string; symbol: string } | null;
  saleUnits: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: string; wholesalePrice: string | null; retailPrice: string | null; unit: { id: string; symbol: string } }[];
};
export type CachedCustomer = { id: string; shopName: string; ownerName: string | null; mobile: string | null; type: "WHOLESALE" | "RETAIL" };
export type CachedUnit = { id: string; symbol: string; name: string };

// One shared connection per tab, not one per read — every open used to leak
// a connection, and each open one blocks the next version upgrade.
let dbPromise: Promise<IDBDatabase> | null = null;

export function openOfflineDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains(BILL_STORE)) db.createObjectStore(BILL_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("localBills")) db.createObjectStore("localBills", { keyPath: "requestId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer deploy in another tab wants to upgrade: step aside instead of
      // blocking it, and reopen at the new version on the next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Another tab still holding the previous DB version blocks the upgrade.
    // Without this the promise never settles and every cache read hangs
    // forever instead of falling back to the network.
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  }).catch((err) => {
    dbPromise = null; // try again next call rather than caching the failure
    throw err;
  });
  return dbPromise;
}

async function replaceAll<T extends { id: string }>(storeName: (typeof STORES)[number], rows: T[]) {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    for (const row of rows) tx.objectStore(storeName).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAll<T>(storeName: (typeof STORES)[number]): Promise<T[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function getMeta(key: string): Promise<string | undefined> {
  const db = await openOfflineDb().catch(() => null);
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction("meta", "readonly").objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => resolve(undefined);
  });
}

async function setMeta(key: string, value: string) {
  const db = await openOfflineDb().catch(() => null);
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Fetches the full catalog and replaces the local cache. Throws if offline/failed — callers already have last-known-good data to fall back on. */
export async function refreshCatalog(): Promise<void> {
  const res = await fetch("/api/sync/catalog");
  if (!res.ok) throw new Error("Catalog sync failed");
  const data = await res.json();
  await Promise.all([replaceAll("products", data.products), replaceAll("customers", data.customers), replaceAll("units", data.units)]);
  await setMeta("syncedAt", data.syncedAt ?? new Date().toISOString());
}

/** Stale-while-revalidate entry point: call on mount. Resolves fast (cache or, if empty, waits on one fetch); refreshes in the background otherwise, then calls onRefreshed. */
export async function ensureFreshCatalog(onRefreshed?: () => void): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const syncedAt = await getMeta("syncedAt");
    const isStale = !syncedAt || Date.now() - new Date(syncedAt).getTime() > REFRESH_MAX_AGE_MS;
    if (isStale) {
      await refreshCatalog().catch(() => {}); // offline with nothing cached yet — screens just fall back to live search
    } else {
      refreshCatalog().then(onRefreshed, () => {}); // have something to show already — refresh quietly, don't block, re-read after
    }
  } catch {
    // Cache unavailable (blocked upgrade, private mode, quota). Screens fall
    // back to live search — degraded, never broken.
  }
}

export async function getCachedProducts(): Promise<CachedProduct[]> {
  if (typeof indexedDB === "undefined") return [];
  return readAll<CachedProduct>("products").catch(() => []);
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  if (typeof indexedDB === "undefined") return [];
  return readAll<CachedCustomer>("customers").catch(() => []);
}

export async function getCachedUnits(): Promise<CachedUnit[]> {
  if (typeof indexedDB === "undefined") return [];
  return readAll<CachedUnit>("units").catch(() => []);
}

/**
 * What a search box shows once the live result lands: the rows already on
 * screen, in their places, carrying whatever the server knows about them —
 * plus anything the server found that wasn't shown yet, appended.
 *
 * Nothing is ever reordered or removed mid-search. The cashier picks a row
 * inside a second, so a list that rearranges itself 150ms after appearing
 * bills whatever slid under their finger. The two sources disagree by design
 * (the cache matches SKU by substring across the whole catalogue, the server
 * caps at 50 rows in its own collation and can be a day ahead of the cache),
 * and that disagreement must never reach the screen as movement.
 *
 * Stock is the one thing only the live row carries, which is why live wins
 * per row — it is the field that must never be served from yesterday's cache.
 */
export function mergeLiveResults<T extends { id: string }>(shown: T[], live: T[]): T[] {
  if (shown.length === 0 || live.length === 0) return shown.length === 0 ? live : shown;
  const byId = new Map(live.map((r) => [r.id, r]));
  const seen = new Set(shown.map((r) => r.id));
  return [...shown.map((r) => byId.get(r.id) ?? r), ...live.filter((r) => !seen.has(r.id))];
}

/**
 * One search box's rows, and what they were typed for. The dropdown keeps
 * this instead of a bare array so a paint that belongs to older text, or a
 * second cache paint, can't move rows the cashier is already pointing at.
 */
export type Painted<T> = { q: string; rows: T[] };

/**
 * Apply one paint. New text starts a fresh list; anything landing for the
 * text still in the box merges into what is on screen (mergeLiveResults).
 *
 * `fromCache` marks the instant paint off the local catalogue. It only ever
 * starts a list: once rows are up, a cache that finishes loading (or a
 * background refresh landing mid-search) must not repaint them — its rows
 * carry no stock and would blank what the live reply just filled in.
 */
export function paintResults<T extends { id: string }>(prev: Painted<T>, q: string, rows: T[], fromCache = false): Painted<T> {
  const sameQuery = prev.q === q;
  if (sameQuery && fromCache) return prev;
  return { q, rows: mergeLiveResults(sameQuery ? prev.rows : [], rows) };
}

/** Same page size as /api/products, so the cache and the live list truncate alike. */
export const SEARCH_LIMIT = 50;

export function searchProducts(products: CachedProduct[], q: string): CachedProduct[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return rankProducts(
    products.filter((p) => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query) || p.barcode === q || matchesWordStarts(p.name, query)),
    q
  ).slice(0, SEARCH_LIMIT);
}

/**
 * The one product order, applied to the cache AND to /api/products' rows, so
 * both paint identically whatever order Postgres sent. Ranked, each group A-Z:
 *  0 name starts with the query   ("c" -> Coke before Amul Chocolate)
 *  1 every part starts a word     ("c c 2" -> Coke Can 2L), see word-search.ts
 *  2 the text appears anywhere    ("ola" -> Coca Cola, a partial SKU, a barcode)
 * Ties on an identical name fall back to id — a stable sort would otherwise
 * keep each source's arrival order, which is exactly what differs.
 */
export function rankProducts<T extends { id: string; name: string }>(products: T[], q: string): T[] {
  const query = q.trim().toLowerCase();
  const rank = (p: T) => (p.name.toLowerCase().startsWith(query) ? 0 : matchesWordStarts(p.name, query) ? 1 : 2);
  return [...products].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function searchCustomers(customers: CachedCustomer[], q: string): CachedCustomer[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return customers
    .filter((c) => c.shopName.toLowerCase().includes(query) || (c.mobile ?? "").includes(query) || (c.ownerName ?? "").toLowerCase().includes(query))
    .slice(0, 25);
}


// ── Bill snapshots ───────────────────────────────────────────────────────
// A bill Finance has already opened once should never make them wait again.
// The order-detail response is stashed here on every successful load, so
// reopening (to reprint, or to check what was billed) paints from disk
// instantly while the live copy revalidates behind it.
//
// Deliberately a *display* cache only: quantities and totals are safe to
// paint stale, but a cached amountDue/amountPaid must never drive a payment
// decision — the detail page keeps the Collect buttons disabled until the
// fresh copy lands. See src/app/finance/orders/[id]/page.tsx.
const BILL_STORE = "bills";
const BILL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function cacheOrderDetail(id: string, data: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(BILL_STORE, "readwrite");
    const store = tx.objectStore(BILL_STORE);
    store.put({ id, cachedAt: Date.now(), data });
    // ponytail: prune by age on write, no LRU — a week of bills is a few MB
    // against IndexedDB's hundreds. Swap in a count cap if that stops holding.
    const cutoff = Date.now() - BILL_MAX_AGE_MS;
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) return;
      if ((cur.value?.cachedAt ?? 0) < cutoff) cur.delete();
      cur.continue();
    };
  } catch {
    /* best-effort cache — never let it break the page */
  }
}

export async function getCachedOrderDetail<T>(id: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openOfflineDb();
    return await new Promise<T | null>((resolve) => {
      const req = db.transaction(BILL_STORE, "readonly").objectStore(BILL_STORE).get(id);
      req.onsuccess = () => resolve((req.result?.data as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// ── Entries that aren't on the server yet ────────────────────────────────
// A half-built bill, a half-counted GRN, a half-checked QC sheet: each one is
// work that exists nowhere but the screen it was typed on. A reload, a crash,
// a tab closed by a stray Ctrl+W, a tablet that went to sleep — all of them
// used to throw it away, with a queue standing at the counter.
//
// localStorage, not IndexedDB: it is synchronous, so the entries are written
// before the crash rather than in a transaction that never commits, and they
// are readable on the very next render after a reload. Keyed per screen (and
// per order, where a screen is about one), so two of them never collide.
export const ENTRY_KEYS = {
  newOrder: "entries:new-order",
  // Bills parked with Alt+N while another customer is served — see New Order.
  heldBills: "entries:held-bills",
  receiveStock: "entries:receive-stock",
  qc: (orderId: string) => `entries:qc:${orderId}`,
} as const;

// Old enough to be yesterday's abandoned work rather than this morning's
// interrupted work. A shift is the unit that matters here, not a day.
export const ENTRY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function saveEntry(key: string, data: object): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // Out of quota, private mode, storage blocked: what is on screen still
    // works, it just won't survive a reload. Never worth an error in front of
    // a customer.
  }
}

export function clearEntry(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing saved is the state we wanted anyway */
  }
}

/**
 * What was typed and never submitted, or null if there isn't a usable copy.
 * Anything unreadable or older than a shift is dropped rather than handed
 * back — yesterday's bill reappearing under today's customer is worse than no
 * recovery at all.
 */
export function readEntry<T extends object>(key: string, now = Date.now()): (T & { savedAt: number }) | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as T & { savedAt?: number };
    if (!saved || typeof saved.savedAt !== "number" || now - saved.savedAt > ENTRY_MAX_AGE_MS) {
      clearEntry(key);
      return null;
    }
    return saved as T & { savedAt: number };
  } catch {
    clearEntry(key);
    return null;
  }
}
