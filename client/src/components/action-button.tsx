import * as React from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface ActionButtonProps extends Omit<ButtonProps, "children" | "asChild"> {
  /** Shown beside the icon from `lg` up; always the accessible name (unless `ariaLabel` is set). */
  label: string;
  icon: LucideIcon;
  /** Navigate instead of calling `onClick`. Renders a real link, so it can be opened in a new tab. */
  href?: string;
  ariaLabel?: string;
}

/**
 * A page-header action that collapses to just its icon below `lg`. Everything
 * in a header's `actions` (Add, Back, History, ...) goes through this so they
 * all collapse, size and align the same way. Prefer AddButton / BackButton
 * for those two cases.
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ label, icon: Icon, href, ariaLabel, ...props }, ref) => {
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
