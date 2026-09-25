"use client";

import { useState } from "react";
import { BarcodeScanButton } from "./BarcodeScanButton";

/**
 * Asks the server for a fresh internal barcode. Not persisted server-side —
 * the surrounding form saves it when the product/unit is saved.
 */
export async function generateBarcode(): Promise<string> {
  const res = await fetch("/api/admin/products/barcode", { method: "POST" });
  if (!res.ok) throw new Error("Could not generate a barcode");
  const { code } = await res.json();
  return code as string;
}

/**
 * A barcode input plus its two capture paths: camera scan (where the browser
 * supports it) and "Generate" for goods with no manufacturer code.
 *
 * The plain text input is the third path and the one that always works — a
 * handheld USB/Bluetooth scanner is just a keyboard that types the digits and
 * presses Enter, so it needs no integration at all.
 */
export function BarcodeField({
  value,
  onChange,
  onGenerated,
  placeholder = "Scan, type, or generate",
  showGenerate = true,
  className = "w-44",
}: {
  value: string;
  onChange: (code: string) => void;
  onGenerated?: () => void;
  placeholder?: string;
  showGenerate?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A USB/Bluetooth barcode gun is just a keyboard — it types into whatever
  // field has focus, so there is nothing to "start". This only makes that
  // visible, so staff can see the field is armed before pulling the trigger.
  const [focused, setFocused] = useState(false);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      onChange(await generateBarcode());
      onGenerated?.();
    } catch {
      setError("Could not generate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        className={`${className} ${focused ? "ring-2 ring-blue-500" : ""}`}
        placeholder={placeholder}
        value={value}
        onFocus={(e) => {
          setFocused(true);
          e.target.select(); // a re-scan replaces the old code instead of appending to it
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.trim())}
        // A barcode gun ends its scan with Enter; without this it would
        // submit whatever form the field happens to sit inside.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
      <BarcodeScanButton onDetected={onChange} label="" />
      {showGenerate && (
        <button type="button" className="btn" disabled={busy} onClick={generate} title="Generate a code for an unbranded item">
          {busy ? "…" : "Generate"}
        </button>
      )}
      {value && (
        <button type="button" className="text-bad px-1" onClick={() => onChange("")} title="Clear barcode">
          ✕
        </button>
      )}
      {focused && !value && <span className="text-xs text-muted">Ready — scan now</span>}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
