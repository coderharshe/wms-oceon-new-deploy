# Deploying to Cloudflare

## Architecture

```
                         Cloudflare
   ┌──────────────────────────────────────────────────────┐
   │  admin.<domain>  manager.<domain>  finance.<domain>   │
   │  qc.<domain>     pay.<domain>                         │
   │           │            │            │                │
   │           └────────────┴────────────┘                │
   │                        │                              │
   │                 ONE Worker (wms)                      │
   │        Next.js via @opennextjs/cloudflare              │
   │     middleware.ts routes each subdomain to its         │
   │         portal — same code as local dev                │
   │                        │                              │
   │   ┌───────────┬────────┼────────┬───────────┐          │
   │   │           │        │        │           │          │
   │ Hyperdrive  R2 (FILES) KV    Durable Object │          │
   │   │        R2 (cache)  (CACHE_KV) (RealtimeHub)        │
   └───┼──────────────────────────────────────────┘─────────┘
       │
   Neon Postgres (external — Hyperdrive proxies to it)
```

One Worker serves all five portals — **not** five separate Workers. Per the
PRD's own §47 ("don't build five independent systems") and to keep cost and
complexity down: one build, one deploy, five custom-domain routes pointing
at the same script. `middleware.ts` already does the host → portal routing
(unchanged from local dev).

## Why Hyperdrive + external Postgres, not D1

D1 is SQLite. This schema needs real Postgres:
- **`Decimal` columns** for every money/quantity field (bills, payments,
  inventory) — SQLite has no native fixed-point decimal type; representing
  money as floats or manually-scaled integers would mean rewriting the whole
  data layer and is a real correctness risk for a billing system.
- **`SELECT ... FOR UPDATE` row locks** for concurrency-safe stock deduction
  (PRD §37 explicitly requires this) — D1 doesn't support row-level locking.
- **Multi-step interactive transactions** (`db.$transaction(async tx => …)`
  spanning several dependent queries) in the QC-completion and payment flows
  — D1's transaction model doesn't support this shape.

D1 isn't used anywhere in this app. KV and Durable Objects are used, but
only for what the brief scoped them to (cache, realtime coordination) — never
as the system of record.

## Why Neon for Postgres

Cloudflare has no managed Postgres of its own. Neon is Cloudflare's own
documented Hyperdrive pairing, has a real free tier, and isn't AWS, Vercel,
or Supabase. Any standard Postgres works the same way — swap the connection
string if you'd rather point Hyperdrive at something else you already run.

## One-time setup

Prerequisites: a Cloudflare account, a domain added to Cloudflare DNS, a
Neon (or other Postgres) database, and `wrangler login` run in an
interactive terminal (or a `CLOUDFLARE_API_TOKEN` env var).

```bash
# 1. Auth (interactive OAuth — run this yourself, not scriptable)
npx wrangler login

# 2. Create the KV namespace, note the returned id
npx wrangler kv namespace create CACHE_KV
# → paste the id into wrangler.jsonc's kv_namespaces[0].id

# 3. Create the two R2 buckets (names must match wrangler.jsonc)
npx wrangler r2 bucket create wms-opennext-cache
npx wrangler r2 bucket create wms-files

# 4. Create the Hyperdrive config, pointed at your Neon connection string
npx wrangler hyperdrive create wms-db \
  --connection-string="postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require"
# → paste the returned id into wrangler.jsonc's hyperdrive[0].id

# 5. Run migrations directly against Neon (Hyperdrive is a runtime proxy for
#    the Worker only — `prisma migrate` talks to Postgres directly). Use
#    `npm run db:deploy`, not a bare `prisma migrate deploy` — it also runs
#    `drizzle-kit introspect` afterward, which src/generated/drizzle needs
#    every time the schema changes (it's a point-in-time snapshot, not
#    something Prisma's migration keeps in sync on its own).
DATABASE_URL="postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require" \
  npm run db:deploy
DATABASE_URL="postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require" \
  npx tsx prisma/seed.ts   # optional: sample data

# 6. Secrets (never committed — these prompt for a value)
npx wrangler secret put JWT_SECRET        # long random string
npx wrangler secret put COOKIE_DOMAIN     # e.g. ".yourdomain.com" (leading dot — shares login across all 5 subdomains)
npx wrangler secret put BUSINESS_NAME     # shown on payment display + UPI QR
npx wrangler secret put UPI_VPA           # your UPI payment address

# 7. Build + deploy
npm run cf:deploy

# 8. Post-deploy smoke check — run every time, not optional. Confirms
#    routing, auth middleware, and DB/Hyperdrive connectivity all actually
#    work post-deploy; two prod-breaking bugs (cookie domain, workers.dev
#    route silently disabled) shipped in one session before this existed,
#    and neither showed up in the deploy output itself.
npm run smoke
```

A deploy isn't done until step 8 passes. If it fails, the deploy is live and
broken — fix forward or roll back via `wrangler rollback` before doing
anything else.

## Custom domains

In the Cloudflare dashboard (Workers & Pages → wms → Settings → Domains &
Routes), add a custom domain route for each:

