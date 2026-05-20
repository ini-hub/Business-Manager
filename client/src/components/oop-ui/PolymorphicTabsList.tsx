import * as React from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * TabItem represents the structured data for a single tab.
 * Enforces strong typing and clear configuration-based definition for UI actions.
 */
export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  visible?: boolean;
  className?: string;
  testId?: string;
}

/**
 * PolymorphicTabsListProps extends the base TabsList properties.
 * Implements strategy and parameterization to render tab variations dynamically.
 */
export interface PolymorphicTabsListProps extends React.ComponentPropsWithoutRef<typeof TabsList> {
  tabs: TabItem[];
  variant?: "default" | "solid" | "bordered";
  scrollable?: boolean;
  triggerClassName?: string;
}

export const PolymorphicTabsList = React.forwardRef<
  React.ElementRef<typeof TabsList>,
  PolymorphicTabsListProps
>(({ tabs, variant = "default", scrollable = true, className, triggerClassName, ...props }, ref) => {
  const visibleTabs = tabs.filter(tab => tab.visible !== false);

  return (
    <TabsList
      ref={ref}
      className={cn(
        // Variant strategy classes
        variant === "default" && "bg-muted/50 p-1 rounded-xl gap-1",
        variant === "solid" && "bg-muted/40 p-0.5 rounded-lg border border-border/40 gap-1",
        variant === "bordered" && "bg-transparent border-b border-border rounded-none p-0 gap-4 mb-4",
        
        // Scrollable vs Grid strategy
        scrollable
          ? "flex w-full items-center justify-start overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "grid w-full grid-cols-2 md:grid-cols-6",
        
        className
      )}
      {...props}
    >
      {visibleTabs.map((tab) => (
        <TabsTrigger
          key={tab.value}
          value={tab.value}
          data-testid={tab.testId}
          className={cn(
            "transition-all duration-200 select-none",
            // Polymorphic style strategies
            variant === "default" && "flex items-center justify-center gap-2 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs md:text-sm px-3 md:px-4",
            variant === "solid" && "text-xs py-1.5 px-3 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-1.5",
            variant === "bordered" && "bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none shadow-none py-2 px-1 text-xs md:text-sm font-medium border-b-2 border-transparent",
            
            // Enforce non-wrapping on horizontal scrolling lists
            scrollable && "shrink-0",
            
            tab.className,
            triggerClassName
          )}
        >
          {tab.icon && <span className="inline-flex shrink-0">{tab.icon}</span>}
          <span>{tab.label}</span>
          {tab.badge && <span className="inline-flex shrink-0 ml-1">{tab.badge}</span>}
        </TabsTrigger>
      ))}
    </TabsList>
  );
});

PolymorphicTabsList.displayName = "PolymorphicTabsList";
