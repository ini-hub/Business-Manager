import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // h-9 to match icon buttons and default buttons.
    // Remove leading zeros for number inputs (e.g. 0900 -> 900)
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (type === "number") {
        const val = e.target.value;
        if (val.length > 1 && val.startsWith("0")) {
          e.target.value = val.replace(/^0+(?=\d)/, "");
        }
      }
      props.onChange?.(e);
    };

    // Auto-select text on focus for number inputs (so "0" is easily overwritten)
    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      if (type === "number") {
        e.target.select();
      }
      props.onFocus?.(e);
    };

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
        onChange={handleChange}
        onFocus={handleFocus}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
