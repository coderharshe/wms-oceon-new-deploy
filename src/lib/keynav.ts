"use client";

import { useEffect, useRef } from "react";

/**
 * Tally-style keyboard movement for data-entry screens.
 *
 * Enter goes to the next field, Shift+Enter to the previous one. Arrows also
 * move between fields, but ONLY where they aren't already doing something:
 * Up/Down in a number input bumps the quantity and in a <select> changes the
 * unit, which are the two most-used keystrokes on a bill — stealing them to
 * move focus would be a downgrade. Shift+Enter is the one "go back" that works
 * everywhere, including out of those fields.
 *
 * Order comes from the DOM, so it always matches the Tab order and no field
 * needs to declare its own successor.
 */

const FOCUSABLE = "input, select, textarea, button, [tabindex]";

function fields(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !(el as HTMLInputElement).disabled && el.tabIndex !== -1 && el.offsetParent !== null
  );
}

export function moveFocus(container: HTMLElement | null, from: EventTarget | null, step: 1 | -1): boolean {
  if (!container) return false;
  const list = fields(container);
  const i = list.indexOf(from as HTMLElement);
  if (i < 0) return false;
  const next = list[i + step];
  if (!next) return false;
  next.focus();
  // Landing on a field with its value selected means typing replaces it —
  // what you want when correcting a rate, and what Tally does.
  if (next instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(next.type)) next.select();
  return true;
}

/** Arrows are only free to move focus in a plain text box; everywhere else they already mean something. */
const TEXTISH = ["text", "search", "tel", "email", "url", "password"];

/**
 * The precedence rule on its own, with no DOM — this is the part that would
 * silently break quantity entry if it drifted, so it is unit-tested.
 * `tag` is uppercase ("INPUT"), `type` is the input's type for INPUT only.
 */
export function navIntent(
  key: string,
  shiftKey: boolean,
  tag: string,
  type: string | null
): "next" | "prev" | null {
  if (key === "Enter") {
    // A button's Enter activates it; a textarea's Enter is a newline.
    if (tag === "BUTTON" || tag === "TEXTAREA") return null;
    return shiftKey ? "prev" : "next";
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    // Number spinners and <select> keep their native arrows — bumping a qty
    // and changing a unit beat moving focus.
    if (tag !== "INPUT" || !TEXTISH.includes(type ?? "")) return null;
    return key === "ArrowDown" ? "next" : "prev";
  }
  return null;
}

/**
 * Attach to the container of a data-entry screen. `defaultPrevented` is the
 * hand-off: a search box whose dropdown is open has already claimed Enter and
 * the arrows for picking a result, so this leaves those alone.
 */
export function onFieldNavKeyDown(e: React.KeyboardEvent, container: HTMLElement | null) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement;
  const intent = navIntent(e.key, e.shiftKey, el.tagName, el instanceof HTMLInputElement ? el.type : null);
  if (!intent) return;
  if (moveFocus(container, el, intent === "next" ? 1 : -1)) e.preventDefault();
}

/**
 * Esc, once, at the window — so it works whether or not focus is in a field.
 * Skips an event a nested handler already consumed, which is what makes
 * "innermost thing first, navigate last" fall out for free.
 *
 * Child components mount before their parent, and window listeners fire in
 * registration order, so a nested editor gets Esc first: call
 * `e.preventDefault()` in its handler to stop the parent's "leave the screen"
 * from also running. That is the only thing standing between an open editor
 * and one keystroke discarding it.
 */
export function useEscapeKey(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) ref.current(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
