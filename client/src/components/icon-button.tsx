import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface IconButtonProps extends Omit<ButtonProps, "size"> {
  /** What the icon signifies — shown on hover/focus and set as the accessible name,
   * since an icon-only button has no visible text for either. */
  label: string;
  side?: "top" | "bottom" | "left" | "right";
}

/**
 * A `size="icon"` Button that always carries its meaning on hover — an icon-only
 * control is otherwise unlabeled for both sighted users (no visible text) and
 * screen readers (no accessible name). Use this instead of a bare
 * `<Button size="icon">` anywhere the button has no visible label.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, side = "top", className, ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button ref={ref} size="icon" aria-label={label} className={className} {...props} />
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
