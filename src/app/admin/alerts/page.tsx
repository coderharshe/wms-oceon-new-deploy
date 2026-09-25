"use client";

import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { SkeletonStats } from "@/components/Skeleton";
import { ErrorRetry } from "@/components/ErrorRetry";

type AlertItem = {
  id: string;
  category: string;
  title: string;
  message: string;
  timestamp: string;
  actionUrl: string;
};

type AlertResponse = {
  summary: {
    critical: number;
    warning: number;
    info: number;
    total: number;
  };
  criticalAlerts: AlertItem[];
  warningAlerts: AlertItem[];
  infoAlerts: AlertItem[];
};

export default function AdminAlertCenterPage() {
  const { data, error, loading, reload } = useApiGet<AlertResponse>("/api/admin/alerts");

  if (loading) return <SkeletonStats count={3} />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Executive Alert Center (ADM-11)</h1>
          <p className="text-xs text-muted">
            Real-time critical business alerts: Cash/Bank discrepancies, OOS SKUs, overdue payables/receivables & pending approvals.
          </p>
        </div>
        <button onClick={reload} className="btn-secondary text-xs">
          Refresh Alerts
        </button>
      </div>

      {/* Summary KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card border-l-4 border-l-rose-500 bg-rose-50/30">
          <div className="text-xs font-bold text-rose-700 uppercase">🔴 Critical Severity</div>
          <div className="text-2xl font-extrabold text-rose-900 mt-1">{data.summary.critical}</div>
          <p className="text-xs text-rose-600 mt-1">Requires immediate executive action</p>
        </div>
        <div className="card border-l-4 border-l-amber-500 bg-amber-50/30">
          <div className="text-xs font-bold text-amber-700 uppercase">🟠 Operational Warnings</div>
          <div className="text-2xl font-extrabold text-amber-900 mt-1">{data.summary.warning}</div>
          <p className="text-xs text-amber-600 mt-1">Inventory & financial attention required</p>
        </div>
        <div className="card border-l-4 border-l-blue-500 bg-blue-50/30">
          <div className="text-xs font-bold text-blue-700 uppercase">🟡 System Notices</div>
          <div className="text-2xl font-extrabold text-blue-900 mt-1">{data.summary.info}</div>
          <p className="text-xs text-blue-600 mt-1">Pending queues & approvals</p>
        </div>
      </div>

      {/* Critical Alerts Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2 text-rose-800">
          <span>🔴 Critical Alerts</span>
          <span className="badge bg-rose-100 text-rose-800 text-xs px-2 py-0.5">{data.criticalAlerts.length}</span>
        </h2>
        {data.criticalAlerts.length === 0 ? (
          <div className="card p-4 text-xs text-muted text-center">No critical alerts detected. All systems healthy.</div>
        ) : (
          <div className="space-y-2">
            {data.criticalAlerts.map((alert) => (
              <div
                key={alert.id}
                className="card border-l-4 border-l-rose-500 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card hover:shadow transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-rose-100 text-rose-800 text-xs font-bold uppercase">{alert.category}</span>
                    <span className="font-semibold text-sm text-foreground">{alert.title}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{alert.message}</p>
                </div>
                <div className="shrink-0">
                  <Link
                    href={alert.actionUrl}
                    className="btn-primary text-xs py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-medium inline-block text-center"
                  >
                    Resolve Alert →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Warning Alerts Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2 text-amber-800">
          <span>🟠 Warnings</span>
          <span className="badge bg-amber-100 text-amber-800 text-xs px-2 py-0.5">{data.warningAlerts.length}</span>
        </h2>
        {data.warningAlerts.length === 0 ? (
          <div className="card p-4 text-xs text-muted text-center">No operational warnings.</div>
        ) : (
          <div className="space-y-2">
            {data.warningAlerts.map((alert) => (
              <div
                key={alert.id}
                className="card border-l-4 border-l-amber-500 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card hover:shadow transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-amber-100 text-amber-800 text-xs font-bold uppercase">{alert.category}</span>
                    <span className="font-semibold text-sm text-foreground">{alert.title}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{alert.message}</p>
                </div>
                <div className="shrink-0">
                  <Link
                    href={alert.actionUrl}
                    className="btn-secondary text-xs py-1.5 px-3 text-amber-800 border-amber-300 hover:bg-amber-50 inline-block text-center"
                  >
                    Inspect →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System & Approvals Notices */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2 text-blue-800">
          <span>🟡 Pending Approvals & Notices</span>
          <span className="badge bg-blue-100 text-blue-800 text-xs px-2 py-0.5">{data.infoAlerts.length}</span>
        </h2>
        {data.infoAlerts.length === 0 ? (
          <div className="card p-4 text-xs text-muted text-center">No pending items in queues.</div>
        ) : (
          <div className="space-y-2">
            {data.infoAlerts.map((alert) => (
              <div
                key={alert.id}
                className="card border-l-4 border-l-blue-500 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card hover:shadow transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-blue-100 text-blue-800 text-xs font-bold uppercase">{alert.category}</span>
                    <span className="font-semibold text-sm text-foreground">{alert.title}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{alert.message}</p>
                </div>
                <div className="shrink-0">
                  <Link
                    href={alert.actionUrl}
                    className="btn-secondary text-xs py-1.5 px-3 text-blue-800 border-blue-300 hover:bg-blue-50 inline-block text-center"
                  >
                    View Approvals Hub →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
