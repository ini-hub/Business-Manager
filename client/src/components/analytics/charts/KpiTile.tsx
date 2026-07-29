/**
 * KPI tile: label, value, signed delta against a NAMED period, and a sparkline.
 *
 * The delta is coloured by polarity x direction, not direction alone — expenses
 * rising is not good news, and a green "+12%" on a cost measure is a lie.
 */

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { MeasureDef } from "@shared/analytics/model";
import { useStore } from "@/lib/store-context";
import { deltaTone, formatDelta, formatValue } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

interface KpiTileProps {
  measure: MeasureDef;
  value: number | null;
  previousValue?: number | null;
  /** Name of the comparison period, e.g. "previous 30 days". Never just "last period". */
  comparisonLabel?: string;
  sparkline?: (number | null)[];
}

export function KpiTile({
  measure,
  value,
  previousValue = null,
  comparisonLabel,
  sparkline,
}: KpiTileProps) {
  const { currentStore } = useStore();
  const currencyCode = currentStore?.currency ?? "NGN";

  const delta = formatDelta(value, previousValue);
  const tone = delta ? deltaTone(delta.direction, measure.polarity) : "neutral";
  const DeltaIcon =
    delta?.direction === "up" ? TrendingUp : delta?.direction === "down" ? TrendingDown : Minus;

  const sparkData = (sparkline ?? [])
    .map((v, i) => ({ i, v }))
    .filter((p) => p.v !== null);

  return (
    <Card className="h-full">
      <CardContent className="p-3 sm:p-4">
        <p
          className="text-[11px] leading-tight sm:text-xs text-muted-foreground line-clamp-2"
          title={measure.description}
        >
          {measure.label}
        </p>

        {/* Proportional figures: tabular-nums makes a large standalone number look loose. */}
        <p className="text-lg sm:text-2xl font-semibold mt-1">
          {formatValue(value, measure.format, { currencyCode, compact: true })}
        </p>

        {delta && (
          <p
            className={cn(
              "text-[10px] sm:text-xs mt-1 flex items-center gap-1",
              tone === "positive" && "text-emerald-600 dark:text-emerald-500",
              tone === "negative" && "text-red-600 dark:text-red-500",
              tone === "neutral" && "text-muted-foreground",
            )}
          >
            <DeltaIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">{delta.text}</span>
            {comparisonLabel && (
              <span className="text-muted-foreground truncate">vs {comparisonLabel}</span>
            )}
          </p>
        )}

        {/* At half a phone's width a sparkline is noise, and it costs 40px of height per row. */}
        {sparkData.length > 1 && (
          <div className="hidden sm:block h-8 mt-2 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--viz-1))"
                  strokeWidth={1.5}
                  fill="hsl(var(--viz-1))"
                  fillOpacity={0.1}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
