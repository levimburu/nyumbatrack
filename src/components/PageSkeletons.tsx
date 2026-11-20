import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared skeleton loaders. Each one mirrors the layout of the content it
 * stands in for, so the page doesn't jump when real data arrives.
 */

/** One list row: avatar + two text lines + a trailing pill. */
function RowSkeleton() {
  return (
    <div className="card-surface flex items-center gap-3 p-4">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
    </div>
  );
}

/** A stack of list rows. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <RowSkeleton key={i} />
      ))}
    </div>
  );
}

/** A grid of cards with an image strip, used for properties / vacancies. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-surface overflow-hidden">
          <Skeleton className="h-32 w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Row of small stat cards. */
export function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${Math.min(count, 4)}, minmax(0, 1fr))` }}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-6 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Page header: title, subtitle and an action button. */
function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-10 w-28 rounded-xl" />
    </div>
  );
}

/**
 * Full page skeleton: header, optional stat cards, then rows or a card grid.
 * Drop-in replacement for the old centred "Loading..." text.
 */
export function PageSkeleton({
  stats = 0,
  rows = 5,
  variant = "list",
}: {
  stats?: number;
  rows?: number;
  variant?: "list" | "grid";
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6" role="status" aria-label="Loading">
      <HeaderSkeleton />
      {stats > 0 && <StatCardsSkeleton count={stats} />}
      {variant === "grid" ? <CardGridSkeleton count={rows} /> : <ListSkeleton rows={rows} />}
    </div>
  );
}

/** Portfolio dashboard: stat cards, two chart cards and a wide trend card. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-surface flex items-center justify-between p-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-14" />
            </div>
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-surface space-y-4 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mx-auto h-28 w-28 rounded-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="card-surface space-y-4 p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

/** Full-screen app shell skeleton: top bar plus content. Used before auth/role is known. */
export function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-label="Loading">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <HeaderSkeleton />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}

/** Table rows for desktop tables. Render inside <tbody>. */
export function TableRowsSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-5 py-4">
              <Skeleton className={c === 0 ? "h-4 w-32" : "h-4 w-20"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Compact lines for small panels (payment history, summaries). */
export function LinesSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Two stacked cards, used for the detail pages and company forms. */
export function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-48" />
      <div className="card-surface space-y-3 p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="card-surface space-y-3 p-5">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}
