#!/usr/bin/env node
// Post-deploy smoke check (see docs/CLOUDFLARE_DEPLOY.md "Post-deploy smoke
// check"). Confirms the deploy didn't silently break routing, auth
// middleware, or DB/Hyperdrive connectivity — the kind of failure that's
// invisible in the deploy output itself (two of these shipped in one
// session before this script existed).
//
// Usage: npm run smoke [baseUrl]   (defaults to the primary custom domain —
// pass the workers.dev URL explicitly if you specifically need to check that
// fallback instead)

const baseUrl = process.argv[2] ?? "https://taresh.harshuthecoder.qzz.io";
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}: ${err.message}`);
  }
}

function assertStatus(res, expected, label) {
  if (!expected.includes(res.status)) {
    throw new Error(`expected ${label ?? "status"} in [${expected.join(", ")}], got ${res.status}`);
  }
}

await check("GET /login responds 200", async () => {
  const res = await fetch(`${baseUrl}/login?next=%2F`);
  assertStatus(res, [200]);
});

await check("GET / redirects unauthenticated to /login", async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assertStatus(res, [307, 308]);
  const loc = res.headers.get("location") ?? "";
  if (!loc.includes("/login")) throw new Error(`expected redirect to /login, got "${loc}"`);
});

await check("POST /api/auth/login with bad creds returns 401 (DB reachable)", async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staffId: "__smoke_test__", password: "__smoke_test__" }),
  });
  assertStatus(res, [401]);
});

await check("GET /api/products unauthenticated returns 401 (routing intact)", async () => {
  const res = await fetch(`${baseUrl}/api/products`);
  assertStatus(res, [401]);
});

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed against ${baseUrl} — do not consider this deploy done.`);
  process.exit(1);
}
console.log(`\nAll smoke checks passed against ${baseUrl}.`);
