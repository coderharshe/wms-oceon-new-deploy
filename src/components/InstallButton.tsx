"use client";

import { useEffect, useRef, useState } from "react";

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // Position calculation strictly clamped to viewport bounds
  useEffect(() => {
    if (!hint || !buttonRef.current) return;
    const updatePos = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(320, window.innerWidth - 32);
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      setPos({
        top: rect.bottom + 8,
        left,
        width: dropdownWidth,
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [hint]);

  // Click outside and Escape key to close hint
  useEffect(() => {
    if (!hint) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setHint(false);
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest("#install-button-container") && !target.closest("#install-button-modal")) {
        setHint(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [hint]);

  if (!show) return null;

  return (
    <div id="install-button-container" className="relative inline-block">
      <button
        ref={buttonRef}
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
        className="btn text-xs font-semibold py-1.5 px-3 hover:bg-surface-hi"
        title="Install OCEON-WMS as a PWA app on this device"
      >
        📥 <span className="hidden sm:inline">Install app</span>
      </button>
      {hint && !ready && pos && (
        <div
          id="install-button-modal"
          style={{ position: "fixed", top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
          className="z-50 rounded-xl border-2 border-line bg-paper p-3.5 text-xs text-muted shadow-2xl ring-4 ring-black/10 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="font-bold text-ink mb-1 text-sm">Install Application</div>
          This browser doesn&apos;t offer a direct install button. Open its menu (⋮) and choose
          <span className="font-bold text-accent"> Install app</span> or <span className="font-bold text-accent">Add to desktop</span>.
        </div>
      )}
    </div>
  );
}
