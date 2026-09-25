import { DurableObject } from "cloudflare:workers";

/**
 * One Durable Object instance per pub/sub scope (`warehouse:<id>`,
 * `warehouse:<id>:<role>`, `order:<id>`, `user:<id>`, "admin"...) — see
 * `idFromName(scope)` in realtime.ts. Replaces the old single-process
 * in-memory EventEmitter: a Worker isolate is stateless/ephemeral and can't
 * hold SSE subscriber state across requests or across isolates, but a DO's
 * single-threaded, single-instance-per-id guarantee means "all subscribers
 * to this scope" is always exactly the set held in this one place.
 *
 * ponytail: plain SSE streams held open in the DO's fetch handler, not the
 * WebSocket Hibernation API — simplest match for the existing client code
 * (every page already uses EventSource) and this app's actual scale (a
 * handful of staff per warehouse). Move to hibernated WebSockets only if a
 * deployment's connection count/duration makes DO active-time cost matter.
 */
export class RealtimeHub extends DurableObject {
  private subscribers = new Set<ReadableStreamDefaultController>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/publish") {
      const event = await request.json();
      const chunk = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
      for (const controller of this.subscribers) {
        try {
          controller.enqueue(chunk);
        } catch {
          this.subscribers.delete(controller);
        }
      }
      return new Response("ok");
    }

    if (request.method === "GET" && url.pathname === "/subscribe") {
      let self: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start: (controller) => {
          self = controller;
          this.subscribers.add(controller);
          controller.enqueue(new TextEncoder().encode(`data: {"type":"connected"}\n\n`));
        },
        cancel: () => {
          this.subscribers.delete(self);
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}
