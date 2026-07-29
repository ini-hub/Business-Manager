/**
 * The "how do modules interact" surface: scatter and correlation matrix.
 *
 * Kept as a separate mode rather than another chart type, because it asks a
 * different question from the rest of the Explorer — not "what happened" but
 * "do these move together", which needs its own controls and its own caveats.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { stableHash } from "@/lib/analytics/query-client";
import type { AnalyticsQueryInput } from "@shared/analytics/query";
import type { MeasureDef, StatTransform } from "@shared/analytics/model";
import { ScatterRegression, type ScatterResponse } from "./charts/ScatterRegression";
import { CorrelationHeatmap, type CorrelateResponse } from "./charts/CorrelationHeatmap";

interface RelationshipPanelProps {
  query: AnalyticsQueryInput | null;
  measures: MeasureDef[];
}

const TRANSFORMS: { value: StatTransform; label: string }[] = [
  { value: "pct_change", label: "% change" },
  { value: "difference", label: "Change vs previous" },
  { value: "none", label: "Raw levels" },
];

export function RelationshipPanel({ query, measures }: RelationshipPanelProps) {
  const [mode, setMode] = useState<"scatter" | "matrix">("scatter");
  const [x, setX] = useState(measures[0]?.id ?? "");
  const [y, setY] = useState(measures[1]?.id ?? measures[0]?.id ?? "");
  const [pointGrain, setPointGrain] = useState<"time_bucket" | "dimension_member">(
    "time_bucket",
  );
  // Raw levels is offered but not the default: two growing series almost always
  // correlate, and defaulting to it would manufacture findings.
  const [transform, setTransform] = useState<StatTransform>("pct_change");

  const scatterBody = query && x && y ? { ...query, x, y, pointGrain, transform } : null;
  const matrixBody = query ? { ...query, transform, maxLag: 7 } : null;

  const scatter = useQuery<ScatterResponse>({
    queryKey: ["analytics:scatter", stableHash(scatterBody)],
    queryFn: async () =>
      (await apiRequest("POST", "/api/analytics/scatter", scatterBody)).json(),
    enabled: mode === "scatter" && Boolean(scatterBody),
  });

  const matrix = useQuery<CorrelateResponse>({
    queryKey: ["analytics:correlate", stableHash(matrixBody)],
    queryFn: async () =>
      (await apiRequest("POST", "/api/analytics/correlate", matrixBody)).json(),
    enabled: mode === "matrix" && Boolean(matrixBody) && measures.length >= 2,
  });

  const active = mode === "scatter" ? scatter : matrix;
  const warnings = (active.data as { warnings?: string[] } | undefined)?.warnings ?? [];

  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Relationships</CardTitle>
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="h-8">
              <TabsTrigger value="scatter" className="text-xs h-6">
                Scatter
              </TabsTrigger>
              <TabsTrigger value="matrix" className="text-xs h-6">
                Correlation matrix
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === "scatter" && (
            <>
              <MeasureSelect label="X" value={x} onChange={setX} measures={measures} />
              <MeasureSelect label="Y" value={y} onChange={setY} measures={measures} />
              <Select
                value={pointGrain}
                onValueChange={(v) => setPointGrain(v as typeof pointGrain)}
              >
                <SelectTrigger className="h-8 w-[190px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time_bucket" className="text-xs">
                    One point per period
                  </SelectItem>
                  <SelectItem value="dimension_member" className="text-xs">
                    One point per store
                  </SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          <Select value={transform} onValueChange={(v) => setTransform(v as StatTransform)}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSFORMS.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {warnings.map((warning) => (
          <Alert key={warning}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{warning}</AlertDescription>
          </Alert>
        ))}

        {active.isLoading && <Skeleton className="h-72 w-full" />}

        {active.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {active.error instanceof Error
                ? active.error.message
                : "Could not compute that."}
            </AlertDescription>
          </Alert>
        )}

        {mode === "scatter" && scatter.data && <ScatterRegression data={scatter.data} />}
        {mode === "matrix" && matrix.data && <CorrelationHeatmap data={matrix.data} />}

        {mode === "matrix" && measures.length < 2 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Select at least two measures above to build a correlation matrix.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MeasureSelect({
  label,
  value,
  onChange,
  measures,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  measures: MeasureDef[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {measures.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
