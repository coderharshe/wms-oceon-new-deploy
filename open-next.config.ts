import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// Most pages here are per-request/dynamic (auth-gated portals, live order
// data) — the R2 incremental cache only matters for the handful of static
// bits (login page shell, etc.), but it's free to enable and keeps cold
// static requests off the Worker entirely.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
