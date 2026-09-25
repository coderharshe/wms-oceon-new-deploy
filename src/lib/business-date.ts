import { getEnv } from "./cf-env";

/**
 * The wall-clock date the business is currently operating in.
 *
 * Everything date-shaped in this system (cash session businessDate, the
 * YYYYMMDD part of ORD-/INV-/GRN- numbers) used to come from `new Date()`,
 * which on Workers is UTC. For an IST business that rolls the "day" over at
 * 05:30 local — cash sessions and document numbers flipped to tomorrow while
 * the shop was still open last night.
 *
 * BUSINESS_TZ is an IANA zone name; defaults to Asia/Kolkata. Intl is the
 * only timezone database available in a Workers isolate, and it is enough:
 * we only ever need the local calendar date, never arithmetic across zones.
 */
export function businessTz(): string {
  return getEnv("BUSINESS_TZ") || "Asia/Kolkata";
}

/** Local calendar date as "YYYY-MM-DD" — the form the `@db.Date` columns store. */
export function businessDateString(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: businessTz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Same instant as businessDateString, as a Date at UTC midnight — for Prisma `@db.Date`. */
export function businessDate(now: Date = new Date()): Date {
  return new Date(`${businessDateString(now)}T00:00:00.000Z`);
}

/** Local calendar date as "YYYYMMDD" — the date part of ORD-/INV-/GRN- numbers. */
export function businessDateCompact(now: Date = new Date()): string {
  return businessDateString(now).replace(/-/g, "");
}

const BILLED_AT_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const BILLED_AT_FUTURE_MS = 5 * 60 * 1000;

// An explicit zone is required: a zone-less "2026-09-16T22:30" means a
// different instant on the PC, in Node and on Workers, so it is not a time.
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * When an offline bill was really made. The till prints it while the
 * internet is down and syncs it later, so the bill keeps the PC's time — and
 * joins that day's INV- series — as long as the time is believable: within
 * the last 7 days, or at most 5 minutes ahead (a PC clock running fast).
 * Anything else is a wrong PC clock or a garbled value. The bill still goes
 * through, stamped now, with a note for the manager; it is never refused.
 *
 * `backdated` says whether `at` came from the PC. A bill synced on a later
 * business day than it was made also gets a note, so the manager can see
 * which bills arrived late.
 */
export function acceptBilledAt(
  billedAt: string | undefined,
  now: Date = new Date()
): { at: Date; backdated: boolean; issue: string | null } {
  if (!billedAt) return { at: now, backdated: false, issue: null };
  const ms = ZONED_ISO.test(billedAt) ? Date.parse(billedAt) : NaN;
  const t = new Date(ms);
  const day = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: businessTz(), dateStyle: "medium" }).format(d);
  if (Number.isFinite(ms) && ms >= now.getTime() - BILLED_AT_PAST_MS && ms <= now.getTime() + BILLED_AT_FUTURE_MS) {
    const late = businessDateString(t) !== businessDateString(now);
    return { at: t, backdated: true, issue: late ? `Made on the PC on ${day(t)}, synced ${day(now)}.` : null };
  }
  const shown = Number.isFinite(ms)
    ? new Intl.DateTimeFormat("en-IN", { timeZone: businessTz(), dateStyle: "medium", timeStyle: "short" }).format(t)
    : JSON.stringify(billedAt);
  return {
    at: now,
    backdated: false,
    issue: `This bill was billed on the PC at ${shown}, outside the accepted window (last 7 days), so it was dated when it reached the server instead. Check the PC's clock and the date on the customer's slip.`,
  };
}
