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
  actionUrl: string;
};

type AlertResponse = {
  summary: {
    critical: number;
    warning: number;
    normal: number;
  };
  critical: AlertItem[];
  warning: AlertItem[];
  normal: AlertItem[];
};

export default function ManagerAlertCenterPage() {
  const { data, error, loading, reload } = useApiGet<AlertResponse>("/api/manager/alerts");

  if (loading) return <SkeletonStats count={3} />;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Operational Alert Center (MGR-07)</h1>
          <p className="text-xs text-muted">
            Live operations problem detection: Out of stock SKUs, orders needing review, delayed tasks, and QC bottlenecks.
          </p>
        </div>
        <button onClick={reload} className="btn-secondary text-xs">
          Refresh Alerts
        </button>
      </div>

      {/* Severity Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card border-l-4 border-l-rose-500 bg-rose-50/30">
          <div className="text-xs font-bold text-rose-700 uppercase">🔴 Critical Severity</div>
          <div className="text-2xl font-extrabold text-rose-900 mt-1">{data.summary.critical}</div>
          <p className="text-xs text-rose-600 mt-1">Direct operational impact</p>
        </div>
        <div className="card border-l-4 border-l-amber-500 bg-amber-50/30">
          <div className="text-xs font-bold text-amber-700 uppercase">🟠 Operational Warnings</div>
          <div className="text-2xl font-extrabold text-amber-900 mt-1">{data.summary.warning}</div>
          <p className="text-xs text-amber-600 mt-1">Pending tasks & stock reorders</p>
        </div>
        <div className="card border-l-4 border-l-emerald-500 bg-emerald-50/30">
          <div className="text-xs font-bold text-emerald-700 uppercase">🟢 Normal Operations</div>
          <div className="text-2xl font-extrabold text-emerald-900 mt-1">{data.summary.normal}</div>
          <p className="text-xs text-emerald-600 mt-1">Active fulfillment & dispatch</p>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2 text-rose-800">
          <span>🔴 Critical Issues</span>
          <span className="badge bg-rose-100 text-rose-800 text-xs px-2 py-0.5">{data.critical.length}</span>
        </h2>
        {data.critical.length === 0 ? (
          <div className="card p-4 text-xs text-muted text-center">No critical operational issues detected.</div>
        ) : (
          <div className="space-y-2">
            {data.critical.map((item) => (
              <div
                key={item.id}
                className="card border-l-4 border-l-rose-500 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card hover:shadow transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-rose-100 text-rose-800 text-xs font-bold uppercase">{item.category}</span>
                    <span className="font-semibold text-sm text-foreground">{item.title}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{item.message}</p>
                </div>
                <div className="shrink-0">
                  <Link
                    href={item.actionUrl}
                    className="btn-primary text-xs py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-medium inline-block text-center"
                  >
                    Action →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Warnings */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold flex items-center gap-2 text-amber-800">
          <span>🟠 Warnings</span>
          <span className="badge bg-amber-100 text-amber-800 text-xs px-2 py-0.5">{data.warning.length}</span>
        </h2>
        {data.warning.length === 0 ? (
          <div className="card p-4 text-xs text-muted text-center">No operational warnings.</div>
        ) : (
          <div className="space-y-2">
            {data.warning.map((item) => (
              <div
                key={item.id}
                className="card border-l-4 border-l-amber-500 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card hover:shadow transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="badge bg-amber-100 text-amber-800 text-xs font-bold uppercase">{item.category}</span>
                    <span className="font-semibold text-sm text-foreground">{item.title}</span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{item.message}</p>
                </div>
                <div className="shrink-0">
                  <Link
                    href={item.actionUrl}
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
    </div>
  );
}
