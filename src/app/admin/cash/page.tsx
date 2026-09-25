import { getSession } from "@/lib/auth";
import DayBook from "@/components/DayBook";

// Daily Cash & Bank reconciliation. The manager portal re-exports this page;
// the API scopes a manager to their own warehouse, an admin can pick one.
export default async function CashBankPage() {
  const session = await getSession();
  return <DayBook isAdmin={session?.role === "ADMIN"} />;
}
