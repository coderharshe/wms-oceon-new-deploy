"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { evaluate } from "@/lib/calc";

/** Scratch calculator (Alt+C). Type an expression, Enter keeps the answer to carry on from, Esc closes. */
export default function Calculator({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [expr, setExpr] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const prevActiveElementRef = useRef<HTMLElement | null>(null);
  const result = evaluate(expr);

  useEffect(() => {
    // 1. Capture the exact input/element focused before calculator opened
    if (typeof document !== "undefined") {
      prevActiveElementRef.current = (document.activeElement as HTMLElement | null) ?? null;
    }
    setMounted(true);

    // 2. Immediately focus and select calculator input
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);

    // 3. Cleanup: restore focus to where the cashier left off
    return () => {
      clearTimeout(timer);
      const prev = prevActiveElementRef.current;
      if (prev && typeof prev.focus === "function") {
        setTimeout(() => {
          prev.focus();
        }, 10);
      }
    };
  }, []);

  // Escape key, Alt+C toggle, and click outside listeners
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        onClose();
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        // Only close if clicking outside widget and not on a toggle button
        const target = e.target as HTMLElement | null;
        if (!target?.closest("[data-calc-toggle]")) {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  if (!mounted || typeof document === "undefined") return null;

  function appendChar(c: string) {
    setExpr((prev) => prev + c);
    inputRef.current?.focus();
  }

  function clearExpr() {
    setExpr("");
    inputRef.current?.focus();
  }

  function backspace() {
    setExpr((prev) => prev.slice(0, -1));
    inputRef.current?.focus();
  }

  function applyResult() {
    if (result) {
      setExpr(result);
      inputRef.current?.focus();
    }
  }

  function copyResult() {
    const val = result || expr;
    if (!val) return;
    navigator.clipboard?.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return createPortal(
    <div
      ref={widgetRef}
      id="pos-calculator-widget"
      style={{ width: "350px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 40px)" }}
      className="fixed bottom-6 right-6 z-[9999] select-none overflow-y-auto rounded-2xl border-2 border-indigo-500 bg-slate-900 p-4 text-white shadow-2xl ring-4 ring-indigo-500/30 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white font-black text-xs shadow">
            🧮
          </span>
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide leading-tight">POS Calculator</h2>
            <span className="text-[10px] text-indigo-300 font-medium">Alt+C</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {result && (
            <button
              type="button"
              className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-emerald-400 hover:bg-slate-700 border border-slate-700 transition-colors"
              onClick={copyResult}
              title="Copy result"
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          )}
          <button
            type="button"
            className="rounded-lg bg-slate-800 p-1 px-2 text-xs font-bold text-slate-300 hover:bg-rose-600 hover:text-white transition-colors border border-slate-700"
            onClick={onClose}
            aria-label="Close calculator"
            title="Close (Esc)"
          >
            Esc ✕
          </button>
        </div>
      </div>

      {/* Digital Display Screen */}
      <div className="mt-2.5 rounded-xl border-2 border-slate-700 bg-slate-950 p-2.5 shadow-inner">
        <input
          ref={inputRef}
          style={{ fontSize: "22px", lineHeight: "28px" }}
          className="w-full bg-transparent text-right font-mono font-bold tracking-wider text-cyan-300 placeholder-slate-600 focus:outline-none"
          value={expr}
          inputMode="decimal"
          placeholder="0"
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" && result) {
              e.preventDefault();
              applyResult();
            }
          }}
        />
        <div className="mt-1 flex items-center justify-between border-t border-slate-800/80 pt-1 font-mono">
          <span className="text-[10px] font-bold uppercase text-slate-500">= Result:</span>
          <span style={{ fontSize: "24px", lineHeight: "28px" }} className="font-black text-emerald-400 tracking-tight">
            {result ? `₹${result}` : <span className="text-slate-700 text-lg">0.00</span>}
          </span>
        </div>
      </div>

      {/* Keypad */}
      <div className="mt-2.5 grid grid-cols-4 gap-1.5 font-mono text-sm font-bold">
        {/* Row 1 */}
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-rose-600/90 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow font-bold text-xs transition-all"
          onClick={clearExpr}
        >
          C
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-amber-600/90 hover:bg-amber-600 active:scale-95 text-white flex items-center justify-center shadow font-bold text-xs transition-all"
          onClick={backspace}
        >
          ⌫
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-cyan-300 flex items-center justify-center border border-slate-700 shadow text-xs transition-all"
          onClick={() => appendChar("(")}
        >
          (
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-cyan-300 flex items-center justify-center border border-slate-700 shadow text-xs transition-all"
          onClick={() => appendChar(")")}
        >
          )
        </button>

        {/* Row 2 */}
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("7")}
        >
          7
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("8")}
        >
          8
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("9")}
        >
          9
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center shadow font-black text-base transition-all"
          onClick={() => appendChar("/")}
        >
          ÷
        </button>

        {/* Row 3 */}
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("4")}
        >
          4
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("5")}
        >
          5
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("6")}
        >
          6
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center shadow font-black text-base transition-all"
          onClick={() => appendChar("*")}
        >
          ×
        </button>

        {/* Row 4 */}
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("1")}
        >
          1
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("2")}
        >
          2
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("3")}
        >
          3
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center shadow font-black text-base transition-all"
          onClick={() => appendChar("-")}
        >
          −
        </button>

        {/* Row 5 */}
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all text-sm"
          onClick={() => appendChar("0")}
        >
          0
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-white flex items-center justify-center border border-slate-700 shadow transition-all font-black text-base"
          onClick={() => appendChar(".")}
        >
          .
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shadow font-black text-lg transition-all"
          onClick={applyResult}
          title="Enter (carry answer forward)"
        >
          =
        </button>
        <button
          type="button"
          style={{ height: "36px" }}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center shadow font-black text-base transition-all"
          onClick={() => appendChar("+")}
        >
          +
        </button>
      </div>
    </div>,
    document.body
  );
}
