"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditCustomerModal, type EditableCustomer } from "@/components/EditCustomerModal";

type Customer = EditableCustomer;

export default function AdminCustomersPage() {
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useApiGet<Customer[]>(`/api/customers?q=${encodeURIComponent(q)}`);
  const list = data ?? [];
  const [editing, setEditing] = useState<Customer | null>(null);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Customers</h1>
      <input className="w-64" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Owner</th>
                <th>Mobile</th>
                <th>Type</th>
                <th>Credit limit</th>
                <th>To collect</th>
                <th>Available</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const limit = c.creditLimit === null ? null : Number(c.creditLimit);
                const outstanding = Number(c.outstandingBalance);
                const available = limit === null ? null : limit - outstanding;
                const overLimit = available !== null && available < 0;
                return (
                  <tr key={c.id}>
                    <td>{c.shopName}</td>
                    <td>{c.ownerName}</td>
                    <td>{c.mobile || "—"}</td>
                    <td>{c.type}</td>
                    <td>{limit === null ? "No limit" : `₹${limit.toFixed(2)}`}</td>
                    <td className={overLimit ? "text-bad" : undefined}>₹{outstanding.toFixed(2)}</td>
                    <td className={overLimit ? "text-bad" : undefined}>{available === null ? "—" : `₹${available.toFixed(2)}`}</td>
                    <td>{c.status}</td>
                    <td>
                      <button className="btn" onClick={() => setEditing(c)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditCustomerModal customer={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
