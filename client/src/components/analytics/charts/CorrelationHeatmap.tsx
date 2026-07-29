/**
 * N x N correlation matrix.
 *
 * Diverging scale through a NEUTRAL grey midpoint, because zero correlation must
 * not look like a value. A hue at the midpoint (the usual red-yellow-green
 * mistake) makes "no relationship" read as "medium relationship".
 *
 * Cells with too few paired observations render blank, not zero: unknown and
 * "no relationship" are different claims.
 */

import { divergingColor } from "@/lib/analytics/palette";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface CorrelateResponse {
  keys: string[];
  labels: string[];
  matrix: (number | null)[][];
  n: number[][];
  p: (number | null)[][];
  bestLags: {
    a: string;
    b: string;
    aLabel: string;
    bLabel: string;
    lag: number;
    r: number;
  }[];
  transform: string;
  buckets: number;
  warnings: string[];
}

export function CorrelationHeatmap({ data }: { data: CorrelateResponse }) {
  if (data.keys.length < 2) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Select at least two measures to correlate.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-1" />
              {data.labels.map((label) => (
                <th
                  key={label}
                  className="p-1 text-[10px] font-medium text-muted-foreground align-bottom"
                >
                  {/* Rotated so long measure names do not force a very wide table. */}
                  <div className="h-24 w-12 flex items-end justify-center">
                    <span className="whitespace-nowrap origin-bottom-left -rotate-45 translate-x-3">
                      {label}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((row, i) => (
              <tr key={data.keys[i]}>
                <th className="p-1 pr-2 text-[11px] font-medium text-muted-foreground text-right whitespace-nowrap">
                  {data.labels[i]}
                </th>
                {row.map((value, j) => {
                  const n = data.n[i][j];
                  const p = data.p[i][j];
                  return (
                    <td key={j} className="p-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "h-12 w-12 rounded-[3px] flex items-center justify-center",
                              "text-[11px] tabular-nums cursor-default",
                              value === null && "border border-dashed border-border",
                            )}
                            style={
                              value === null
                                ? undefined
                                : { background: divergingColor(value) }
                            }
                          >
                            {/* Text stays in ink tokens; the cell colour carries magnitude. */}
                            <span
                              className={cn(
                                value !== null && Math.abs(value) > 0.55
                                  ? "text-white"
                                  : "text-foreground",
                              )}
                            >
                              {value === null ? "" : value.toFixed(2)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs font-medium">
                            {data.labels[i]} vs {data.labels[j]}
                          </p>
                          {value === null ? (
                            <p className="text-xs text-muted-foreground">
                              Not enough overlapping data to compare.
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              r = {value.toFixed(3)} · n = {n}
                              {p !== null && ` · p = ${p < 0.001 ? "<0.001" : p.toFixed(3)}`}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend: identity by swatch, and the neutral midpoint made explicit. */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
        <span>-1</span>
        <span
          className="h-2 w-32 rounded-full"
          style={{
            background: `linear-gradient(to right, ${divergingColor(-1)}, ${divergingColor(0)}, ${divergingColor(1)})`,
          }}
        />
        <span>+1</span>
        <span className="ml-2">
          on {data.transform === "pct_change" ? "% change" : data.transform === "difference" ? "period-over-period change" : "raw levels"} · {data.buckets} buckets
        </span>
      </div>

      {data.bestLags.length > 0 && (
        <div className="rounded-md border p-3">
          <p className="text-xs font-medium mb-1.5">Lead / lag</p>
          <ul className="space-y-1">
            {data.bestLags.map((lag) => (
              <li key={`${lag.a}-${lag.b}`} className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">
                  {lag.lag > 0 ? lag.aLabel : lag.bLabel}
                </span>{" "}
                leads{" "}
                <span className="text-foreground font-medium">
                  {lag.lag > 0 ? lag.bLabel : lag.aLabel}
                </span>{" "}
                by {Math.abs(lag.lag)} bucket{Math.abs(lag.lag) === 1 ? "" : "s"} (r ={" "}
                <span className="tabular-nums">{lag.r.toFixed(2)}</span>)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
