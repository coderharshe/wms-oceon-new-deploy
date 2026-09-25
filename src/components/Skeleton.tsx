/**
 * Flat pulsing placeholder blocks — no shimmer gradient, matches this repo's
 * stated "no gradients, no shadows-as-decoration" ERP look (tailwind.config.ts).
 * Built entirely on Tailwind's native `animate-pulse`, no new dependency.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-line ${className}`} />;
}

/** Drop-in for a loading `<table>` inside a `.card` — same shape real data tables use here. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card">
      <table>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton className="h-3 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The stat-tile grid used on the admin/manager dashboards. */
export function SkeletonStats({ count = 4, className = "grid grid-cols-2 gap-3 sm:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A `.card` of a few pulsing lines — for form/detail-shaped loading content. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}
