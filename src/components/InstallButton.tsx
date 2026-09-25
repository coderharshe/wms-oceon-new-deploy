"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

// Chrome fires `beforeinstallprompt` on load, often before React has hydrated
// this component — so the listener is registered at module scope (as soon as
// the chunk loads) and the event stashed here for whenever the button mounts.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // stops Chrome's own mini-infobar; we show our button instead
    deferred = e as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

/** Already running as an installed app — nothing left to offer. */
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export default function InstallButton() {
  const [show, setShow] = useState(false);
  const [ready, setReady] = useState(false); // is a real install prompt available?
  const [hint, setHint] = useState(false);

  useEffect(() => {
    const sync = () => {
      setShow(!isStandalone());
      setReady(deferred !== null);
    };
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          const e = deferred;
          // Not every Chromium browser implements beforeinstallprompt (Comet,
          // Arc, Firefox…). Rather than hide the button and look broken, fall
          // back to telling people where their browser keeps the install item.
          if (!e) {
            setHint((v) => !v);
            return;
          }
          deferred = null; // a prompt can only be used once, whatever the user picks
          setReady(false);
          await e.prompt();
        }}
        className="rounded border border-line px-2 py-1 text-sm hover:bg-surface-hi"
        title="Install Taresh as an app on this device"
      >
        Install app
      </button>
      {hint && !ready && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded border border-line bg-paper p-2 text-xs text-muted shadow">
          This browser doesn&apos;t offer a direct install button. Open its menu (⋮) and choose
          <span className="font-medium"> Install app</span> or <span className="font-medium">Add to desktop</span>.
        </div>
      )}
    </div>
  );
}
