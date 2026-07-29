import { Skeleton } from "@/components/ui/skeleton";
import { MetricGrid } from "@/components/metric-grid";

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Metric cards row */}
      <MetricGrid>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 sm:p-6">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-3 w-16 sm:h-4 sm:w-24" />
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
            </div>
            <Skeleton className="h-6 w-20 sm:h-8 mt-1.5 sm:mt-2" />
            <Skeleton className="h-3 w-24 sm:w-32 mt-1" />
          </div>
        ))}
      </MetricGrid>

      {/* Main content card with table rows */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="p-4 border-b">
          <Skeleton className="h-9 w-full max-w-xs rounded-md" />
        </div>
        <div className="divide-y">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1 max-w-[200px]" />
              <Skeleton className="h-4 w-24 hidden sm:block" />
              <Skeleton className="h-4 w-20 hidden md:block" />
              <Skeleton className="h-4 w-16 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
