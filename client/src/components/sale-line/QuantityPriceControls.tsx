import type { KeyboardEvent, ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { quantityStep, parseQuantityInput, formatQuantity } from "@/lib/quantity-utils";

/**
 * Quantity stepper + line total + unit price of a sale line. Shared by the
 * checkout cart row and the receipt line editor so both read the same.
 */
interface Props {
  quantity: number;
  unitPrice: number;
  listPrice: number;
  lineTotal: number;
  allowFractional: boolean;
  unit?: string | null;
  /** Upper bound for the stepper (stock on hand for products). */
  maxQuantity?: number;
  formatCurrency: (v: number) => string;
  onStep: (delta: number) => void;
  onSetQuantity: (qty: number) => void;
  onSetPrice: (price: number) => void;
  /** Rendered beside the line total (checkout puts its staff toggle here). */
  trailing?: ReactNode;
  /** Rendered under the unit price (checkout's below-cost warning). */
  priceFootnote?: ReactNode;
  testIdSuffix?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function QuantityPriceControls({
  quantity, unitPrice, listPrice, lineTotal, allowFractional, unit, maxQuantity,
  formatCurrency, onStep, onSetQuantity, onSetPrice, trailing, priceFootnote, testIdSuffix, onKeyDown,
}: Props) {
  const sfx = testIdSuffix ?? "";
  return (
    <>
      {/* qty stepper + total — wraps instead of overflowing when narrow */}
      <div className="flex items-center gap-1 flex-wrap">
        <IconButton
          label="Decrease quantity"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => onStep(allowFractional ? -0.5 : -1)}
          data-testid={`button-decrease-${sfx}`}
        >
          <Minus className="h-3 w-3" />
        </IconButton>
        <Input
          type="number"
          step={quantityStep(allowFractional)}
          min={allowFractional ? "0.01" : "1"}
          max={maxQuantity || undefined}
          value={quantity || ""}
          onChange={(e) => onSetQuantity(parseQuantityInput(e.target.value, allowFractional))}
          className="h-7 w-10 text-center font-mono text-xs px-1 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          data-testid={`input-quantity-${sfx}`}
          onKeyDown={onKeyDown}
        />
        {unit && <span className="text-xs text-muted-foreground font-medium shrink-0">{unit}</span>}
        <IconButton
          label="Increase quantity"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={() => onStep(allowFractional ? 0.5 : 1)}
          disabled={!allowFractional && maxQuantity !== undefined && quantity >= maxQuantity}
          data-testid={`button-increase-${sfx}`}
        >
          <Plus className="h-3 w-3" />
        </IconButton>
        <span className="font-mono text-sm font-medium shrink-0 ml-2">{formatCurrency(lineTotal)}</span>
        {trailing}
      </div>

      {/* unit price */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground shrink-0">Unit price</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={unitPrice === 0 ? "0" : unitPrice || ""}
          onChange={(e) => {
            const val = e.target.value;
            let clean = val;
            if (/^0\d+/.test(val)) clean = val.replace(/^0+/, "");
            onSetPrice(clean === "" ? 0 : parseFloat(clean) || 0);
          }}
          className="h-6 w-24 font-mono text-xs shrink-0"
          data-testid={`input-price-${sfx}`}
          onKeyDown={onKeyDown}
        />
        <span className="text-[11px] text-muted-foreground shrink-0">List: {formatCurrency(listPrice)}</span>
        {priceFootnote}
      </div>

      {/* Fractional presets */}
      {allowFractional && (
        <div className="flex items-center gap-1 flex-wrap -mt-1">
          {unit && (
            <span className="text-[11px] text-muted-foreground">{formatQuantity(quantity, unit)} selected ·</span>
          )}
          {[0.25, 0.5, 0.75, 1, 1.5, 2].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onSetQuantity(preset)}
              className={cn(
                "text-[11px] px-2 py-0.5 rounded border transition-colors",
                quantity === preset
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground",
              )}
            >
              {preset}{unit ? ` ${unit}` : ""}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
