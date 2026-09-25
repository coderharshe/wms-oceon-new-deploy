"use client";

import { useParams, useRouter } from "next/navigation";
import { LocalBillView } from "@/components/LocalBillView";

/**
 * A bill as this PC saved it, as its own page (links from an online screen).
 * Offline, screens open the same view in place instead (LocalBillOverlay):
 * a route this tab never loaded can't be reached without the network.
 */
export default function LocalBillPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      {/* Same as the server bill screen: Esc starts the next bill. */}
      <LocalBillView requestId={requestId} onClose={() => router.push("/finance/orders/new")} />
    </div>
  );
}
