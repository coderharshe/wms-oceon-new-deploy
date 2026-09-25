// App-shell service worker. Deliberately does NOT touch /api/* requests:
// those carry auth cookies and (for the offline write queue / read cache)
// are handled in JS, not here — a SW-level cache of an API response is a much
// easier place to leak stale or cross-account data than the explicit,
// inspectable IndexedDB layer in offline-catalog.ts / offline-queue.ts.
//
// Pages: a screen reached in-app (F2, Alt+O, a row click) only ever fetches
// its RSC payload, never its HTML, so nothing here would see a document to
// cache. The app therefore asks for its screens to be "warmed" — fetched as
// HTML and stored — see RegisterServiceWorker.tsx. A power cut that restarts
// the PC then reloads straight from this cache.
const CACHE = "taresh-shell-v3";
const NAV_TIMEOUT_MS = 8000;
// "/offline", not "/offline.html": Cloudflare's asset server 307s the .html
// form to the extension-less one, and the Cache API refuses to store a
// redirected response — which is exactly why this was never cached.
const OFFLINE = "/offline";
// /login too: with the internet down, signing in happens on this PC
// (offline-login.ts), and that needs the page to open at all.
const SHELL_URLS = ["/manifest.json", "/icon.svg", OFFLINE, "/login"];
const CORE = ["/finance", "/finance/orders", "/finance/orders/new", "/finance/cash"];
const BILL_PAGE = /^\/finance\/orders\/(?!new$|local$)[^/]+$/;
const MAX_BILL_PAGES = 100;
// Anything under /_next/static that a page's HTML names: <script src>, <link href>, and the
// chunk lists inside the inline flight data (quotes there are escaped, hence the \\).
const STATIC_REF = /(?:\/_next\/|(?<=["'\\]))static\/[\w\-.~%/]+\.(?:js|css|woff2?|ttf|png|jpg|svg|webp|ico)/g;

self.addEventListener("install", (event) => {
  // One at a time, not addAll: addAll is atomic, so a single 404 (a file added
  // by a later build than the one this browser installed from) threw the whole
  // shell away — including offline.html, which left Chrome's error page as the
  // only thing a cashier saw after a power cut.
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

const isRsc = (req, url) => req.headers.get("RSC") === "1" || url.searchParams.has("_rsc");

function staticRefs(html) {
  const out = new Set();
  for (const [m] of html.matchAll(STATIC_REF)) out.add(m.startsWith("/_next/") ? m : "/_next/" + m);
  return out;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // RSC payloads are never cached: offline they must fail fast so Next falls back to a
  // hard navigation, which the cached HTML below can serve.
  if (isRsc(req, url)) return;

  // Hashed build assets never change content under the same URL — cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return res;
      }))
    );
    return;
  }

  // Everything else: network-first so staff always see the latest build when online.
  const navigate = req.mode === "navigate";
  const fromCache = async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(req, { ignoreVary: true })) ?? (await cache.match(req, { ignoreSearch: true, ignoreVary: true }));
  };
  const network = fetch(req)
      .then((res) => {
        // A login redirect (opaqueredirect / redirected) or error page must never be what
        // a reload shows offline; ?print=1 would print again on every offline reload.
        if (res.ok && !res.redirected && res.type === "basic" && !(navigate && url.search)) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return res;
      })
      .catch(async () => {
        const hit = await fromCache();
        if (hit || !navigate) return hit ?? Response.error();
        // A navigation must NEVER end on Chrome's error page: that is a cashier
        // staring at "site can't be reached" with a customer waiting. Prefer the
        // real offline page, and if even that is missing, say it inline.
        return (await caches.match(OFFLINE)) ?? new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 });
      });
  if (!navigate) {
    event.respondWith(network);
    return;
  }
  // "Connected" but passing no data (weak Wi-Fi, a dying hotspot) doesn't fail —
  // it hangs, and a reload spun forever. After NAV_TIMEOUT_MS serve the saved
  // copy if there is one; with none, keep waiting for the network. The network
  // fetch carries on either way and still refreshes the cache.
  event.respondWith(
    Promise.race([
      network,
      new Promise((resolve) => setTimeout(() => fromCache().then((hit) => hit && resolve(hit)), NAV_TIMEOUT_MS)),
    ])
  );
  event.waitUntil(network.catch(() => {}));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "warm" && Array.isArray(event.data.urls)) event.waitUntil(warm(event.data.urls));
});

// Last-resort page when even offline.html never made it into the cache.
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No connection</title><body style="font-family:system-ui,sans-serif;font-weight:700;margin:24px;max-width:28rem">
<h1 style="font-size:18px">This screen isn't saved on this PC</h1>
<p>No internet right now. Bills you already made are safe on this PC and will sync by themselves.</p>
<p><a href="/finance/orders/new">Go to New Order</a> &nbsp; <a href="/finance/orders">Orders</a></p></body>`;

/** Fetches pages as HTML (with the staff cookie) and stores them plus every build asset they name. */
async function warm(urls) {
  const cache = await caches.open(CACHE);
  // Install may have run against a build that didn't serve these yet.
  for (const u of SHELL_URLS) if (!(await cache.match(u))) await cache.add(u).catch(() => {});
  const refs = new Set();
  let allOk = true;
  for (const u of urls) {
    const path = new URL(u, self.location.origin).pathname;
    // Twice: one page timing out (a cold isolate, a slow first render) used to
    // leave that screen uncached until the next page load, and the cashier only
    // finds out during the outage.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
        // Logged out → redirected to /login: never store that under a finance URL.
        if (!res.ok || res.redirected || new URL(res.url).pathname !== path) {
          allOk = false;
          break; // a redirect or a real error won't come good on a retry
        }
        await cache.put(path, res.clone());
        for (const r of staticRefs(await res.text())) refs.add(r);
        break;
      } catch {
        if (attempt) allOk = false;
      }
    }
  }
  for (const r of refs) {
    if (await cache.match(r)) continue;
    try {
      const res = await fetch(r);
      if (res.ok) await cache.put(r, res);
      else allOk = false;
    } catch {
      allOk = false;
    }
  }

  const keys = await cache.keys();
  const bills = keys.filter((k) => BILL_PAGE.test(new URL(k.url).pathname));
  // ponytail: Cache API keys come back in insertion order and put() re-inserts, so the head
  // is the least recently viewed. Good enough for "the last ~100 bills viewed on this PC".
  for (const k of bills.slice(0, Math.max(0, bills.length - MAX_BILL_PAGES))) await cache.delete(k);

  // Old builds' chunks: prune only after a full, successful warm of the core screens, and
  // keep whatever a cached bill page still needs.
  const isCore = urls.length === CORE.length && CORE.every((c) => urls.includes(c));
  if (!isCore || !allOk) return;
  const keep = new Set(refs);
  for (const k of bills.slice(-MAX_BILL_PAGES)) {
    const res = await cache.match(k);
    if (res) for (const r of staticRefs(await res.text())) keep.add(r);
  }
  for (const k of keys) {
    const p = new URL(k.url).pathname;
    // ponytail: fonts are only named inside CSS, not HTML — never pruned (small, content-hashed).
    if (p.startsWith("/_next/static/") && !p.startsWith("/_next/static/media/") && !keep.has(p)) await cache.delete(k);
  }
}
