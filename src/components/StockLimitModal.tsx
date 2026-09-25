"use client";

import { fmtQty } from "@/lib/fmt";

// Shared "you're asking for more than the warehouse has" dialog — used by
// Finance's New Order screen and QC's session screen, the two places that
// enter a quantity against live stock.
export function StockLimitModal({
  productName,
  unitSymbol,
  maxQty,
  onFix,
  onClose,
}: {
  productName: string;
  unitSymbol: string;
  maxQty: number;
  onFix: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-bad">Not enough stock</h2>
        <p className="text-sm">
          Only <span className="font-medium">{fmtQty(maxQty)} {unitSymbol}</span> of <span className="font-medium">{productName}</span> is available in the warehouse.
        </p>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onFix();
              onClose();
            }}
          >
            Reduce to {fmtQty(maxQty)}
          </button>
        </div>
      </div>
    </div>
  );
}
