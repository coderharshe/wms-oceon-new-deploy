import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/inventory", label: "Inventory Dashboard" },
  { href: "/inventory/ledger", label: "Inventory Ledger" },
  { href: "/inventory/purchase-orders", label: "Purchase Orders" },
  { href: "/inventory/suppliers", label: "Suppliers" },
  { href: "/inventory/grn", label: "Inward (GRN)" },
  { href: "/inventory/outward", label: "Inventory Issue / Outward" },
  { href: "/inventory/count", label: "Physical Count" },
  { href: "/inventory/reports", label: "Reports & Alerts" },
];

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_INVENTORY"),
    getSetting("FONT_SIZE_INVENTORY"),
  ]);
  return (
    <div className="inventory-ui">
      <PortalShell
        title="Inventory"
        userName={session.name}
        links={LINKS}
        shortcuts
        theme={theme}
        fontSize={fontSize}
      >
        {children}
      </PortalShell>
    </div>
  );
}
