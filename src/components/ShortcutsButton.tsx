"use client";

import { useEffect, useRef, useState } from "react";
import {
  FINANCE_SHORTCUTS,
  getShortcutKey,
  setShortcutKey,
  resetShortcutKey,
  resetAllShortcuts,
  normalizeKey,
  setShortcutsPaused,
} from "@/lib/shortcuts";

export default function ShortcutsButton() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);
  const modalRef = useRef<HTMLDivElement>(null);

  function startEdit(id: string) {
    setEditing(id);
    setShortcutsPaused(true);
  }

  function stopEdit() {
    setEditing(null);
    setShortcutsPaused(false);
  }

  function onCapture(e: React.KeyboardEvent, id: string) {
    e.preventDefault();
    if (e.key === "Escape") return stopEdit();
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const key = normalizeKey(e);
    const clash = FINANCE_SHORTCUTS.find((s) => s.id !== id && getShortcutKey(s.id) === key);
    if (clash) {
      alert(`"${key}" is already used for "${clash.label}"`);
      return;
    }
    setShortcutKey(id, key);
    stopEdit();
    rerender();
  }

  function close() {
    setOpen(false);
    stopEdit();
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "?" && !open) {
        const target = e.target as HTMLElement | null;
        const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setOpen(true);
        }
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const categories = ["Navigation", "Billing", "Tools"];

  return (
    <div className="relative" ref={modalRef}>
      <button
        type="button"
        className="btn flex items-center gap-1 text-xs font-semibold hover:bg-surface-hi"
        onClick={() => setOpen((o) => !o)}
        title="View & customize keyboard shortcuts (Press ?)"
      >
        <span>⌨️</span>
        <span className="hidden sm:inline">Shortcuts</span>
        <kbd className="hidden md:inline-block rounded bg-line/60 px-1 text-[10px] text-muted">?</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-line bg-paper p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent font-bold text-xs">
                  ⌨️
                </span>
                <div>
                  <h2 className="text-sm font-bold text-ink">Keyboard Shortcuts</h2>
                  <p className="text-[11px] text-muted">Click any shortcut button to remap keys to your workflow</p>
                </div>
              </div>
              <button
                type="button"
                className="rounded p-1 text-muted hover:bg-surface-hi hover:text-ink text-sm"
                onClick={close}
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {/* Quick Tab Jump Hint */}
              <div className="rounded-lg bg-accent/5 border border-accent/20 p-2.5 text-xs">
                <span className="font-bold text-ink">⚡ Quick Portal Navigation:</span>
                <p className="text-muted mt-0.5">
                  Press <kbd className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold border border-line">Alt+1</kbd> to <kbd className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold border border-line">Alt+9</kbd> to jump between portal tabs instantly. Press <kbd className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold border border-line">/</kbd> or <kbd className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold border border-line">Alt+S</kbd> to focus search.
                </p>
              </div>

              {categories.map((cat) => {
                const items = FINANCE_SHORTCUTS.filter((s) => (s.category || "General") === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="space-y-1.5">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">{cat}</h3>
                    <div className="divide-y divide-line/60 rounded-lg border border-line bg-surface/50">
                      {items.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                          <span className="font-medium text-ink">{s.label}</span>
                          {editing === s.id ? (
                            <input
                              autoFocus
                              readOnly
                              className="w-28 rounded border border-accent bg-accent/10 text-center font-mono text-xs font-bold text-accent"
                              value="Press key…"
                              onKeyDown={(e) => onCapture(e, s.id)}
                              onBlur={stopEdit}
                            />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                className="min-w-[4.5rem] rounded-md border border-line bg-paper px-2 py-1 text-center font-mono text-xs font-semibold shadow-2xs hover:border-accent hover:bg-accent/10"
                                onClick={() => startEdit(s.id)}
                                title="Click to remap key"
                              >
                                {getShortcutKey(s.id)}
                              </button>
                              {getShortcutKey(s.id) !== s.defaultKey && (
                                <button
                                  type="button"
                                  className="text-xs text-muted hover:text-bad"
                                  title={`Reset to default (${s.defaultKey})`}
                                  onClick={() => {
                                    resetShortcutKey(s.id);
                                    rerender();
                                  }}
                                >
                                  ↺
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
              <button
                type="button"
                className="text-muted hover:text-bad underline"
                onClick={() => {
                  resetAllShortcuts();
                  rerender();
                }}
              >
                Reset all to defaults
              </button>
              <button
                type="button"
                className="btn btn-primary font-semibold text-xs"
                onClick={close}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
