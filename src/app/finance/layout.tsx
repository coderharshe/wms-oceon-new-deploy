import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import FinanceShortcuts from "./FinanceShortcuts";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/finance", label: "Dashboard (Alt+D)" },
  { href: "/finance/cash", label: "Cash / EOD" },
  { href: "/finance/bank", label: "Bank & Recon" },
  { href: "/finance/upi", label: "UPI & Settlement" },
  { href: "/finance/receivables", label: "Receivables" },
  { href: "/finance/payables", label: "Payables" },
  { href: "/finance/expenses", label: "Expenses" },
  { href: "/finance/vouchers", label: "Vouchers" },
  { href: "/finance/reports", label: "Reports" },
];

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_FINANCE"),
    getSetting("FONT_SIZE_FINANCE"),
  ]);
  return (
    <div className="finance-ui">
      <PortalShell title="Finance" userName={session.name} links={LINKS} shortcuts syncStaffId={session.staffId} theme={theme} fontSize={fontSize}>
        <FinanceShortcuts />
        {children}
      </PortalShell>
    </div>
  );
}
