// Ambient declaration for the `cloudflare:workers` built-in module (real
// implementation is provided by workerd/wrangler at runtime). Kept in its
// own standalone, import-free file — TypeScript only reliably resolves an
// ambient `declare module "specifier"` block from a pure global-script
// file, not one that also has its own top-level imports/exports.
declare module "cloudflare:workers" {
  export class DurableObject<Env = CloudflareEnv> {
    constructor(state: DurableObjectState, env: Env);
  }
}
