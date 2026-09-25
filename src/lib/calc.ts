/**
 * Scratch-calculator arithmetic for the Alt+C window (src/components/Calculator.tsx).
 * Whitelist the characters first, then let the JS engine do the arithmetic — a
 * hand-rolled parser is a bug farm, and this expression never leaves the tab.
 * Returns "" for anything that isn't a finite number, so the window just shows
 * nothing while a half-typed sum is on screen.
 */
export function evaluate(expr: string): string {
  if (!expr.trim() || !/^[\d+\-*/().\s]+$/.test(expr)) return "";
  try {
    const v = new Function(`return (${expr})`)() as unknown;
    if (typeof v !== "number" || !Number.isFinite(v)) return "";
    return String(Math.round(v * 1e6) / 1e6); // kill 0.1+0.2 float dust
  } catch {
    return "";
  }
}
