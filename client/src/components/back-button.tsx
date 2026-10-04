import { ArrowLeft } from "lucide-react";
import { ActionButton, type ActionButtonProps } from "@/components/action-button";

export interface BackButtonProps extends Omit<ActionButtonProps, "icon" | "variant" | "ariaLabel"> {
  /** Where it goes, e.g. "Billing". Visible from `lg` up; the accessible name reads "Back to {label}". */
  label: string;
}

/** The "back to the parent page" action in a page header (see ActionButton). */
export function BackButton({ label, ...props }: BackButtonProps) {
  return <ActionButton variant="outline" icon={ArrowLeft} label={label} ariaLabel={`Back to ${label}`} {...props} />;
}
