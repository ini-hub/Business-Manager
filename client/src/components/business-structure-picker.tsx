import { BUSINESS_STRUCTURES, BUSINESS_STRUCTURE_LABELS, type BusinessStructure } from "@shared/schema/_helpers";
import { cn } from "@/lib/utils";

interface Props {
  value: BusinessStructure | null | undefined;
  onChange: (value: BusinessStructure) => void;
  disabled?: boolean;
}

/** Solo / With staff / Multi-store. Used at signup, workspace creation and in Settings. */
export function BusinessStructurePicker({ value, onChange, disabled }: Props) {
  return (
    <div role="radiogroup" aria-label="Business type" className="grid gap-2 sm:grid-cols-3">
      {BUSINESS_STRUCTURES.map((key) => {
        const selected = value === key;
        const label = BUSINESS_STRUCTURE_LABELS[key];
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(key)}
            data-testid={`button-structure-${key}`}
            className={cn(
              "rounded-md border p-3 text-left text-sm transition-colors hover-elevate",
              selected ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <span className="block font-medium">{label.name}</span>
            <span className="block text-xs text-muted-foreground">{label.description}</span>
          </button>
        );
      })}
    </div>
  );
}
