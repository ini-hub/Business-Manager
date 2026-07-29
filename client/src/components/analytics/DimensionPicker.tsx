/**
 * Dimension picker.
 *
 * Dimensions the current measure selection cannot support are shown but disabled,
 * with the reason on hover. Hiding them would leave the user guessing why the
 * breakdown they want is missing; offering them and then returning a wrong number
 * would be worse.
 */

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DimensionDef, MeasureDef } from "@shared/analytics/model";
import { ANALYTICS_LIMITS } from "@shared/analytics/constants";
import { cn } from "@/lib/utils";

interface DimensionPickerProps {
  dimensions: DimensionDef[];
  measures: MeasureDef[];
  selectedMeasures: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function DimensionPicker({
  dimensions,
  measures,
  selectedMeasures,
  selected,
  onChange,
}: DimensionPickerProps) {
  const [open, setOpen] = useState(false);

  /** A dimension is offered only if EVERY selected measure supports it. */
  const availability = useMemo(() => {
    const chosen = selectedMeasures
      .map((id) => measures.find((m) => m.id === id))
      .filter((m): m is MeasureDef => Boolean(m));

    return new Map(
      dimensions.map((dim) => {
        const blockers = chosen.filter((m) => !m.dimensions.includes(dim.id));
        return [
          dim.id,
          blockers.length === 0
            ? { available: true as const, reason: "" }
            : {
                available: false as const,
                reason: `Not available for ${blockers.map((b) => b.label).join(", ")}.`,
              },
        ];
      }),
    );
  }, [dimensions, measures, selectedMeasures]);

  const selectedDefs = selected
    .map((id) => dimensions.find((d) => d.id === id))
    .filter((d): d is DimensionDef => Boolean(d));

  const atLimit = selected.length >= ANALYTICS_LIMITS.maxDimensions;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (!atLimit) onChange([...selected, id]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Break by</span>

      {selectedDefs.map((dim) => (
        <Badge key={dim.id} variant="secondary" className="gap-1 pr-1 font-normal">
          {dim.label}
          <button
            type="button"
            onClick={() => toggle(dim.id)}
            className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
            aria-label={`Remove ${dim.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1" align="start">
          {atLimit && (
            <p className="text-[11px] text-muted-foreground px-2 py-1.5">
              Limit of {ANALYTICS_LIMITS.maxDimensions} breakdowns reached.
            </p>
          )}
          {dimensions.map((dim) => {
            const state = availability.get(dim.id)!;
            const isSelected = selected.includes(dim.id);
            const disabled = (!state.available || atLimit) && !isSelected;

            const row = (
              <button
                key={dim.id}
                type="button"
                onClick={() => toggle(dim.id)}
                disabled={disabled}
                className={cn(
                  "w-full text-left rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                  "disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2",
                )}
              >
                <Check
                  className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                />
                <span className="font-medium">{dim.label}</span>
              </button>
            );

            return state.available ? (
              row
            ) : (
              <Tooltip key={dim.id}>
                <TooltipTrigger asChild>
                  <span className="block">{row}</span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">{state.reason}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}
