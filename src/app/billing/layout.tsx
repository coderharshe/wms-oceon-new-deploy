import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/billing", label: "Dashboard (Alt+D)" },
  { href: "/billing/new", label: "New Bill (F2)" },
  { href: "/billing/orders", label: "Bills & Orders (Alt+O)" },
  { href: "/billing/gst-bill", label: "GST Invoice" },
  { href: "/billing/discounts", label: "Discount Approvals" },
];

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_BILLING"),
    getSetting("FONT_SIZE_BILLING"),
  ]);
  return (
    <div className="billing-ui">
      <PortalShell
        title="Billing & Sales"
        userName={session.name}
        links={LINKS}
        shortcuts
        syncStaffId={session.staffId}
        theme={theme}
        fontSize={fontSize}
      >
        {children}
      </PortalShell>
    </div>
  );
}
