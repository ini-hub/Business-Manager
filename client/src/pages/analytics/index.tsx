/**
 * Analytics Explorer.
 *
 * Self-serve querying over the semantic model: pick measures and breakdowns,
 * choose a grain, and the server compiles it to aggregate SQL. Store is a
 * first-class dimension, so all accessible stores are queried in one pass and can
 * be compared side by side.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { format, subDays } from "date-fns";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { useStore } from "@/lib/store-context";
import { useAnalyticsModel } from "@/hooks/useAnalyticsModel";
import { useAnalyticsQuery } from "@/hooks/useAnalyticsQuery";
import { MeasurePicker } from "@/components/analytics/MeasurePicker";
import { DimensionPicker } from "@/components/analytics/DimensionPicker";
import { GrainControl } from "@/components/analytics/GrainControl";
import { ResultSurface } from "@/components/analytics/ResultSurface";
import { RelationshipPanel } from "@/components/analytics/RelationshipPanel";
import { KpiTile } from "@/components/analytics/charts/KpiTile";
import { MetricGrid } from "@/components/metric-grid";
import { SaveViewDialog } from "@/components/analytics/SaveViewDialog";
import { PinToDashboardDialog } from "@/components/analytics/PinToDashboardDialog";
import { ExportToolbar } from "@/components/export-toolbar";
import {
  buildExportColumns,
  buildExportRows,
  buildPdfReport,
} from "@/lib/analytics/to-export";
import { assignColors } from "@/lib/analytics/palette";
import type {
  ComparePeriod,
  Grain,
  MeasureDef,
  VizType,
  YAxisMode,
} from "@shared/analytics/model";
import type { AnalyticsQueryInput, AnalyticsViewSpec } from "@shared/analytics/query";

const DEFAULT_MEASURES = ["sales.net_revenue", "sales.gross_profit"];
const iso = (d: Date) => format(d, "yyyy-MM-dd");

export default function AnalyticsExplorerPage() {
  const { currentStore, stores, business } = useStore();
  const { data: model, isLoading: modelLoading, error: modelError } = useAnalyticsModel();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });
  const [measures, setMeasures] = useState<string[]>(DEFAULT_MEASURES);
  const [dimensions, setDimensions] = useState<string[]>(["date"]);
  const [grain, setGrain] = useState<Grain>("day");
  const [customBucketDays, setCustomBucketDays] = useState<number | undefined>();
  const [compare, setCompare] = useState<ComparePeriod>("previous_period");
  const [vizType, setVizType] = useState<VizType>("line");
  const [yAxisMode, setYAxisMode] = useState<YAxisMode>("panels");

  const measureDefs = useMemo(
    () =>
      measures
        .map((id) => model?.measures.find((m) => m.id === id))
        .filter((m): m is MeasureDef => Boolean(m)),
    [measures, model],
  );

  /**
   * Store scope. "All stores" is not a fan-out here: every accessible store id
   * goes into one query and Store becomes a groupable dimension.
   */
  const storeIds = useMemo(() => {
    if (!model) return [];
    if (currentStore && currentStore.id !== "all") return [currentStore.id];
    return model.storeIds;
  }, [model, currentStore]);

  const queryBody: AnalyticsQueryInput | null = useMemo(() => {
    if (!model || storeIds.length === 0 || measures.length === 0) return null;
    if (!dateRange.from || !dateRange.to) return null;

    return {
      storeIds,
      measures,
      dimensions,
      time: {
        from: iso(dateRange.from),
        to: iso(dateRange.to),
        grain,
        ...(grain === "custom" ? { customBucketDays: customBucketDays ?? 10 } : {}),
        compare,
      },
    };
  }, [model, storeIds, measures, dimensions, dateRange, grain, customBucketDays, compare]);

  const { data: result, isFetching, error: queryError } = useAnalyticsQuery(queryBody);

  /** Colour follows the entity: a stable member -> slot map, not the sort order. */
  const colorAssignments = useMemo(() => {
    if (!result) return {};
    const dim = result.columns.find((c) => c.kind === "dimension" && c.ref !== "date");
    if (!dim) return {};
    return assignColors(
      Array.from(new Set(result.rows.map((r) => String(r[dim.ref] ?? "")))),
    );
  }, [result]);

  const storeNames = useMemo(
    () => new Map(stores.map((s) => [s.id, s.name])),
    [stores],
  );

  const labelFor = (columnRef: string, value: string) =>
    columnRef === "store" ? (storeNames.get(value) ?? value) : value;

  /** Sparkline series for a KPI tile, in bucket order. */
  const sparkFor = (measureId: string): (number | null)[] | undefined => {
    if (!result || !dimensions.includes("date")) return undefined;
    return result.rows.map((r) =>
      typeof r[measureId] === "number" ? (r[measureId] as number) : null,
    );
  };

  const mixedFormats = new Set(measureDefs.map((m) => m.format)).size > 1;

  /** The saveable/pinnable document: the query plus how it is being displayed. */
  const viewSpec: AnalyticsViewSpec | null = useMemo(
    () =>
      queryBody
        ? {
            query: queryBody as AnalyticsViewSpec["query"],
            vizType,
            yAxisMode,
            colorAssignments,
          }
        : null,
    [queryBody, vizType, yAxisMode, colorAssignments],
  );

  const periodLabel =
    dateRange.from && dateRange.to
      ? `${iso(dateRange.from)} to ${iso(dateRange.to)}`
      : "All time";

  const exportPayload = useMemo(() => {
    if (!result) return null;
    const context = {
      businessName: business?.name ?? "",
      storeName: currentStore?.id === "all" ? "All stores" : (currentStore?.name ?? ""),
      periodLabel,
      grain: result.meta.grain,
      currencyCode: currentStore?.currency ?? "NGN",
      labelFor,
    };
    const rows = buildExportRows(result.columns, result.rows, context);
    return {
      rows,
      columns: buildExportColumns(result.columns),
      pdfReport: buildPdfReport(
        result.columns,
        rows,
        measureDefs,
        result.totals,
        context,
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, measureDefs, business, currentStore, periodLabel]);

  /** Restores a saved view into the page controls. */
  const applySpec = (spec: AnalyticsViewSpec) => {
    setMeasures(spec.query.measures);
    setDimensions(spec.query.dimensions ?? []);
    setGrain(spec.query.time.grain as Grain);
    setCustomBucketDays(spec.query.time.customBucketDays);
    setCompare(spec.query.time.compare as ComparePeriod);
    setVizType(spec.vizType as VizType);
    setYAxisMode(spec.yAxisMode as YAxisMode);
    setDateRange({
      from: new Date(`${spec.query.time.from}T00:00:00`),
      to: new Date(`${spec.query.time.to}T00:00:00`),
    });
  };

  if (modelLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics Explorer" description="Loading the data model…" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (modelError || !model) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics Explorer" />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Could not load the analytics model. Refresh to try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics Explorer"
        description="Combine any measures and breakdowns across your business, at any time grain."
      />

      {/* One filter row above everything — it scopes every panel below. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              timezone={currentStore?.timezone}
            />
            <GrainControl
              grain={grain}
              customBucketDays={customBucketDays}
              compare={compare}
              onGrainChange={(g, days) => {
                setGrain(g);
                setCustomBucketDays(days);
              }}
              onCompareChange={setCompare}
            />
          </div>

          <MeasurePicker
            measures={model.measures}
            cubes={model.cubes}
            selected={measures}
            onChange={setMeasures}
          />

          <DimensionPicker
            dimensions={model.dimensions}
            measures={model.measures}
            selectedMeasures={measures}
            selected={dimensions}
            onChange={setDimensions}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select value={vizType} onValueChange={(v) => setVizType(v as VizType)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line" className="text-xs">Line</SelectItem>
                <SelectItem value="area" className="text-xs">Area</SelectItem>
                <SelectItem value="bar" className="text-xs">Bar</SelectItem>
                <SelectItem value="table" className="text-xs">Table</SelectItem>
              </SelectContent>
            </Select>

            {/* Only offered when every measure shares a unit — see below. */}
            <Select value={yAxisMode} onValueChange={(v) => setYAxisMode(v as YAxisMode)}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="panels" className="text-xs">
                  Separate panels
                </SelectItem>
                <SelectItem value="indexed" className="text-xs">
                  Indexed to 100
                </SelectItem>
                <SelectItem value="shared" className="text-xs" disabled={mixedFormats}>
                  Shared axis{mixedFormats ? " (mixed units)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>

            {isFetching && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Updating…
              </span>
            )}

            {/* Right-aligned once there is room; wraps in place on narrow screens
                instead of pushing past the card edge. */}
            <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
              <SaveViewDialog spec={viewSpec} onLoad={applySpec} />
              <PinToDashboardDialog
                spec={viewSpec}
                defaultTitle={measureDefs.map((m) => m.label).join(" · ") || "Analytics"}
              />
              {exportPayload && (
                <ExportToolbar
                  data={exportPayload.rows}
                  columns={exportPayload.columns}
                  filename="analytics"
                  title="Analytics"
                  pdfReport={exportPayload.pdfReport}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {queryError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {queryError instanceof Error ? queryError.message : "That query could not be run."}
          </AlertDescription>
        </Alert>
      )}

      {result?.warnings?.map((warning) => (
        <Alert key={warning}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{warning}</AlertDescription>
        </Alert>
      ))}

      {result && (
        <>
          <MetricGrid>
            {measureDefs.map((measure) => (
              <KpiTile
                key={measure.id}
                measure={measure}
                value={result.totals[measure.id] ?? null}
                previousValue={result.comparison?.totals?.[measure.id] ?? null}
                comparisonLabel={result.comparison?.label}
                sparkline={sparkFor(measure.id)}
              />
            ))}
          </MetricGrid>

          <ResultSurface
            result={result}
            measures={measureDefs}
            vizType={vizType}
            yAxisMode={yAxisMode}
            colorAssignments={colorAssignments}
            labelFor={labelFor}
            isFetching={isFetching}
          />

          {/* Only meaningful once there is a time series to relate. */}
          {dimensions.includes("date") && measureDefs.length >= 2 && (
            <RelationshipPanel query={queryBody} measures={measureDefs} />
          )}

          <p className="text-[11px] text-muted-foreground px-1">
            {result.meta.buckets} bucket{result.meta.buckets === 1 ? "" : "s"} ·{" "}
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ·{" "}
            {result.meta.elapsedMs}ms
            {result.meta.bucketAnchor &&
              ` · buckets counted from ${result.meta.bucketAnchor}`}
          </p>
        </>
      )}
    </div>
  );
}
