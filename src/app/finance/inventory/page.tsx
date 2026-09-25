"use client";

import ReceiveStock from "@/components/ReceiveStock";

// Finance receives stock against its own warehouse, exactly as Manager does —
// same component, same API, warehouse forced server-side from the session.
export default function FinanceInventoryPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Receive stock</h1>
      <ReceiveStock />
    </div>
  );
}
