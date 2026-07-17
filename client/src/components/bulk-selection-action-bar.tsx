import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckSquare } from "lucide-react";

export interface BulkSelectionAction {
  key: string;
  label: string;
  pendingLabel?: string;
  icon: ReactNode;
  tone?: "default" | "warning" | "destructive";
  pending?: boolean;
  onClick: () => void;
}

interface BulkSelectionActionBarProps {
  count: number;
  unitLabel?: string;
  onClear: () => void;
  actions: BulkSelectionAction[];
}

/**
 * Shared "N items selected" toolbar for row-select bulk actions — extracted from
 * Inventory's original inline Archive/Delete Selected bar so other entities (vendors,
 * purchase orders, etc.) don't reimplement the same layout per page.
 */
export function BulkSelectionActionBar({ count, unitLabel = "item", onClear, actions }: BulkSelectionActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckSquare className="h-4 w-4 text-primary" />
        <span>{count} {unitLabel}{count !== 1 ? "s" : ""} selected</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onClear} className="h-7 text-xs" data-testid="button-bulk-clear-selection">
          Clear
        </Button>
        {actions.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={action.tone === "destructive" ? "destructive" : "outline"}
            className={`h-7 text-xs gap-1.5 ${
              action.tone === "warning" ? "text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/20" : ""
            }`}
            disabled={action.pending}
            onClick={action.onClick}
            data-testid={`button-bulk-action-${action.key}`}
          >
            {action.icon}
            {action.pending && action.pendingLabel ? action.pendingLabel : action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
