import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

/**
 * Accent for tiles that carry a status meaning (owed, overdue, settled).
 * A closed set rather than free-form classNames so the JIT can see every variant.
 */
export type MetricTone = "default" | "amber" | "rose" | "emerald" | "blue" | "sky";

const TONE_BORDER: Record<MetricTone, string> = {
  default: "",
  amber: "border-l-4 border-l-amber-500",
  rose: "border-l-4 border-l-rose-500",
  emerald: "border-l-4 border-l-emerald-500",
  blue: "border-l-4 border-l-blue-500",
  sky: "border-l-4 border-l-sky-500",
};

const TONE_ICON: Record<MetricTone, string> = {
  default: "text-muted-foreground",
  amber: "text-amber-500",
  rose: "text-rose-500",
  emerald: "text-emerald-500",
  blue: "text-blue-500",
  sky: "text-sky-500",
};

const TONE_VALUE: Record<MetricTone, string> = {
  default: "",
  amber: "text-amber-600 dark:text-amber-500",
  rose: "text-rose-600 dark:text-rose-500",
  emerald: "text-emerald-600 dark:text-emerald-500",
  blue: "text-blue-600 dark:text-blue-500",
  sky: "text-sky-600 dark:text-sky-500",
};

interface MetricCardProps {
  title: string;
  value: string | number;
  /**
   * Shorter rendering of `value` for narrow (2-up) phone tiles, e.g. "₦1.23M".
   * The full value still shows from `sm` up — see formatCurrencyCompact.
   */
  compactValue?: string;
  /** Escape hatch for values that aren't numbers — a name reads badly in mono. */
  valueClassName?: string;
  description?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  isLoading?: boolean;
  className?: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  tone?: MetricTone;
}

export function MetricCard({
  title,
  value,
  compactValue,
  valueClassName,
  description,
  icon,
  trend,
  trendValue,
  isLoading = false,
  className,
  href,
  onClick,
  active,
  tone = "default",
}: MetricCardProps) {
  const content = (
    <div className="p-3 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] leading-tight sm:text-sm font-medium text-muted-foreground line-clamp-2">
          {title}
        </div>
        {icon && (
          <div className={cn("shrink-0 h-4 w-4", TONE_ICON[tone])}>{icon}</div>
        )}
      </div>

      <div
        className={cn(
          "mt-1.5 sm:mt-2 text-lg sm:text-2xl font-bold font-mono tabular-nums leading-tight",
          TONE_VALUE[tone],
          valueClassName,
        )}
        title={String(value)}
      >
        {compactValue ? (
          <>
            <span className="sm:hidden">{compactValue}</span>
            <span className="hidden sm:inline">{value}</span>
          </>
        ) : (
          value
        )}
      </div>

      {(description || trend) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
          {trend && (
            <span
              className={cn(
                "flex items-center text-[10px] sm:text-xs font-medium",
                trend === "up" && "text-green-600 dark:text-green-400",
                trend === "down" && "text-red-600 dark:text-red-400",
                trend === "neutral" && "text-muted-foreground",
              )}
            >
              {trend === "up" && <TrendingUp className="h-3 w-3 mr-1 shrink-0" />}
              {trend === "down" && <TrendingDown className="h-3 w-3 mr-1 shrink-0" />}
              {trend === "neutral" && <Minus className="h-3 w-3 mr-1 shrink-0" />}
              {trendValue}
            </span>
          )}
          {description && (
            <p
              className="text-[10px] sm:text-xs text-muted-foreground line-clamp-1 sm:line-clamp-2"
              title={description}
            >
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <Card className={cn("h-full", TONE_BORDER[tone], className)}>
        <div className="p-3 sm:p-6">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-3 w-16 sm:h-4 sm:w-24" />
            <Skeleton className="h-4 w-4 shrink-0" />
          </div>
          <Skeleton className="h-6 w-20 sm:h-8 mt-1.5 sm:mt-2" />
          <Skeleton className="h-3 w-24 sm:w-32 mt-1" />
        </div>
      </Card>
    );
  }

  if (href) {
    return (
      <Link href={href} className="block h-full no-underline">
        <Card
          className={cn(
            "h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer",
            TONE_BORDER[tone],
            className,
          )}
        >
          {content}
        </Card>
      </Link>
    );
  }

  if (onClick) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "h-full hover:border-primary/50 hover:shadow-md transition-all cursor-pointer text-left",
          TONE_BORDER[tone],
          active && "border-primary ring-1 ring-primary/50 shadow-md",
          className,
        )}
      >
        {content}
      </Card>
    );
  }

  return (
    <Card className={cn("h-full", TONE_BORDER[tone], className)}>{content}</Card>
  );
}
