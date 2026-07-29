/**
 * Categorical bars — one measure across the members of one dimension.
 *
 * Horizontal by default: category names are words, and horizontal bars give them
 * room to be read without rotating labels 45 degrees.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MeasureDef, ResultRow } from "@shared/analytics/model";
import { OTHER_MEMBER_KEY, OTHER_MEMBER_LABEL } from "@shared/analytics/constants";
import { useStore } from "@/lib/store-context";
import { formatValue } from "@/lib/analytics/format";
import { colorFor } from "@/lib/analytics/palette";

interface CategoryBarChartProps {
  rows: ResultRow[];
  measure: MeasureDef;
  dimensionRef: string;
  colorAssignments: Record<string, number>;
  labelFor?: (value: string) => string;
}

export function CategoryBarChart({
  rows,
  measure,
  dimensionRef,
  colorAssignments,
  labelFor,
}: CategoryBarChartProps) {
  const { currentStore } = useStore();
  const currencyCode = currentStore?.currency ?? "NGN";

  const data = rows
    .map((row) => {
      const key = String(row[dimensionRef] ?? "");
      return {
        key,
        label: key === OTHER_MEMBER_KEY ? OTHER_MEMBER_LABEL : (labelFor?.(key) ?? key),
        value: typeof row[measure.id] === "number" ? (row[measure.id] as number) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No data for this selection.
      </p>
    );
  }

  // Bars stay thin; the container grows with the category count instead.
  const height = Math.max(220, data.length * 32 + 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
        barCategoryGap={8}
      >
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeWidth={1} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          tickFormatter={(v) =>
            formatValue(Number(v), measure.format, { currencyCode, compact: true })
          }
        />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.4 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as { label: string; value: number };
            return (
              <div className="rounded-md border bg-popover px-3 py-2 shadow-md">
                <p className="text-xs font-medium">{point.label}</p>
                <p className="text-xs text-muted-foreground">
                  {measure.label}:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatValue(point.value, measure.format, { currencyCode })}
                  </span>
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.key} fill={colorFor(point.key, colorAssignments)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
