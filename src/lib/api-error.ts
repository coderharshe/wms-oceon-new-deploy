import { NextResponse } from "next/server";

/**
 * An error the user can act on, not just read.
 *
 * Every refusal this app makes has a reason, and most have a next step the
 * user would otherwise have to work out and navigate to themselves ("finish or
 * cancel those orders first" — which orders? where?). `fix` carries that step
 * as a link the client renders as one button, so the message and the way out
 * arrive together.
 *
 * Omit `fix` when there genuinely isn't one — an invented button that doesn't
 * fix anything is worse than none.
 */
export type ErrorFix = { label: string; href: string };

export function fail(status: number, message: string, fix?: ErrorFix) {
  return NextResponse.json({ error: message, ...(fix ? { fix } : {}) }, { status });
}
