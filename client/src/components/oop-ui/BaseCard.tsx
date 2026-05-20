import * as React from "react";
import { cn } from "@/lib/utils";

export interface BaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glassmorphism?: boolean;
  hoverElevation?: boolean;
}

export const BaseCard = React.forwardRef<HTMLDivElement, BaseCardProps>(
  ({ className, glassmorphism = false, hoverElevation = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border bg-card border-card-border text-card-foreground shadow-sm transition-all duration-200",
          glassmorphism && "bg-background/65 backdrop-blur-md border-primary/15 shadow-lg",
          hoverElevation && "hover:border-primary/45 hover:shadow-md hover:-translate-y-[1px]",
          className
        )}
        {...props}
      />
    );
  }
);

BaseCard.displayName = "BaseCard";
