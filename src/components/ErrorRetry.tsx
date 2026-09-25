"use client";

import Link from "next/link";
import type { ApiError } from "@/lib/read-error";
import { sanitizeErrorMessage, inferErrorFix } from "@/lib/read-error";

/**
 * The page-level "this didn't load" or failed operation card.
 * Provides instant 1-click solutions, fast retry, and navigation to avoid delays.
 */
export function ErrorRetry({
  message,
  onRetry,
  className = "",
}: {
  message: ApiError | string;
  onRetry: () => void;
  className?: string;
}) {
  const rawMessage = typeof message === "string" ? message : message.message;
  const cleanMessage = sanitizeErrorMessage(rawMessage);
  const fix = typeof message === "string" ? inferErrorFix(cleanMessage) : (message.fix || inferErrorFix(cleanMessage));

  return (
    <div className={`card border-l-4 border-l-bad bg-red-500/5 p-4 my-3 shadow-sm rounded-lg ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-2xl leading-none select-none mt-0.5 shrink-0" aria-hidden="true">
            ⚠️
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-bad">Action Required / System Alert</h4>
            <p className="text-sm text-foreground/85 mt-0.5 font-medium leading-snug break-words">
              {cleanMessage}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 pt-1 sm:pt-0">
          {fix && (
            <Link
              href={fix.href}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bad text-white text-xs font-semibold shadow hover:opacity-90 active:scale-95 transition-all"
            >
              <span>⚡ Solve Now:</span>
              <span>{fix.label}</span>
            </Link>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 border border-line text-foreground text-xs font-semibold hover:bg-surface-3 active:scale-95 transition-all"
            >
              🔄 Retry Now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
