import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { isWorkersRuntime } from "@/lib/cf-env";
import { subscribeStream } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * SSE stream (PRD §40 allows SSE as an alternative to WebSockets), backed by
 * per-scope Durable Objects (see realtime-hub.ts) rather than in-process
 * pub/sub — a Worker isolate can't hold subscriber state across requests.
 * A client subscribes to several scopes at once, so this fans in each
 * scope's own DO stream into one outgoing stream to the browser.
 *
 * - Authenticated staff subscribe to: their warehouse's shared scope (order/
 *   inventory/payment events, visible to every role in that warehouse), a
 *   role-scoped notification channel, and their own personal one — so one
 *   role's notifications never land on another role's bell (see notify()).
 * - The payment display screen is unauthenticated but may only subscribe to
 *   a single order's scope via ?orderId=, which only carries payment-status
 *   events — never admin/financial detail (PRD §16: no sensitive info).
 *   Two things enforce that second half, which used to be only a comment:
 *   the order must actually exist (an indexed primary-key lookup) before we
 *   touch a Durable Object, or any caller could mint an unbounded number of
 *   billable DOs by looping over made-up ids; and the frames on that scope
 *   are stripped to their `type` on the way out, because the publishers do
 *   put money on them — bill:revised carries newTotal, payment:updated
 *   carries amountPaid. Both consumers of this scope (the kiosk and the
 *   finance order page) only ever read `type` and then refetch through an
 *   authenticated endpoint, so nothing is lost by not sending the rest.
 */

async function orderExists(orderId: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { order } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDrizzleDb().select({ id: order.id }).from(order).where(eq(order.id, orderId));
    return !!row;
  }
  return !!(await (await import("@/lib/db")).getDb().order.findUnique({ where: { id: orderId }, select: { id: true } }));
}

/** Re-emits each SSE frame with its payload dropped, keeping only `type`. */
function typeOnly(upstream: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return upstream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.replace(/^data: /, "");
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: JSON.parse(data).type })}\n\n`));
          } catch {
            /* keepalive comment or partial frame — drop it, the client re-syncs */
          }
        }
      },
    })
  );
}

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (orderId && !(await orderExists(orderId))) return new Response("Not found", { status: 404 });

  // Staff get their own scopes plus the order's on the SAME stream, so a bill
  // page holds one connection, not two (see live-events.ts for why that matters).
  const session = await getSession();
  if (!session && !orderId) return new Response("Unauthorized", { status: 401 });
  const staffScopes = !session
    ? []
    : session.warehouseId
      ? [`warehouse:${session.warehouseId}`, `warehouse:${session.warehouseId}:${session.role}`, `user:${session.sub}`]
      : ["admin", `role:${session.role}`, `user:${session.sub}`];

  const staff = await Promise.all(staffScopes.map((scope) => subscribeStream(scope)));
  const upstreams = orderId ? [...staff, typeOnly(await subscribeStream(`order:${orderId}`))] : staff;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Fan in: pump each scope's DO stream into the one client-facing
      // stream. The DO's own "connected" event on each upstream is harmless
      // noise multiplied by scope count — cheap and ignorable client-side.
      for (const upstream of upstreams) {
        const reader = upstream.getReader();
        (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!closed) controller.enqueue(value);
            }
          } catch {
            /* upstream DO connection dropped — the client still has the others */
          }
        })();
      }

      const keepAlive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25000);

      req.signal.addEventListener("abort", () => {
        close();
        for (const upstream of upstreams) upstream.cancel().catch(() => {});
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
