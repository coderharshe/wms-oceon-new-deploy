"use client";

import { useEffect, useRef, useState } from "react";
import { evaluate } from "@/lib/calc";

/** Scratch calculator (Alt+C). Type an expression, Enter keeps the answer to carry on from, Esc closes. */
export default function Calculator({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const result = evaluate(expr);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-56">
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Calculator</h2>
          <button className="text-xs text-muted" onClick={onClose} aria-label="Close calculator">
            Esc
          </button>
        </div>
        <input
          ref={inputRef}
          className="w-full text-right font-mono"
          value={expr}
          inputMode="decimal"
          placeholder="12*5+3"
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") return onClose();
            // Carry the answer forward, the way a desk calculator does.
            if (e.key === "Enter" && result) setExpr(result);
          }}
        />
        <div className="text-right font-mono text-lg">{result || <span className="text-muted">&nbsp;</span>}</div>
      </div>
    </div>
  );
}
