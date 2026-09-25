"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useShortcuts } from "@/lib/shortcuts";
import Calculator from "@/components/Calculator";

// Binds the finance portal's global shortcuts (Alt+D/O, F2, Alt+C). Mounted
// once in the finance layout so they work from any page.
export default function FinanceShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [calc, setCalc] = useState(false);
  // Pushing the page already on screen is a no-op online, but offline Next
  // turns it into a full reload the service worker may not be able to serve
  // — pressing F2 on New Order during an outage left "site can't be reached".
  const go = (href: string) => () => {
    if (pathname !== href) router.push(href);
  };
  useShortcuts({
    "nav-dashboard": go("/finance"),
    "nav-new-order": go("/finance/orders/new"),
    "nav-orders": go("/finance/orders"),
    "open-calculator": () => setCalc((v) => !v),
  });
  return calc ? <Calculator onClose={() => setCalc(false)} /> : null;
}
