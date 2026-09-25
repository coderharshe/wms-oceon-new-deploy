"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApiError } from "@/lib/read-error";
import { sanitizeErrorMessage, inferErrorFix } from "@/lib/read-error";

/**
 * An error with its way out. Accepts either a plain string or an ApiError.
 * Every error displayed provides an instant 1-click button to solve it
 * immediately (via direct navigation, retry, or instant action) without delay.
 */
export function ErrorNote({
  error,
  onRetry,
  onDismiss,
  className = "",
  inline = false,
}: {
  error: ApiError | string | null | undefined;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  inline?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (!error || dismissed) return null;

  const rawMessage = typeof error === "string" ? error : error.message;
  const message = sanitizeErrorMessage(rawMessage);
  const fix = typeof error === "string" ? inferErrorFix(message) : (error.fix || inferErrorFix(message));
  const actionLabel = typeof error === "object" ? error.actionLabel : undefined;
  const onAction = typeof error === "object" ? error.onAction : undefined;

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  if (inline) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-2 py-1 px-2.5 rounded bg-red-500/10 border border-red-500/20 text-bad ${className}`}>
        <span className="text-xs font-medium">⚠️ {message}</span>
        {fix && (
          <Link
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-bad text-white text-[11px] font-semibold hover:opacity-90 shadow-sm active:scale-95 transition-all"
            href={fix.href}
          >
            ⚡ {fix.label}
          </Link>
        )}
        {onAction && actionLabel && (
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-bad text-white text-[11px] font-semibold hover:opacity-90 shadow-sm active:scale-95 transition-all"
            onClick={onAction}
          >
            ⚡ {actionLabel}
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-surface-2 border border-line text-[11px] font-semibold text-foreground hover:bg-surface-3 active:scale-95 transition-all"
            onClick={onRetry}
          >
            🔄 Retry
          </button>
        )}
      </span>
    );
  }

  return (
    <div
      role="alert"
      className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 my-2 rounded-lg bg-red-500/10 border border-red-500/30 text-bad shadow-sm ${className}`}
    >
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <span className="text-base select-none shrink-0" aria-hidden="true">
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-bad leading-relaxed break-words">
            {message}
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
        {onAction && actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bad text-white text-xs font-semibold shadow hover:opacity-90 active:scale-95 transition-all"
          >
            <span>⚡</span>
            <span>{actionLabel}</span>
          </button>
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
        <button
          type="button"
          onClick={handleDismiss}
          title="Dismiss error"
          className="p-1 rounded text-muted hover:text-foreground hover:bg-red-500/20 text-xs transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
