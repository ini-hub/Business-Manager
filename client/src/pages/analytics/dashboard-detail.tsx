/**
 * One dashboard: a 12-column grid of tiles, each re-running its own query.
 *
 * The grid is hand-rolled CSS rather than a drag-and-drop library. Tiles get a
 * width preset and move up/down — that covers the actual need (arranging a few
 * panels) without adding a dependency and a whole interaction model for what is
 * mostly a one-time layout decision.
 *
 * The date range lives at the dashboard level and scopes every tile, so the
 * panels are always comparable with each other.
 */

import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { AlertTriangle, ArrowDown, ArrowUp, Maximize2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { useAnalyticsQuery } from "@/hooks/useAnalyticsQuery";
import { useAnalyticsModel } from "@/hooks/useAnalyticsModel";
import { TimeSeriesChart } from "@/components/analytics/charts/TimeSeriesChart";
import { CategoryBarChart } from "@/components/analytics/charts/CategoryBarChart";
import { ChartTableView } from "@/components/analytics/charts/ChartTableView";
import { assignColors } from "@/lib/analytics/palette";
import type { AnalyticsViewSpec } from "@shared/analytics/query";
import type { MeasureDef } from "@shared/analytics/model";
import { cn } from "@/lib/utils";

interface Tile {
  id: string;
  spec: AnalyticsViewSpec | null;
  resolvedTitle: string;
  gridW: number;
  gridY: number;
  overridesDateRange: boolean;
}

interface DashboardResponse {
  id: string;
  name: string;
  description: string | null;
  tiles: Tile[];
  warnings: string[];
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

const WIDTH_PRESETS = [
  { label: "Quarter", value: 3 },
  { label: "Third", value: 4 },
  { label: "Half", value: 6 },
  { label: "Full", value: 12 },
];

export default function AnalyticsDashboardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });

  const dashboard = useQuery<DashboardResponse>({
    queryKey: [`/api/analytics/dashboards/${id}`],
    enabled: Boolean(id),
  });

  const updateTile = useMutation({
    mutationFn: async ({ tileId, ...patch }: { tileId: string; gridW?: number; gridY?: number }) =>
      apiRequest("PATCH", `/api/analytics/tiles/${tileId}`, patch),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [`/api/analytics/dashboards/${id}`] }),
  });

  const removeTile = useMutation({
    mutationFn: async (tileId: string) => apiRequest("DELETE", `/api/analytics/tiles/${tileId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [`/api/analytics/dashboards/${id}`] }),
  });

  const tiles = useMemo(
    () => [...(dashboard.data?.tiles ?? [])].sort((a, b) => a.gridY - b.gridY),
    [dashboard.data],
  );

  const move = (tile: Tile, direction: -1 | 1) => {
    const index = tiles.findIndex((t) => t.id === tile.id);
    const swap = tiles[index + direction];
    if (!swap) return;
    updateTile.mutate({ tileId: tile.id, gridY: swap.gridY });
    updateTile.mutate({ tileId: swap.id, gridY: tile.gridY });
  };

  if (dashboard.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>That dashboard could not be opened.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={dashboard.data.name}
        description={dashboard.data.description ?? undefined}
      />

      {/* Dashboard-level scope: every tile below answers for the same window. */}
      <Card>
        <CardContent className="p-3">
          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            timezone={currentStore?.timezone}
          />
        </CardContent>
      </Card>

      {dashboard.data.warnings?.map((warning) => (
        <Alert key={warning}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{warning}</AlertDescription>
        </Alert>
      ))}

      {tiles.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium">This dashboard is empty</p>
            <p className="text-xs text-muted-foreground mt-1">
              Build a view in the Explorer and use Pin to add it here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-12 gap-3">
        {tiles.map((tile, index) => (
          <DashboardTile
            key={tile.id}
            tile={tile}
            dateRange={dateRange}
            onResize={(gridW) => updateTile.mutate({ tileId: tile.id, gridW })}
            onMoveUp={index > 0 ? () => move(tile, -1) : undefined}
            onMoveDown={index < tiles.length - 1 ? () => move(tile, 1) : undefined}
            onRemove={() => removeTile.mutate(tile.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardTile({
  tile,
  dateRange,
  onResize,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  tile: Tile;
  dateRange: DateRange;
  onResize: (gridW: number) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  const { data: model } = useAnalyticsModel();

  // A tile whose date range is not overridden takes the dashboard's.
  const body = useMemo(() => {
    if (!tile.spec || !dateRange.from || !dateRange.to) return null;
    const query = tile.spec.query;
    if (tile.overridesDateRange) return query;
    return {
      ...query,
      time: { ...query.time, from: iso(dateRange.from), to: iso(dateRange.to) },
    };
  }, [tile, dateRange]);

  const { data: result, isFetching } = useAnalyticsQuery(body as any);

  const measureDefs = useMemo(
    () =>
      (tile.spec?.query.measures ?? [])
        .map((id) => model?.measures.find((m) => m.id === id))
        .filter((m): m is MeasureDef => Boolean(m)),
    [tile.spec, model],
  );

  const colorAssignments = useMemo(() => {
    if (!result) return {};
    const dim = result.columns.find((c) => c.kind === "dimension" && c.ref !== "date");
    if (!dim) return {};
    return assignColors(Array.from(new Set(result.rows.map((r) => String(r[dim.ref] ?? "")))));
  }, [result]);

  const span =
    tile.gridW >= 12
      ? "col-span-12"
      : tile.gridW >= 6
        ? "col-span-12 lg:col-span-6"
        : tile.gridW >= 4
          ? "col-span-12 md:col-span-6 lg:col-span-4"
          : "col-span-12 md:col-span-6 lg:col-span-3";

  const hasDate = result?.columns.some((c) => c.ref === "date");
  const categoryDim = result?.columns.find((c) => c.kind === "dimension" && c.ref !== "date");

  return (
    <Card className={span}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium truncate">{tile.resolvedTitle}</CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {WIDTH_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.value}
                onSelect={() => onResize(preset.value)}
                className="text-xs"
              >
                {preset.label} width
                {tile.gridW === preset.value && " ✓"}
              </DropdownMenuItem>
            ))}
            {onMoveUp && (
              <DropdownMenuItem onSelect={onMoveUp} className="text-xs">
                <ArrowUp className="h-3 w-3" /> Move up
              </DropdownMenuItem>
            )}
            {onMoveDown && (
              <DropdownMenuItem onSelect={onMoveDown} className="text-xs">
                <ArrowDown className="h-3 w-3" /> Move down
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={onRemove}
              className="text-xs text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent>
        {!tile.spec && (
          <p className="text-xs text-muted-foreground py-8 text-center">
            The saved view behind this tile is no longer available.
          </p>
        )}

        {tile.spec && !result && <Skeleton className="h-40 w-full" />}

        {result && (
          <div className={cn("transition-opacity", isFetching && "opacity-50")}>
            {hasDate ? (
              <TimeSeriesChart
                rows={result.rows}
                measures={measureDefs}
                grain={result.meta.grain}
                yAxisMode={tile.spec?.yAxisMode ?? "panels"}
                variant={tile.spec?.vizType === "area" ? "area" : "line"}
              />
            ) : categoryDim && measureDefs.length > 0 ? (
              <CategoryBarChart
                rows={result.rows}
                measure={measureDefs[0]}
                dimensionRef={categoryDim.ref}
                colorAssignments={colorAssignments}
              />
            ) : (
              <ChartTableView
                columns={result.columns}
                rows={result.rows}
                totals={result.totals}
                grain={result.meta.grain}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
