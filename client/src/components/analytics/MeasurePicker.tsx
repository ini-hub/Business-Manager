/**
 * Measure picker — grouped by cube, searchable, with the formula on hover.
 *
 * The description is surfaced verbatim because it is the contract for what the
 * number means: which rows it counts, and where it deliberately differs from an
 * existing report.
 */

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CubeDef, MeasureDef } from "@shared/analytics/model";
import { ANALYTICS_LIMITS } from "@shared/analytics/constants";
import { cn } from "@/lib/utils";

interface MeasurePickerProps {
  measures: MeasureDef[];
  cubes: CubeDef[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function MeasurePicker({ measures, cubes, selected, onChange }: MeasurePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const cubeLabel = useMemo(
    () => new Map(cubes.map((c) => [c.id, c.label])),
    [cubes],
  );

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = measures.filter(
      (m) =>
        !needle ||
        m.label.toLowerCase().includes(needle) ||
        m.description.toLowerCase().includes(needle),
    );
    const groups = new Map<string, MeasureDef[]>();
    for (const measure of matches) {
      const key = cubeLabel.get(measure.cube) ?? measure.cube;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(measure);
    }
    return Array.from(groups.entries());
  }, [measures, search, cubeLabel]);

  const selectedDefs = selected
    .map((id) => measures.find((m) => m.id === id))
    .filter((m): m is MeasureDef => Boolean(m));

  const atLimit = selected.length >= ANALYTICS_LIMITS.maxMeasures;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (!atLimit) onChange([...selected, id]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Measure</span>

      {selectedDefs.map((measure) => (
        <Tooltip key={measure.id}>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="gap-1 pr-1 font-normal">
              {measure.label}
              <button
                type="button"
                onClick={() => toggle(measure.id)}
                className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${measure.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs leading-relaxed">{measure.description}</p>
          </TooltipContent>
        </Tooltip>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search measures"
                className="h-8 pl-7 text-xs"
              />
            </div>
            {atLimit && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Limit of {ANALYTICS_LIMITS.maxMeasures} reached — remove one to add another.
              </p>
            )}
          </div>

          <ScrollArea className="h-72">
            <div className="p-1">
              {grouped.map(([group, items]) => (
                <div key={group} className="mb-1">
                  <p className="text-[11px] font-medium text-muted-foreground px-2 py-1">
                    {group}
                  </p>
                  {items.map((measure) => {
                    const isSelected = selected.includes(measure.id);
                    return (
                      <button
                        key={measure.id}
                        type="button"
                        onClick={() => toggle(measure.id)}
                        disabled={!isSelected && atLimit}
                        className={cn(
                          "w-full text-left rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                          "disabled:opacity-40 disabled:cursor-not-allowed flex items-start gap-2",
                        )}
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 mt-0.5 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="font-medium block">{measure.label}</span>
                          <span className="text-muted-foreground block leading-snug line-clamp-2">
                            {measure.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {grouped.length === 0 && (
                <p className="text-xs text-muted-foreground p-4 text-center">
                  No measures match "{search}".
                </p>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
