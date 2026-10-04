import { cn } from "@/lib/utils";

// Status with 2-5 values lives in tabs on the list, never inside Filters. Scrolls
// sideways rather than wrapping on narrow screens.
export function StatusTabs<K extends string>({
  tabs, value, onChange, label = "Filter by status", className,
}: {
  tabs: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              "h-9 px-3.5 rounded-full border text-sm font-medium whitespace-nowrap inline-flex items-center gap-1.5 shrink-0 transition-colors",
              active ? "bg-primary/10 border-primary text-primary" : "border-input bg-card",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("text-xs tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
