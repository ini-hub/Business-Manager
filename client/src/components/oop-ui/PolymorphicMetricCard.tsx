/**
 * Thin wrapper over MetricCard.
 *
 * This used to be a parallel implementation with its own typography, which meant
 * profit-loss and service-profitability looked different from every other page.
 * It now delegates, keeping only the glassmorphism/hover-elevation styling that
 * BaseCard added on top.
 */

import * as React from "react";
import { MetricCard } from "@/components/metric-card";
import { cn } from "@/lib/utils";

export interface PolymorphicMetricCardProps {
  title: string;
  value: string | number;
  compactValue?: string;
  description?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  isLoading?: boolean;
  href?: string;
  className?: string;
  glassmorphism?: boolean;
  hoverElevation?: boolean;
}

export const PolymorphicMetricCard: React.FC<PolymorphicMetricCardProps> = ({
  className,
  glassmorphism = false,
  hoverElevation = false,
  ...props
}) => (
  <MetricCard
    {...props}
    className={cn(
      "transition-all duration-200",
      glassmorphism && "bg-background/65 backdrop-blur-md border-primary/15 shadow-lg",
      hoverElevation && "hover:border-primary/45 hover:shadow-md hover:-translate-y-[1px]",
      className,
    )}
  />
);
