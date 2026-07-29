/**
 * X-vs-Y scatter with a least-squares fit.
 *
 * The fit statistics are shown WITH their sample size and p-value, never alone.
 * "r = 0.9" on five points is meaningless, and an interface that shows only the
 * r invites people to act on exactly that.
 */

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ComposedChart,
} from "recharts";
import type { ValueFormat } from "@shared/analytics/model";
import { useStore } from "@/lib/store-context";
import { formatValue } from "@/lib/analytics/format";
import { SERIES_COLORS } from "@/lib/analytics/palette";

export interface ScatterResponse {
  points: { x: number; y: number; key: string; label: string }[];
  fit: { slope: number; intercept: number; r: number; r2: number; p: number; n: number } | null;
  axes: {
    x: { ref: string; label: string; format: ValueFormat };
    y: { ref: string; label: string; format: ValueFormat };
  };
  transform: string;
  warnings: string[];
}

export function ScatterRegression({ data }: { data: ScatterResponse }) {
  const { currentStore } = useStore();
  const currencyCode = currentStore?.currency ?? "NGN";

  // Two endpoints are enough to draw a straight line, and keeping it to two
  // avoids implying the model was evaluated at every observation.
  const fitLine = useMemo(() => {
    if (!data.fit || data.points.length === 0) return [];
    const xs = data.points.map((p) => p.x);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return [
      { x: min, fit: data.fit.slope * min + data.fit.intercept },
      { x: max, fit: data.fit.slope * max + data.fit.intercept },
    ];
  }, [data]);

  const fmtX = (v: number) =>
    formatValue(v, data.transform === "none" ? data.axes.x.format : "percent", {
      currencyCode,
      compact: true,
    });
  const fmtY = (v: number) =>
    formatValue(v, data.transform === "none" ? data.axes.y.format : "percent", {
      currencyCode,
      compact: true,
    });

  if (data.points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No paired observations in this range.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={data.points}
          margin={{ top: 8, right: 16, left: 8, bottom: 28 }}
        >
          <CartesianGrid stroke="hsl(var(--border))" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="x"
            name={data.axes.x.label}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickFormatter={fmtX}
            label={{
              value: data.axes.x.label,
              position: "insideBottom",
              offset: -18,
              style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={data.axes.y.label}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={70}
            tickFormatter={fmtY}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ strokeDasharray: "0", stroke: "hsl(var(--muted-foreground))" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as { label: string; x: number; y: number };
              if (point.label === undefined) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                  <p className="text-xs font-medium">{point.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.axes.x.label}:{" "}
                    <span className="text-foreground tabular-nums">{fmtX(point.x)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data.axes.y.label}:{" "}
                    <span className="text-foreground tabular-nums">{fmtY(point.y)}</span>
                  </p>
                </div>
              );
            }}
          />
          {/* r >= 4 with a surface-coloured ring, so overlapping points stay countable. */}
          <Scatter
            dataKey="y"
            fill={SERIES_COLORS[0]}
            stroke="hsl(var(--card))"
            strokeWidth={2}
            isAnimationActive={false}
          />
          {fitLine.length === 2 && (
            <Line
              data={fitLine}
              dataKey="fit"
              stroke={SERIES_COLORS[1]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {data.fit && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs px-1">
          <Stat label="r" value={data.fit.r.toFixed(3)} />
          <Stat label="R²" value={data.fit.r2.toFixed(3)} />
          <Stat
            label="p"
            value={data.fit.p < 0.001 ? "<0.001" : data.fit.p.toFixed(3)}
          />
          <Stat label="n" value={String(data.fit.n)} />
          <span className="text-muted-foreground">
            {interpret(data.fit.r, data.fit.p, data.fit.n)}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}

/**
 * A plain-language reading, so the statistics are not left to be misread.
 *
 * Deliberately refuses to call anything a relationship when p is high or n is
 * small, however impressive the r looks.
 */
function interpret(r: number, p: number, n: number): string {
  if (n < 10) return "Too few points to draw a conclusion.";
  if (p > 0.05) return "No statistically significant relationship.";
  const strength = Math.abs(r) > 0.7 ? "strong" : Math.abs(r) > 0.4 ? "moderate" : "weak";
  return `A ${strength} ${r > 0 ? "positive" : "negative"} association — not proof of cause.`;
}
