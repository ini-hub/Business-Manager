import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE = {
  green: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400",
  amber: "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400",
  rose: "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400",
  blue: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type BadgeTone = keyof typeof TONE;

/** The admin status pill: text always carries the meaning, colour only reinforces it. */
export function StatusBadge({ tone, children, className }: { tone: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-none text-[11px] font-bold whitespace-nowrap", TONE[tone], className)}>
      {children}
    </Badge>
  );
}

export const TIER_TONE: Record<string, BadgeTone> = {
  free: "neutral",
  paid_flat: "blue",
  paid_metered_limit: "amber",
  bundle_parent: "blue",
  bundle_child: "neutral",
};
