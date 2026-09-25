"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelSpec = {
  code: string;
  productName: string;
  unitSymbol: string;
  factorToBase: string;
  baseUnitSymbol: string;
};

// One sticker: scannable code on top, then what it actually is in words.
// The conversion line ("1 box24 = 24 pc") is the bit that matters on a
// warehouse shelf — it's what stops someone scanning a carton and counting
// it as a single piece.
function LabelCard({ spec }: { spec: LabelSpec }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      // CODE128 encodes arbitrary alphanumeric text, so it takes both the
      // WMS-YYYYMMDD-NNNN codes this app generates and whatever a scanner
      // reads off a real carton. EAN-13 would reject anything that isn't
      // exactly 13 digits with a valid checksum.
      JsBarcode(svgRef.current, spec.code, {
        format: "CODE128",
        width: 1.6,
        height: 48,
        fontSize: 13,
        margin: 4,
        displayValue: true,
      });
    } catch {
      // Invalid/empty code — leave the <svg> blank rather than crash the page.
    }
  }, [spec.code]);

  const isWholeNumber = Number(spec.factorToBase) === Math.trunc(Number(spec.factorToBase));

  return (
    <div className="barcode-label break-inside-avoid rounded border border-line p-2 text-center">
      <svg ref={svgRef} className="mx-auto block" />
      <p className="text-sm font-semibold leading-tight">{spec.productName}</p>
      <p className="text-xs text-muted leading-tight">
        1 {spec.unitSymbol} = {isWholeNumber ? Number(spec.factorToBase) : spec.factorToBase} {spec.baseUnitSymbol}
      </p>
    </div>
  );
}

/**
 * Print sheet for one or more unit labels. Printing goes through the
 * browser's own dialog (window.print()) — the `@media print` rules below
 * strip everything except the labels, so a normal A4 print or a
 * label-printer both produce just the stickers.
 */
export function BarcodeLabelSheet({ labels, onClose }: { labels: LabelSpec[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-3 print:max-w-none print:border-0 print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold print:hidden">Print barcode labels</h2>

        <div id="barcode-print-area" className="flex flex-wrap gap-2">
          {labels.map((l) => (
            <LabelCard key={l.code} spec={l} />
          ))}
        </div>
        {labels.length === 0 && <p className="text-sm text-muted">No units have a barcode yet.</p>}

        <div className="flex justify-end gap-2 print:hidden">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" disabled={labels.length === 0} onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
