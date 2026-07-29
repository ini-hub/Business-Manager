/**
 * Indicator panel — RSI, z-score and friends.
 *
 * Always its own panel, never a second axis on the measure chart. RSI is bounded
 * 0..100 and revenue is not; sharing an axis with naira would either flatten the
 * RSI to a line at the bottom or inflate it into a shape that implies a
 * relationship the data does not contain.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBucket } from "@/lib/analytics/format";
import { SERIES_COLORS } from "@/lib/analytics/palette";

interface IndicatorPanelProps {
  /** Bucket keys, aligned index-for-index with `values`. */
  dates: string[];
  values: (number | null)[];
  grain: string;
  title: string;
  kind: "rsi" | "zscore" | "generic";
  insufficientData?: { required: number; got: number };
}

export function IndicatorPanel({
  dates,
  values,
  grain,
  title,
  kind,
  insufficientData,
}: IndicatorPanelProps) {
  if (insufficientData) {
    // Say why it is empty rather than drawing a blank chart the user has to
    // reverse-engineer.
    return (
      <div className="rounded-md border border-dashed p-4">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Needs at least {insufficientData.required} buckets; this range has{" "}
          {insufficientData.got}. Widen the range or choose a finer grain.
        </p>
      </div>
    );
  }

  const data = dates.map((date, i) => ({ date, value: values[i] }));
  const domain: [number, number] | undefined = kind === "rsi" ? [0, 100] : undefined;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1 px-1">{title}</p>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeWidth={1} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickFormatter={(v) => formatBucket(String(v), grain)}
            minTickGap={24}
          />
          <YAxis
            domain={domain}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />

          {/* Wilder's conventional bands, solid hairlines rather than dashed. */}
          {kind === "rsi" && (
            <>
              <ReferenceLine y={70} stroke="hsl(var(--border))" strokeWidth={1} />
              <ReferenceLine y={30} stroke="hsl(var(--border))" strokeWidth={1} />
            </>
          )}
          {kind === "zscore" && (
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
          )}

          <Tooltip
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const value = payload[0].value as number | null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                  <p className="text-xs font-medium">{formatBucket(String(label), grain)}</p>
                  <p className="text-xs text-muted-foreground">
                    {title}:{" "}
                    <span className="text-foreground tabular-nums">
                      {value === null ? "—" : value.toFixed(1)}
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={SERIES_COLORS[6]}
            strokeWidth={2}
            fill={SERIES_COLORS[6]}
            fillOpacity={0.1}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
