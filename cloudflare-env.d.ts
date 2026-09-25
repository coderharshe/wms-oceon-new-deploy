// Merges our own bindings (declared in wrangler.jsonc) into OpenNext's
// global CloudflareEnv interface so getCloudflareContext().env is typed.
//
// Hand-rolled minimal shapes for exactly what this app calls, rather than
// `@cloudflare/workers-types` — that package is one all-or-nothing global
// .d.ts with no scoped export path, so pulling in R2Bucket/KVNamespace also
// redefines fetch/Response/ReadableStream project-wide (Workers' Response
// is typed stricter, e.g. `.json(): Promise<unknown>` not `Promise<any>`),
// breaking every client page's plain `.then(r => r.json())`. These few
// interfaces are stable, well-known platform shapes — worth hand-declaring
// to avoid that blast radius. Swap for the real package's types wholesale
// only if this app ever needs a much larger slice of the Workers API.
//
// Not importing RealtimeHub's own type here (it would create a circular
// reference: realtime-hub.ts needs this file's `cloudflare:workers` module
// declaration to type-check its own import) — DurableObjectNamespace stays
// untyped-generic, which costs a little precision but nothing functional.
declare global {
  interface R2Object {
    key: string;
    size: number;
    uploaded: Date;
    httpEtag: string;
    httpMetadata?: { contentType?: string };
  }
  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }
  interface R2Bucket {
    put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
      options?: { httpMetadata?: { contentType?: string } }
    ): Promise<R2Object>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2Object[] }>;
  }

  interface KVNamespace {
    get(key: string, type?: "text"): Promise<string | null>;
    get<T>(key: string, type: "json"): Promise<T | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  }

  interface DurableObjectId {
    toString(): string;
  }
  interface DurableObjectStub {
    fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  }
  interface DurableObjectNamespace<_T = unknown> {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }
  interface DurableObjectState {
    id: DurableObjectId;
  }

  // Passed to the `scheduled` handler in worker.ts (Cron Triggers — see
  // wrangler.jsonc's `triggers.crons`); only the fields that handler reads.
  interface ScheduledEvent {
    cron: string;
    scheduledTime: number;
  }

  interface CloudflareEnv {
    HYPERDRIVE: { connectionString: string };
    FILES: R2Bucket;
    CACHE_KV: KVNamespace;
    REALTIME_HUB: DurableObjectNamespace;
    EMAIL: { send(message: import("cloudflare:email").EmailMessage): Promise<void> };
    JWT_SECRET: string;
    BUSINESS_NAME: string;
    UPI_VPA: string;
    COOKIE_DOMAIN?: string;
  }
}

// The `send_email` binding's message class — a Cloudflare-provided runtime
// module, not an npm package, so it needs its own declaration same as the
// platform interfaces above.
declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
  }
}

export {};