```
admin.yourdomain.com    → wms
manager.yourdomain.com  → wms
finance.yourdomain.com  → wms
qc.yourdomain.com       → wms
pay.yourdomain.com      → wms
```

Cloudflare issues and manages TLS for each automatically once the route is
added (no separate cert step). `COOKIE_DOMAIN=".yourdomain.com"` (set in
step 6 above) is what makes one login work across all five.

## Rate limiting

Cloudflare's own WAF rate-limiting rules (Security → WAF → Rate limiting
rules in the dashboard) are the right tool for this, not custom in-app
counters — apply one to `/api/auth/login` (e.g. 5 requests/minute per IP) to
cover brute-force attempts. This is a dashboard step, not something this
codebase can configure for you without your account.

## Cost shape

At the traffic this app actually sees (a handful of staff per warehouse):
Workers, KV reads, and Durable Object requests all fall well inside
Cloudflare's free tier. R2 has no egress fee and the storage here (product
photos, a handful of invoice/backup JSON files) is tiny. Neon's free tier
covers a single small Postgres instance. The realistic non-zero cost is
Hyperdrive, which is free on Cloudflare's side — the only recurring cost is
whatever Neon charges past its free tier as data grows.

## Verification status

**Prisma's query engine cannot run on Workers at all** — confirmed as a
genuine platform limitation, not a config problem: even the WASM ("client")
engine variant hits `CompileError: WebAssembly.Module(): Wasm code
generation disallowed by embedder` — Workers isolates block dynamic
`WebAssembly.Module()` compilation outright, and there's no compatibility
flag that lifts it (Prisma issue #28657, still open). Cloudflare's own
Hyperdrive docs list `pg`/`postgres.js`/Drizzle/Kysely as supported drivers
and notably don't list Prisma.

Fix: **two parallel query layers against the same schema/database**, chosen
per-request by [`isWorkersRuntime()`](../src/lib/cf-env.ts):
- Prisma (`src/generated/prisma`, via `src/lib/db.ts`) — used for local
  `next dev` and scripts. Untouched, still the source of truth for
  migrations (`prisma/schema.prisma`).
- Drizzle (`src/generated/drizzle`, introspected from the same Postgres DB
  via `drizzle-kit introspect`, via `src/lib/drizzle-db.ts`) — used when
  running as the deployed Worker. Every route and shared service
  (`src/lib/drizzle-*.ts`) has a Drizzle equivalent of its Prisma
  counterpart, reached via a runtime `await import(...)` so the Prisma
  client module is never even loaded on Workers (importing it eagerly
  triggers the same WASM error, independent of whether it's called).

All ~40 API routes are ported and this was **verified live against the
deployed Worker** (`https://wms.shpstack.workers.dev`), not just
statically — the full PRD business flow, run end-to-end with real HTTP
requests after every role's login:

1. Finance: create an order (reservation transaction — locks/reserves
   stock, generates order + bill + payment rows atomically), collect full
   cash payment.
2. Finance: send to QC.
3. QC: start session, reduce a line's quantity with a reason — this
   exceeded the seeded QC restriction rule and correctly came back
   `202 APPROVAL_REQUIRED` instead of silently applying.
4. Manager: see it on `/api/manager/approvals`, approve it.
5. QC: re-run complete — bill revalued (5 units → 3, retail price,
   including tax), order moved to `REFUND_REQUIRED`, payment to
   `REFUND_DUE`.
6. Finance: resolve the refund adjustment as `CASH_REFUND`.
7. Admin: inventory report confirms stock was deducted by the *final* QC
   quantity (3), not the original (5), and a second untouched order's
   reservation was left intact — proves the row-locked
   reserve/finalize-deduct path is correct through Drizzle too.
8. Finance: open a cash/EOD session, close it, expected-vs-actual
   reconciliation came back `0.00` difference.

Two real bugs were found and fixed by this live run (neither was visible
from `tsc`/build — both are Workers-runtime-only failure modes):

- **Hanging requests**: `getDrizzleDb()` originally cached its `pg.Pool` on
  `globalThis`, reused across requests — but a Workers isolate can recycle
  the underlying socket between invocations without the cached `Pool`
  object knowing, so a later query on it hangs until the platform kills the
  request (`"the Workers runtime canceled this request because ... your
  Worker's code had hung"`, error code 1101). Fixed: no caching when
  `isWorkersRuntime()` — a fresh `Pool` per request. Hyperdrive is the real
  connection pooler on Cloudflare's side, so this costs nothing extra; local
  dev (long-lived Node process, no isolate recycling) still caches as
  before.
- **Stale reads immediately after writes**: Hyperdrive caches `SELECT`
  results by default. A write on one connection followed by a read on
  another (the normal case once the Pool isn't cached — see above) could
  return a pre-write result. Fixed by disabling caching on the Hyperdrive
  config: `wrangler hyperdrive update <id> --caching-disabled`. This is a
  one-time config change on the Hyperdrive resource itself, not something
  redeploying the Worker affects.

Not yet exercised live: the SSE/Durable Object realtime path (payment
display auto-update) and R2 invoice/backup generation — these use the same
Drizzle read pattern as everything else that's now confirmed working, but
should still get a manual pass before relying on them in production.
