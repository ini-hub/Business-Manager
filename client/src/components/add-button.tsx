import * as React from "react";
import { Plus, type LucideIcon } from "lucide-react";
import { ActionButton, type ActionButtonProps } from "@/components/action-button";

export interface AddButtonProps extends Omit<ActionButtonProps, "icon"> {
  /** Replaces the + when the action is better signified by something else (e.g. a receipt for "New Sale"). */
  icon?: LucideIcon;
}

/** The primary "create" action in a page header (see ActionButton). */
export const AddButton = React.forwardRef<HTMLButtonElement, AddButtonProps>(
  ({ icon = Plus, ...props }, ref) => <ActionButton ref={ref} icon={icon} {...props} />,
);
AddButton.displayName = "AddButton";
