import { parseDbTimestamp } from "./fmt";

// A QC session is "actively locked" to its qcUserId while status is
// IN_PROGRESS/CHANGES_REQUIRED and lastActiveAt is recent. Past this many ms
// with no heartbeat, a different QC user may take over (laptop died, tab
// closed without hitting Leave). Client heartbeats well under this so one
// missed beat doesn't cost the lock — see qc/[orderId]/page.tsx.
export const QC_LOCK_TIMEOUT_MS = 15 * 60 * 1000;
export const QC_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

export function isLockStale(lastActiveAt: Date | string): boolean {
  return Date.now() - parseDbTimestamp(lastActiveAt).getTime() > QC_LOCK_TIMEOUT_MS;
}
