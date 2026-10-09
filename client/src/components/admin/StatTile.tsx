import { cn } from "@/lib/utils";

/** A summary number that doubles as a filter toggle. */
export function StatTile({
  label, value, hint, pressed, onToggle, testId,
}: {
  label: string;
  value: number | string;
  hint?: string;
  pressed: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        "text-left rounded-xl border px-4 py-3 bg-card/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        pressed ? "border-primary bg-primary/10" : "border-border/80 hover:bg-muted/50",
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </button>
  );
}
