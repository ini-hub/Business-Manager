import { X } from "lucide-react";

/**
 * The removable "applied filters" strip under a ListToolbar: one pill per applied
 * filter, the result count, and a Clear all link. Renders nothing when `show` is false.
 */
export function ListFilterChips({
  show, chips, onRemove, count, noun, onClearAll, testId,
}: {
  show: boolean;
  chips: { key: string; label: string }[];
  onRemove: (key: string) => void;
  count: number;
  /** Singular noun for the count: "customer" -> "3 customers". */
  noun: string;
  onClearAll: () => void;
  testId: string;
}) {
  if (!show) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 h-7 pl-3 pr-2 rounded-full border border-input bg-muted/40 text-xs font-medium"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onRemove(chip.key)}
            aria-label={`Remove ${chip.label} filter`}
            title={`Remove ${chip.label} filter`}
            className="rounded-full p-0.5 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <span className="text-xs text-muted-foreground ml-auto shrink-0">
        {count} {noun}{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        className="text-xs font-medium text-primary hover:underline shrink-0"
        onClick={onClearAll}
        data-testid={testId}
      >
        Clear all
      </button>
    </div>
  );
}
