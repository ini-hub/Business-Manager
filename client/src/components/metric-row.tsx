import * as React from "react";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";

type MetricCardProps = React.ComponentProps<typeof MetricCard>;

/**
 * The metric tiles every list page opens with: a horizontally-scrollable row of
 * fixed-width tiles on phones/tablets (so they don't get squished), and the
 * regular MetricGrid from lg up. Each metric needs a unique `title`.
 */
export function MetricRow({ metrics }: { metrics: MetricCardProps[] }) {
  return (
    <>
      <div className="lg:hidden -mx-4 px-4 sm:-mx-6 sm:px-6 flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {metrics.map((m) => (
          <MetricCard key={m.title} {...m} className={["min-w-[150px] shrink-0", m.className].filter(Boolean).join(" ")} />
        ))}
      </div>
      <div className="hidden lg:block">
        <MetricGrid>
          {metrics.map((m) => <MetricCard key={m.title} {...m} />)}
        </MetricGrid>
      </div>
    </>
  );
}
