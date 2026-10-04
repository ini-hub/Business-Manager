import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { CalendarRange } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store-context";
import { formatPeriodDates, resolveRange, type PayPeriodRef, type PeriodRange } from "@/lib/period-range";

const PRESET_LABELS: Record<string, string> = {
  current: "Current pay period",
  month: "This month",
  "last-month": "Last month",
  "3m": "Last 3 months",
  year: "This year",
  custom: "Custom range",
};

/**
 * The period a staff member's own pages are showing, kept in the URL
 * (?range=…&from=…&to=…) so a refresh or the back button lands on the same view.
 * Pay periods come from the caller's own payroll data, so the list holds only
 * periods they were part of.
 */
export function usePeriodFilter(defaultKey: string) {
  const { currentStore } = useStore();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const { data: summary } = useQuery<any>({
    queryKey: ["/api/payroll/my-summary", currentStore?.id],
    enabled: !!currentStore?.id,
  });
  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/payroll/my-history", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const currentPeriod: PayPeriodRef | null = summary?.period?.id ? summary.period : null;
  const periods = useMemo<PayPeriodRef[]>(() => {
    const paid = [...history].sort((a, b) => (b.startDate as string).localeCompare(a.startDate));
    return currentPeriod && !paid.some((p) => p.id === currentPeriod.id) ? [currentPeriod, ...paid] : paid;
  }, [history, currentPeriod]);

  const key = params.get("range") || defaultKey;
  const from = params.get("from");
  const to = params.get("to");
  const range: PeriodRange = useMemo(
    () => resolveRange(key, { from, to }, periods, currentPeriod),
    [key, from, to, periods, currentPeriod],
  );

  const update = useCallback((next: Record<string, string | null>) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  }, [search, location, navigate]);

  return {
    key,
    range,
    periods,
    currentPeriod,
    from,
    to,
    setKey: (k: string) => update({ range: k, ...(k === "custom" ? {} : { from: null, to: null }) }),
    setCustom: (next: { from?: string; to?: string }) => update({ range: "custom", ...next }),
  };
}

export type PeriodFilterState = ReturnType<typeof usePeriodFilter>;

export function PeriodFilter({ filter }: { filter: PeriodFilterState }) {
  const { key, range, periods, currentPeriod, from, to } = filter;
  const presets = Object.keys(PRESET_LABELS).filter((k) => k !== "current" || currentPeriod);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="period-filter">
      <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Select value={key} onValueChange={filter.setKey}>
        <SelectTrigger className="h-9 w-full sm:w-[230px]" data-testid="select-period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {presets.map((k) => <SelectItem key={k} value={k}>{PRESET_LABELS[k]}</SelectItem>)}
          </SelectGroup>
          {periods.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Pay periods</SelectLabel>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={`period:${p.id}`}>{formatPeriodDates(p.startDate, p.endDate)}</SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      {key === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date" className="h-9 w-[150px]" aria-label="From date"
            value={from ?? range.from} max={to ?? undefined}
            onChange={(e) => filter.setCustom({ from: e.target.value, to: to ?? range.to })}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date" className="h-9 w-[150px]" aria-label="To date"
            value={to ?? range.to} min={from ?? undefined}
            onChange={(e) => filter.setCustom({ to: e.target.value, from: from ?? range.from })}
          />
        </div>
      )}

      <span className="text-xs text-muted-foreground" data-testid="text-period-label">{range.label}</span>
    </div>
  );
}
