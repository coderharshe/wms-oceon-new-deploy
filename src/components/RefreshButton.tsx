"use client";

/**
 * Reload the screen.
 *
 * Ctrl+R and F5 already do this — but installed as an app (see InstallButton)
 * there is no address bar to reload from, and on a touch till there is no
 * keyboard either. The counter's answer to "it's showing something stale" has
 * to be visible on the screen itself.
 *
 * A half-typed bill survives it: the New Order screen saves its basket to
 * localStorage on every keystroke and picks it back up on load.
 */
export default function RefreshButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded border border-line px-2 py-1 text-sm hover:bg-surface-hi"
      title="Refresh this screen (Ctrl+R)"
      aria-label="Refresh this screen"
    >
      ⟳
    </button>
  );
}
