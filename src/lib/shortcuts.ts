"use client";

import { useEffect, useRef } from "react";

export type ShortcutDef = { id: string; label: string; defaultKey: string; category?: string };

// System-wide and portal-specific shortcut catalog.
export const FINANCE_SHORTCUTS: ShortcutDef[] = [
  { id: "nav-dashboard", label: "Dashboard / Home", defaultKey: "Alt+D", category: "Navigation" },
  { id: "nav-new-order", label: "New Bill / Order", defaultKey: "F2", category: "Navigation" },
  { id: "nav-orders", label: "Search Orders / Ledger", defaultKey: "Alt+O", category: "Navigation" },
  { id: "open-calculator", label: "Quick Calculator", defaultKey: "Alt+C", category: "Tools" },
  { id: "focus-search", label: "Focus Search Bar", defaultKey: "Alt+S", category: "Tools" },
  { id: "focus-customer", label: "Billing: Focus Customer Search", defaultKey: "F3", category: "Billing" },
  { id: "focus-product", label: "Billing: Focus Product Search", defaultKey: "F5", category: "Billing" },
  { id: "submit-order", label: "Billing: Generate Bill / Settle", defaultKey: "F10", category: "Billing" },
  { id: "toggle-selling-mode", label: "Billing: Switch Wholesale / Retail", defaultKey: "Alt+R", category: "Billing" },
  { id: "edit-customer-name", label: "Billing: Quick Edit Name", defaultKey: "Alt+E", category: "Billing" },
  { id: "toggle-key-guide", label: "Toggle Shortcuts Helper", defaultKey: "Alt+K", category: "Tools" },
  { id: "hold-new-bill", label: "Hold Bill / Switch Back (Alt+1…9)", defaultKey: "Alt+N", category: "Billing" },
  { id: "print-bill", label: "Print Bill / Invoice", defaultKey: "Ctrl+P", category: "Tools" },
];

const STORAGE_KEY = "wms-shortcuts-v2";

export function normalizeKey(e: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("+");
}

function readOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getShortcutKey(id: string): string {
  return readOverrides()[id] ?? FINANCE_SHORTCUTS.find((s) => s.id === id)?.defaultKey ?? "";
}

export function setShortcutKey(id: string, key: string) {
  const overrides = readOverrides();
  overrides[id] = key;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function resetShortcutKey(id: string) {
  const overrides = readOverrides();
  delete overrides[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function resetAllShortcuts() {
  localStorage.removeItem(STORAGE_KEY);
}

let paused = false;
export function setShortcutsPaused(v: boolean) {
  paused = v;
}

/** Binds keydown handlers by shortcut id, using each id's current (possibly remapped) key. */
export function useShortcuts(handlers: Partial<Record<string, () => void>>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (paused) return;
      const pressed = normalizeKey(e);
      for (const id of Object.keys(handlersRef.current)) {
        if (getShortcutKey(id) !== pressed) continue;
        const target = e.target as HTMLElement | null;
        const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (pressed.length === 1 && typing) continue;
        e.preventDefault();
        handlersRef.current[id]?.();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
