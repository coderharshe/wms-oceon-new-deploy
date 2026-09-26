import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isWorkersRuntime } from "@/lib/cf-env";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [
  { href: "/manager", label: "Dashboard" },
  { href: "/manager/tasks", label: "Tasks & Delegation" },
  { href: "/manager/alerts", label: "Alert Center" },
  { href: "/manager/orders", label: "Orders" },
  { href: "/manager/products", label: "Products" },
  { href: "/manager/inventory", label: "Inventory" },
  { href: "/manager/cash", label: "Cash & Bank" },
  { href: "/manager/customers", label: "Customers" },
  { href: "/manager/suppliers", label: "Suppliers" },
  { href: "/manager/staff", label: "Staff & Users" },
  { href: "/manager/reports", label: "Reports" },
  { href: "/manager/transactions", label: "Transactions" },
  { href: "/manager/warehouse", label: "Warehouse" },
  { href: "/manager/settings", label: "Settings" },
  { href: "/manager/audit", label: "Audit Log" },
];

// Counted here rather than on the page so the manager sees the backlog from
// any manager screen. Cheap: one COUNT each over Product_needsReview_idx and
// Order_needsReview_idx.
async function countNeedsReview() {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product, order } = await import("@/generated/drizzle/schema");
    const { eq, count } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const [products, orders] = await Promise.all([
      db.select({ c: count() }).from(product).where(eq(product.needsReview, true)),
      db.select({ c: count() }).from(order).where(eq(order.needsReview, true)),
    ]);
    return { products: products[0]?.c ?? 0, orders: orders[0]?.c ?? 0 };
  }
  const db = (await import("@/lib/db")).getDb();
  const [products, orders] = await Promise.all([
    db.product.count({ where: { needsReview: true } }),
    db.order.count({ where: { needsReview: true } }),
  ]);
  return { products, orders };
}

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [review, theme, fontSize] = await Promise.all([
    countNeedsReview(), 
    getSetting("THEME_MANAGER"),
    getSetting("FONT_SIZE_MANAGER"),
  ]);
  // Bills issued with something wrong with them. Billing never stops for a
  // problem (see POST /api/finance/orders), so this count is how the manager
  // finds out there was one.
  const links = [
    ...LINKS,
    ...(review.orders > 0 ? [{ href: "/manager/orders", label: `Bill issues (${review.orders})` }] : []),
    ...(review.products > 0 ? [{ href: "/manager/review", label: `Review (${review.products})` }] : []),
  ];
  return (
    <PortalShell title="Manager" userName={session.name} links={links} theme={theme} fontSize={fontSize}>
      {children}
    </PortalShell>
  );
}
