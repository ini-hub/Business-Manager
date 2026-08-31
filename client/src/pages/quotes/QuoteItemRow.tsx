import type { KeyboardEvent } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { quantityStep, parseQuantityInput, formatQuantity } from "@/lib/quantity-utils";
import type { QuoteCartItem } from "./types";

interface QuoteItemRowProps {
  item: QuoteCartItem;
  formatCurrency: (v: number) => string;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onSetExactQuantity: (itemId: string, qty: number) => void;
  onUpdatePrice: (itemId: string, price: number) => void;
  onRemove: (itemId: string) => void;
}

function advanceFocus(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const SELECTOR = "#quote-builder-cart input:not([disabled]), #quote-builder-cart button:not([disabled])";
  const focusables = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
  const current = e.currentTarget as HTMLElement;
  const idx = focusables.indexOf(current);
  if (idx >= 0 && idx < focusables.length - 1) {
    focusables[idx + 1].focus();
  }
}

// Same layout language as the POS cart row (CartItemRow) — quantity stepper,
// an always-editable price field, a "Custom" badge when it departs the list
// price — minus staff/commission assignment, which isn't a quote concept.
export function QuoteItemRow({
  item,
  formatCurrency,
  onUpdateQuantity,
  onSetExactQuantity,
  onUpdatePrice,
  onRemove,
}: QuoteItemRowProps) {
  const isService = item.inventory.type === "service";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 rounded-lg bg-muted/50 border-l-4",
        isService ? "border-l-violet-500 dark:border-l-violet-400" : "border-l-sky-500 dark:border-l-sky-400"
      )}
    >
      {/* Row 1: name + delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-medium text-sm leading-snug">{item.inventory.name}</p>
            {item.customPrice !== item.inventory.sellingPrice && (
              <Badge variant="secondary" className="text-[9px] h-4 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 shrink-0">
                Custom
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive shrink-0 self-start"
          onClick={() => onRemove(item.inventory.id)}
          data-testid={`button-remove-quote-item-${item.inventory.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Row 2: qty stepper + line total */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onUpdateQuantity(item.inventory.id, item.inventory.allowFractional ? -0.5 : -1)}
          data-testid={`button-decrease-quote-item-${item.inventory.id}`}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          type="number"
          step={quantityStep(item.inventory.allowFractional ?? false)}
          min={item.inventory.allowFractional ? "0.01" : "1"}
          value={item.quantity || ""}
          onChange={(e) => {
            const parsed = parseQuantityInput(e.target.value, item.inventory.allowFractional ?? false);
            onSetExactQuantity(item.inventory.id, parsed);
          }}
          className="h-7 w-14 text-center font-mono text-xs px-1 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          data-testid={`input-quantity-quote-item-${item.inventory.id}`}
          onKeyDown={advanceFocus}
        />
        {item.inventory.unit && (
          <span className="text-xs text-muted-foreground font-medium shrink-0">{item.inventory.unit}</span>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onUpdateQuantity(item.inventory.id, item.inventory.allowFractional ? 0.5 : 1)}
          data-testid={`button-increase-quote-item-${item.inventory.id}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <span className="font-mono text-sm font-medium shrink-0 ml-2">
          {formatCurrency(item.totalPrice)}
        </span>
      </div>

      {/* Row 3: editable unit price, same as the POS cart */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground shrink-0">Unit price</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={item.customPrice === 0 ? "0" : item.customPrice || ""}
          onChange={(e) => {
            const val = e.target.value;
            let clean = val;
            if (/^0\d+/.test(val)) clean = val.replace(/^0+/, "");
            onUpdatePrice(item.inventory.id, clean === "" ? 0 : parseFloat(clean) || 0);
          }}
          className="h-6 w-24 font-mono text-xs shrink-0"
          data-testid={`input-price-quote-item-${item.inventory.id}`}
          onKeyDown={advanceFocus}
        />
        <span className="text-[10px] text-muted-foreground shrink-0">
          List: {formatCurrency(item.inventory.sellingPrice)}
        </span>
      </div>

      {/* Fractional presets */}
      {item.inventory.allowFractional && (
        <div className="flex items-center gap-1 flex-wrap -mt-1">
          {item.inventory.unit && (
            <span className="text-[10px] text-muted-foreground">
              {formatQuantity(item.quantity, item.inventory.unit)} selected ·
            </span>
          )}
          {[0.25, 0.5, 0.75, 1, 1.5, 2].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onSetExactQuantity(item.inventory.id, preset)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                item.quantity === preset
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {preset}{item.inventory.unit ? ` ${item.inventory.unit}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
