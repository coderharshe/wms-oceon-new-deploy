import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/alerts", label: "Alerts" },
  { href: "/admin/damaged", label: "Damaged Goods" },
  { href: "/admin/warehouses", label: "Warehouses" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/products", label: "Inventory" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/cash", label: "Cash & Bank" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/audit", label: "Audit Log" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_ADMIN"),
    getSetting("FONT_SIZE_ADMIN"),
  ]);

  return (
    <div className="admin-ui">
      <PortalShell
        title="Admin"
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
