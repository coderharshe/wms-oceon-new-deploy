import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/procurement", label: "Dashboard" },
  { href: "/procurement/suppliers", label: "Supplier Comparison" },
  { href: "/procurement/requisitions", label: "Requisitions" },
  { href: "/procurement/orders", label: "Purchase Orders (PO)" },
  { href: "/procurement/rates", label: "Rate History" },
];

export default async function ProcurementLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_PROCUREMENT"),
    getSetting("FONT_SIZE_PROCUREMENT"),
  ]);
  return (
    <div className="procurement-ui">
      <PortalShell
        title="Procurement & Purchase"
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
