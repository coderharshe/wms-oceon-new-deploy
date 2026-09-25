"use client";

import { useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";

type Log = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  timestamp: string;
  user: { name: string; staffId: string } | null;
};

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState("");
  const params = new URLSearchParams();
  if (entityType) params.set("entityType", entityType);
  const { data, error, loading, reload } = useApiGet<Log[]>(`/api/admin/audit?${params}`);
  const logs = data ?? [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Audit Log</h1>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
        <option value="">All entity types</option>
        {["Bill", "Order", "QcSession", "QcAdjustment", "PaymentTransaction", "User", "Product", "Warehouse", "CashSession"].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {loading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.timestamp)}</td>
                <td>{l.user ? `${l.user.name} (${l.user.staffId})` : "System"}</td>
                <td>{l.action}</td>
                <td>
                  {l.entityType} #{l.entityId.slice(0, 8)}
                </td>
                <td>{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
