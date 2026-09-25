"use client";

import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";

type Log = { id: string; action: string; entityType: string; entityId: string; reason: string | null; timestamp: string; user: { name: string } | null };

export default function ManagerAuditPage() {
  const { data, error, loading, reload } = useApiGet<Log[]>("/api/admin/audit");
  const logs = data ?? [];

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Audit Log (this warehouse)</h1>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {loading ? (
        <SkeletonTable rows={8} cols={4} />
      ) : (
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.timestamp)}</td>
                <td>{l.user?.name ?? "System"}</td>
                <td>{l.action}</td>
                <td>
                  {l.entityType} #{l.entityId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
