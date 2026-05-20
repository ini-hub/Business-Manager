import * as React from "react";
import { BaseCard, BaseCardProps } from "./BaseCard";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

export interface PolymorphicMetricCardProps extends BaseCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  isLoading?: boolean;
  href?: string;
}

export const PolymorphicMetricCard: React.FC<PolymorphicMetricCardProps> = ({
  title,
  value,
  description,
  icon,
  trend,
  trendValue,
  isLoading = false,
  href,
  className,
  ...props
}) => {
  const content = (
    <>
      <div className="flex flex-row items-center justify-between gap-4 pb-2 p-6">
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {icon && (
          <div className="h-5 w-5 text-muted-foreground shrink-0">
            {icon}
          </div>
        )}
      </div>
      <div className="p-6 pt-0">
        <div className="text-2xl font-bold font-mono text-foreground leading-none">{value}</div>
        {(description || trend) && (
          <div className="flex items-center gap-2 mt-2">
            {trend && (
              <span
                className={cn(
                  "flex items-center text-xs font-bold px-1.5 py-0.5 rounded",
                  trend === "up" && "bg-green-500/10 text-green-600 dark:text-green-400",
                  trend === "down" && "bg-red-500/10 text-red-600 dark:text-red-400",
                  trend === "neutral" && "bg-muted text-muted-foreground"
                )}
              >
                {trend === "up" && <TrendingUp className="h-3 w-3 mr-1" />}
                {trend === "down" && <TrendingDown className="h-3 w-3 mr-1" />}
                {trend === "neutral" && <Minus className="h-3 w-3 mr-1" />}
                {trendValue}
              </span>
            )}
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (isLoading) {
    return (
      <BaseCard className={className} {...props}>
        <div className="flex flex-row items-center justify-between gap-4 pb-2 p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
        <div className="p-6 pt-0 space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-32" />
        </div>
      </BaseCard>
    );
  }

  if (href) {
    return (
      <Link href={href} className="block no-underline">
        <BaseCard
          hoverElevation
          className={cn("cursor-pointer border-primary/10 hover:border-primary/45 hover:shadow-md transition-all duration-200", className)}
          {...props}
        >
          {content}
        </BaseCard>
      </Link>
    );
  }

  return (
    <BaseCard className={className} {...props}>
      {content}
    </BaseCard>
  );
};
