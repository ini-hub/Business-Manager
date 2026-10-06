import * as React from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useGate } from "@/components/billing/Gated";
import { useEntitlements } from "@/hooks/useEntitlements";
import { announcePlanLimit, countLimitMessage } from "@/lib/upgrade-prompt";

type LimitType = "staff_seats" | "customer_count" | "store_count" | "item_count";

export interface ActionButtonProps extends Omit<ButtonProps, "children" | "asChild"> {
  /** Shown beside the icon from `lg` up; always the accessible name (unless `ariaLabel` is set). */
  label: string;
  icon: LucideIcon;
  /** Navigate instead of calling `onClick`. Renders a real link, so it can be opened in a new tab. */
  href?: string;
  ariaLabel?: string;
  /**
   * Feature key that must be available. Flag off: the button is not rendered. On but unpaid:
   * it stays visible and a click opens the priced upgrade prompt instead of running.
   */
  gate?: string;
  /** Free-tier cap this action consumes; at the cap a click opens the upgrade prompt. */
  limit?: LimitType;
}

function useLimitStatus(limit: LimitType | undefined) {
  const { staffSeats, customerCount, storeCount, itemCount, isLoading, isError } = useEntitlements();
  if (!limit || isLoading || isError) return null;
  const status = { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount, item_count: itemCount }[limit];
  return status && !status.unlimited && status.used >= status.limit ? { limit, cap: status.limit, tiered: !!status.tiered, trial: !!status.trial } : null;
}

/**
 * A page-header action that collapses to just its icon below `lg`. Everything
 * in a header's `actions` (Add, Back, History, ...) goes through this so they
 * all collapse, size and align the same way. Prefer AddButton / BackButton
 * for those two cases.
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ label, icon: Icon, href, ariaLabel, gate, limit, onClick, ...rest }, ref) => {
    const g = useGate(gate);
    const atCap = useLimitStatus(limit);
    if (g.state === "hidden") return null;
    const blocked = g.locked || !!atCap;
    const props = {
      ...rest,
      onClick: blocked
        ? (e: React.MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            e.stopPropagation();
            if (g.locked) return g.announce();
            if (atCap) announcePlanLimit({ kind: "count", limitType: atCap.limit, limit: atCap.cap, tiered: atCap.tiered, trial: atCap.trial, message: countLimitMessage(atCap.limit, atCap.cap, atCap.tiered, atCap.trial) });
          }
        : onClick,
      ...(blocked ? { "data-locked": "true" } : {}),
    } as ButtonProps;
    const content = (
      <>
        <Icon className="h-4 w-4 lg:mr-2" />
        <span className="hidden lg:inline">{label}</span>
      </>
    );
    return href ? (
      <Button ref={ref} asChild aria-label={ariaLabel ?? label} {...props}>
        <Link href={href}>{content}</Link>
      </Button>
    ) : (
      <Button ref={ref} aria-label={ariaLabel ?? label} {...props}>
        {content}
      </Button>
    );
  },
);
ActionButton.displayName = "ActionButton";
