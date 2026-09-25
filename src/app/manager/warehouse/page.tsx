import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WarehouseForm } from "./WarehouseForm";

// Admin's Warehouses screen lists every branch and can create more; a manager
// gets only the one they're posted to, which is also all PATCH
// /api/admin/warehouses/[id] will accept from them. The id comes from the
// session server-side rather than a picker — there is nothing to pick.
export default async function ManagerWarehousePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.warehouseId) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Warehouse</h1>
        <p className="text-sm text-muted">Your account isn&rsquo;t assigned to a warehouse, so there is nothing to edit here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Warehouse</h1>
      <WarehouseForm warehouseId={session.warehouseId} />
    </div>
  );
}
