// The outbox lives in offline-bills.ts now: bills, cash, revisions and the
// plain queued POSTs (stock-in) share ONE FIFO queue, so nothing queued later
// can overtake something queued earlier. This file keeps the old import path
// for offline-fetch.ts and RegisterServiceWorker.
export { queueAction, getQueue, getFailedActions, flushQueue, startQueueFlusher, type QueuedAction } from "./offline-bills";
