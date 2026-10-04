import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const VIEWS = [
  { label: "Business", href: "/", testId: "switch-business-dashboard" },
  { label: "Personal", href: "/staff", testId: "switch-my-dashboard" },
];

/**
 * Owners and managers have two home views: the business dashboard and their
 * own staff dashboard. This switch (segmented on mobile, underline tabs on desktop) sits above either one. Staff
 * accounts only have the personal view, so for them it renders nothing.
 */
export function DashboardViewSwitch({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  if (user?.role !== "owner" && user?.role !== "manager") return <>{children}</>;

  return (
    <div className="space-y-4">
      {/* Mobile: full-width segmented control */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1 md:hidden" role="tablist" aria-label="Dashboard view">
        {VIEWS.map((v) => {
          const active = v.href === location;
          return (
            <Link
              key={v.href}
              href={v.href}
              role="tab"
              aria-selected={active}
              data-testid={v.testId}
              className={cn(
                "rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {v.label}
            </Link>
          );
        })}
      </div>
      {/* Desktop: underline tabs */}
      <div className="hidden gap-6 border-b md:flex" role="tablist" aria-label="Dashboard view">
        {VIEWS.map((v) => {
          const active = v.href === location;
          return (
            <Link
              key={v.href}
              href={v.href}
              role="tab"
              aria-selected={active}
              data-testid={`${v.testId}-desktop`}
              className={cn(
                "-mb-px border-b-2 pb-3 text-sm font-semibold transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
