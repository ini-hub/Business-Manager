import * as React from "react"
import { X } from "lucide-react"
import { Input } from "./ui/input"
import { cn } from "@/lib/utils"

interface ClearableInputProps extends React.ComponentProps<"input"> {
  onClear?: () => void;
}

const ClearableInput = React.forwardRef<HTMLInputElement, ClearableInputProps>(
  ({ onClear, className, value, onChange, ...props }, ref) => {
    const [inputValue, setInputValue] = React.useState(value || "");
    const hasValue = String(inputValue).length > 0;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      onChange?.(e);
    };

    const handleClear = () => {
      setInputValue("");
      onClear?.();
      if (ref && typeof ref !== "function") {
        ref.current?.focus();
      }
      onChange?.({
        target: { value: "" },
      } as React.ChangeEvent<HTMLInputElement>);
    };

    return (
      <div className="relative">
        <Input
          ref={ref}
          value={inputValue}
          onChange={handleChange}
          className={cn("pr-9", className)}
          {...props}
        />
        {hasValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear input"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);

ClearableInput.displayName = "ClearableInput";

export { ClearableInput };
