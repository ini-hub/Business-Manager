/**
 * Dispatches a result envelope to the right visual, and always offers the table.
 *
 * The chart/table toggle lives in the card header rather than being a separate
 * "view mode" for the whole page: the table is a twin of each chart, not an
 * alternative destination.
 */

import { useState } from "react";
import { BarChart3, LineChart as LineIcon, Table2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MeasureDef, VizType, YAxisMode } from "@shared/analytics/model";
import type { AnalyticsResponse } from "@/lib/analytics/query-client";
import { TimeSeriesChart } from "./charts/TimeSeriesChart";
import { CategoryBarChart } from "./charts/CategoryBarChart";
import { ChartTableView } from "./charts/ChartTableView";
import { cn } from "@/lib/utils";

interface ResultSurfaceProps {
  result: AnalyticsResponse;
  measures: MeasureDef[];
  vizType: VizType;
  yAxisMode: YAxisMode;
  colorAssignments: Record<string, number>;
  labelFor?: (columnRef: string, value: string) => string;
  isFetching?: boolean;
  title?: string;
}

export function ResultSurface({
  result,
  measures,
  vizType,
  yAxisMode,
  colorAssignments,
  labelFor,
  isFetching,
  title,
}: ResultSurfaceProps) {
  const [showTable, setShowTable] = useState(false);

  const hasDate = result.columns.some((c) => c.ref === "date");
  const categoryDim = result.columns.find(
    (c) => c.kind === "dimension" && c.ref !== "date",
  );

  const renderChart = () => {
    if (vizType === "table") {
      return (
        <ChartTableView
          columns={result.columns}
          rows={result.rows}
          totals={result.totals}
          grain={result.meta.grain}
          labelFor={labelFor}
        />
      );
    }

    if (hasDate) {
      return (
        <TimeSeriesChart
          rows={result.rows}
          measures={measures}
          grain={result.meta.grain}
          yAxisMode={yAxisMode}
          variant={vizType === "area" ? "area" : "line"}
        />
      );
    }

    if (categoryDim && measures.length > 0) {
      return (
        <CategoryBarChart
          rows={result.rows}
          measure={measures[0]}
          dimensionRef={categoryDim.ref}
          colorAssignments={colorAssignments}
          labelFor={(v) => labelFor?.(categoryDim.ref, v) ?? v}
        />
      );
    }

    // No breakdown at all — the totals row is the whole answer, and a chart of
    // one number is just a number.
    return (
      <ChartTableView
        columns={result.columns}
        rows={result.rows}
        totals={result.totals}
        grain={result.meta.grain}
        labelFor={labelFor}
      />
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title ?? measures.map((m) => m.label).join(" · ")}
        </CardTitle>
        <ToggleGroup
          type="single"
          size="sm"
          value={showTable ? "table" : "chart"}
          onValueChange={(v) => v && setShowTable(v === "table")}
        >
          <ToggleGroupItem value="chart" aria-label="Chart view" className="h-7 w-7 p-0">
            {hasDate ? <LineIcon className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view" className="h-7 w-7 p-0">
            <Table2 className="h-3.5 w-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>

      <CardContent>
        {/* Hold the frame during a refetch: dim rather than unmount, so the page
            does not jump and the axis does not flash. */}
        <div className={cn("transition-opacity", isFetching && "opacity-50")}>
          {showTable || vizType === "table" ? (
            <ChartTableView
              columns={result.columns}
              rows={result.rows}
              totals={result.totals}
              grain={result.meta.grain}
              labelFor={labelFor}
            />
          ) : (
            renderChart()
          )}
        </div>
      </CardContent>
    </Card>
  );
}
