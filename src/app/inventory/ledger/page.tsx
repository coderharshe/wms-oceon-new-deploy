"use client";

import { InventoryLedgerView } from "@/components/InventoryLedgerView";

export default function InventoryPortalLedgerPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-line pb-3">
        <h1 className="text-xl font-bold tracking-tight text-ink">Inventory Intelligence</h1>
      </div>
      <InventoryLedgerView portalRole="INVENTORY" />
    </div>
  );
}
