// Custom Worker entry: wraps OpenNext's generated handler and additionally
// exports RealtimeHub as a named export, which workerd/wrangler require for
// any class referenced by a durable_objects binding in wrangler.jsonc — the
// plain `.open-next/worker.js` entry only exports the Next.js app handler,
// so a hand-written DO class has to be re-exported through a wrapper like
// this one (see https://opennext.js.org/cloudflare/howtos/custom-worker).
import handler from "./.open-next/worker.js";

export { RealtimeHub } from "./src/lib/realtime-hub";

const BACKUP_RETENTION_DAYS = 30;

// Daily backup (see wrangler.jsonc's `triggers.crons`). A cron invocation
// has no HTTP request, so it can't use getCloudflareContext() (that reads
// from request-scoped storage the fetch handler sets up) — it gets `env`
// directly instead, so this builds its own Drizzle client and writes to R2
// without going through the Next.js route layer at all.
async function runScheduledBackup(env: CloudflareEnv) {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("./src/generated/drizzle/schema");
  const relations = await import("./src/generated/drizzle/relations");
  const { buildBackupDump } = await import("./src/lib/drizzle-backup");

  const db = drizzle(new Pool({ connectionString: env.HYPERDRIVE.connectionString }), { schema: { ...schema, ...relations } });
  const dump = await buildBackupDump(db);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await env.FILES.put(`backups/${timestamp}.json`, JSON.stringify({ exportedAt: timestamp, ...dump }, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  // ponytail: full list + filter each run (cheap at this object count) —
  // revisit only if the backups/ prefix ever grows into the thousands.
  const { objects } = await env.FILES.list({ prefix: "backups/" });
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await Promise.all(objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => env.FILES.delete(o.key)));
}

// H-1/H-2 from the go-live manifest, unified into one mechanism: a failing
// health check IS the signal something's broken, so this covers "the app is
// down" and "the app is erroring" without wiring per-route error capture
// (a bigger, separate lift — this won't catch one request 500ing while
// everything else works). Emails once on down, once on recovery — not every
// 5 minutes — by tracking state in CACHE_KV.
const HEALTH_CHECK_URL = "https://taresh.harshuthecoder.qzz.io/login";
const HEALTH_DOWN_KV_KEY = "healthcheck:down";
const ALERT_FROM = "alerts@harshuthecoder.qzz.io"; // just needs to be on a domain Email Routing owns
const ALERT_TO = "shpstack@gmail.com"; // must be a verified Email Routing destination address

// `cloudflare:email` only resolves here (worker.ts, bundled directly by
// wrangler/esbuild for workerd) — a Next.js route handler bundled through
// OpenNext's webpack build fails on this import, since that build doesn't
// externalize it the way it does e.g. `cloudflare:workers`. Confirmed the
// hard way: a route-based version of this failed `next build` outright.
async function sendAlertEmail(env: CloudflareEnv, subject: string, body: string) {
  const { EmailMessage } = await import("cloudflare:email");
  const { createMimeMessage } = await import("mimetext");
  const msg = createMimeMessage();
  msg.setSender({ name: "WMS Alerts", addr: ALERT_FROM });
  msg.setRecipient(ALERT_TO);
  msg.setSubject(subject);
  msg.addMessage({ contentType: "text/plain", data: body });
  await env.EMAIL.send(new EmailMessage(ALERT_FROM, ALERT_TO, msg.asRaw()));
}

async function runHealthCheck(env: CloudflareEnv) {
  let healthy = false;
  let detail = "";
  try {
    const res = await fetch(HEALTH_CHECK_URL, { redirect: "manual" });
    healthy = res.status === 200;
    detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }

  const wasDown = (await env.CACHE_KV.get(HEALTH_DOWN_KV_KEY)) !== null;
  const now = new Date().toISOString();
  console.log(`health check: ${healthy ? "ok" : "FAIL"} (${detail})`);

  if (!healthy && !wasDown) {
    await env.CACHE_KV.put(HEALTH_DOWN_KV_KEY, "1", { expirationTtl: 1800 });
    await sendAlertEmail(env, "WMS is DOWN", `Health check against ${HEALTH_CHECK_URL} failed: ${detail}\n\nTime: ${now}`);
  } else if (healthy && wasDown) {
    await env.CACHE_KV.delete(HEALTH_DOWN_KV_KEY);
    await sendAlertEmail(env, "WMS has RECOVERED", `Health check against ${HEALTH_CHECK_URL} is passing again.\n\nTime: ${now}`);
  } else if (!healthy && wasDown) {
    // Still down — refresh the TTL so the down-flag doesn't quietly expire
    // mid-outage (which would fire a spurious "recovered" on the next
    // success), but don't re-send the email itself.
    await env.CACHE_KV.put(HEALTH_DOWN_KV_KEY, "1", { expirationTtl: 1800 });
  }
}

const HEALTH_CHECK_CRON = "*/5 * * * *";

export default {
  fetch: handler.fetch,
  async scheduled(event: ScheduledEvent, env: CloudflareEnv) {
    if (event.cron === HEALTH_CHECK_CRON) {
      await runHealthCheck(env);
    } else {
      await runScheduledBackup(env);
    }
  },
};
