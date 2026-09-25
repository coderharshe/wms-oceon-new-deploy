import { queueAction } from "./offline-queue";

/**
 * POST that queues itself instead of failing when there's no connection —
 * for the handful of actions safe to apply later (stock-in, cash payment;
 * see each call site for why). Everything else should keep using plain
 * fetch() and fail loudly offline (send-to-QC, starting a QC session, order
 * creation — all need a live server round trip to be correct, not just
 * available).
 *
 * A real server rejection (validation error, insufficient stock) is NOT
 * queued — it's surfaced immediately, same as a normal fetch. Only an
 * actual network failure gets queued.
 */
export async function submitQueueable<T = unknown>(url: string, body: Record<string, unknown>): Promise<{ queued: boolean; duplicate?: boolean; data?: T }> {
  // One id per logical submission, sent online AND reused if this ends up
  // queued — an attempt whose response was lost after the server committed
  // is then recognised as a duplicate when the queue flushes it later.
  const clientRequestId = crypto.randomUUID();
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueAction(url, body, clientRequestId);
    return { queued: true };
  }
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, clientRequestId }) });
    if (res.ok) {
      const data = await res.json().catch(() => undefined);
      return { queued: false, duplicate: (data as { duplicate?: boolean } | undefined)?.duplicate === true, data };
    }
    const errBody = await res.json().catch(() => ({}));
    throw new Error(typeof errBody.error === "string" ? errBody.error : "Request failed");
  } catch (err) {
    if (err instanceof TypeError) {
      // fetch() itself threw — a real network failure, not a server response.
      await queueAction(url, body, clientRequestId);
      return { queued: true };
    }
    throw err;
  }
}
