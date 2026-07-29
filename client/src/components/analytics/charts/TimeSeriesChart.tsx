/**
 * Time series (line / area), one panel per unit.
 *
 * The important rule here is that there is NO dual axis. "How do modules
 * interact" always ends up putting naira next to a day-count or a percentage,
 * and two y-scales on one plot invent a relationship that is not in the data —
 * you can make any two series appear to track by choosing the scales. So
 * measures are grouped by their declared format and each group gets its own
 * stacked panel sharing one x-axis. `indexed` mode is the single-axis
 * alternative: rebase everything to 100 at t0 and compare shape honestly.
 */

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MeasureDef, ResultRow, ValueFormat, YAxisMode } from "@shared/analytics/model";
import { useStore } from "@/lib/store-context";
import { formatBucket, formatValue } from "@/lib/analytics/format";
import { SERIES_COLORS } from "@/lib/analytics/palette";

interface TimeSeriesChartProps {
  rows: ResultRow[];
  measures: MeasureDef[];
  grain: string;
  yAxisMode: YAxisMode;
  variant?: "line" | "area";
}

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export function TimeSeriesChart({
  rows,
  measures,
  grain,
  yAxisMode,
  variant = "line",
}: TimeSeriesChartProps) {
  const { currentStore } = useStore();
  const currencyCode = currentStore?.currency ?? "NGN";

  /** Rebase each series to 100 at its first non-null point. */
  const indexedRows = useMemo(() => {
    if (yAxisMode !== "indexed") return rows;
    const bases = new Map<string, number>();
    for (const measure of measures) {
      const first = rows.find(
        (r) => typeof r[measure.id] === "number" && r[measure.id] !== 0,
      );
      if (first) bases.set(measure.id, first[measure.id] as number);
    }
    return rows.map((row) => {
      const out: ResultRow = { date: row.date };
      for (const measure of measures) {
        const base = bases.get(measure.id);
        const value = row[measure.id];
        out[measure.id] =
          base && typeof value === "number" ? (value / base) * 100 : null;
      }
      return out;
    });
  }, [rows, measures, yAxisMode]);

  /**
   * Panels: one per distinct format unless the caller forced a shared axis.
   * Differing units on one axis is the thing we refuse to draw.
   */
  const panels = useMemo(() => {
    if (yAxisMode === "indexed") return [{ format: "number" as ValueFormat, measures }];
    if (yAxisMode === "shared") {
      return [{ format: measures[0]?.format ?? "number", measures }];
    }
    const groups = new Map<ValueFormat, MeasureDef[]>();
    for (const measure of measures) {
      if (!groups.has(measure.format)) groups.set(measure.format, []);
      groups.get(measure.format)!.push(measure);
    }
    return Array.from(groups.entries()).map(([format, ms]) => ({ format, measures: ms }));
  }, [measures, yAxisMode]);

  const data = yAxisMode === "indexed" ? indexedRows : rows;
  const colorOf = (measureId: string) =>
    SERIES_COLORS[measures.findIndex((m) => m.id === measureId) % SERIES_COLORS.length];

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No data for this selection.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {panels.map((panel, panelIndex) => {
        const Chart = variant === "area" ? AreaChart : LineChart;
        const isLast = panelIndex === panels.length - 1;

        return (
          <div key={panel.format}>
            {panels.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground mb-1 px-1">
                {panel.measures.map((m) => m.label).join(" · ")}
              </p>
            )}
            <ResponsiveContainer width="100%" height={panels.length > 1 ? 180 : 320}>
              <Chart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                {/* Recessive, solid hairlines — never dashed. */}
                <CartesianGrid
                  vertical={false}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => formatBucket(String(v), grain)}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  // Only the bottom panel carries tick labels; they share an x-axis.
                  hide={!isLast && panels.length > 1}
                  minTickGap={24}
                />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) =>
                    formatValue(Number(v), panel.format, { currencyCode, compact: true })
                  }
                />
                {yAxisMode === "indexed" && (
                  <ReferenceLine y={100} stroke="hsl(var(--border))" strokeWidth={1} />
                )}
                <Tooltip
                  cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                        <p className="text-xs font-medium mb-1">
                          {formatBucket(String(label), grain)}
                        </p>
                        {payload.map((entry) => {
                          const measure = measures.find((m) => m.id === entry.dataKey);
                          return (
                            <div
                              key={String(entry.dataKey)}
                              className="flex items-center gap-2 text-xs"
                            >
                              {/* Identity comes from the swatch; the text stays in ink tokens. */}
                              <span
                                className="h-2 w-2 rounded-[2px] shrink-0"
                                style={{ background: entry.color }}
                              />
                              <span className="text-muted-foreground">
                                {measure?.label ?? String(entry.dataKey)}
                              </span>
                              <span className="ml-auto font-medium tabular-nums">
                                {yAxisMode === "indexed"
                                  ? Number(entry.value).toFixed(1)
                                  : formatValue(
                                      entry.value as number,
                                      measure?.format ?? "number",
                                      { currencyCode },
                                    )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                {panel.measures.map((measure) =>
                  variant === "area" ? (
                    <Area
                      key={measure.id}
                      type="monotone"
                      dataKey={measure.id}
                      stroke={colorOf(measure.id)}
                      strokeWidth={2}
                      fill={colorOf(measure.id)}
                      fillOpacity={0.1}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                      connectNulls={false}
                    />
                  ) : (
                    <Line
                      key={measure.id}
                      type="monotone"
                      dataKey={measure.id}
                      stroke={colorOf(measure.id)}
                      strokeWidth={2}
                      strokeLinecap="round"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                      connectNulls={false}
                    />
                  ),
                )}
              </Chart>
            </ResponsiveContainer>
          </div>
        );
      })}

      {/* A legend is always present for >= 2 series; a single series is named by the title. */}
      {measures.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
          {measures.map((measure) => (
            <span key={measure.id} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ background: colorOf(measure.id) }}
              />
              <span className="text-muted-foreground">{measure.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
