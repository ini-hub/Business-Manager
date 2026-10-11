import { useState, type KeyboardEvent } from "react";
import { Trash2, UserCog, ChevronDown, ChevronUp, AlertCircle, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Staff } from "@shared/schema";
import type { CartItem } from "./types";
import type { LossLine } from "./useLossCheck";
import { StaffAssignmentFields } from "@/components/sale-line/StaffAssignmentFields";
import { QuantityPriceControls } from "@/components/sale-line/QuantityPriceControls";

interface CartItemRowProps {
  item: CartItem;
  staffList: Staff[];
  formatCurrency: (v: number) => string;
  /** Set when the server says this line is priced below full cost. Never blocks the sale. */
  loss?: LossLine;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onSetExactQuantity: (itemId: string, qty: number) => void;
  onUpdatePrice: (itemId: string, price: number) => void;
  onRemove: (itemId: string) => void;
  onUpdateStaff: (itemId: string, field: keyof CartItem, value: string | null | boolean) => void;
}

function advanceFocus(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const SELECTOR = '#pos-cart-section input:not([disabled]), #pos-cart-section button:not([disabled])';
  const focusables = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
  const current = e.currentTarget as HTMLElement;
  const idx = focusables.indexOf(current);
  if (idx >= 0 && idx < focusables.length - 1) {
    focusables[idx + 1].focus();
  }
}

export function CartItemRow({
  item,
  staffList,
  formatCurrency,
  loss,
  onUpdateQuantity,
  onSetExactQuantity,
  onUpdatePrice,
  onRemove,
  onUpdateStaff,
}: CartItemRowProps) {
  const isService = item.inventory.type === "service";
  const missingLead = isService && !item.leadStaffId;

  // Auto-expand staff section when lead staff is missing (validation state)
  const [staffExpanded, setStaffExpanded] = useState(missingLead);

  return (
    <div className={cn(
      "flex flex-col gap-2 p-3 rounded-lg bg-muted/50 border-l-4",
      missingLead
        ? "border border-destructive/40"
        : loss
          ? "border border-red-500/60 border-l-red-600 bg-red-50/60 dark:bg-red-950/20"
        : isService
          ? "border-l-violet-500 dark:border-l-violet-400"
          : "border-l-sky-500 dark:border-l-sky-400"
    )}>
      {/* Row 1: name + delete (delete always anchored top-right); item type is shown via the left-edge color accent, not a badge, so it never competes with the name for space */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="font-medium text-sm leading-snug">{item.inventory.name}</p>
            {loss && (
              <Badge
                variant="secondary"
                className="text-[11px] h-4 py-0 bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 shrink-0 gap-1"
                data-testid={`badge-loss-${item.inventory.id}`}
              >
                <TrendingDown className="h-3 w-3" aria-hidden="true" />
                <span className="sm:hidden">Loss</span>
                <span className="hidden sm:inline">Loss {formatCurrency(loss.lossAmount)}</span>
              </Badge>
            )}
            {item.customPrice !== item.inventory.sellingPrice && (
              <Badge variant="secondary" className="text-[11px] h-4 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 shrink-0">
                Custom
              </Badge>
            )}
          </div>
        </div>
        <IconButton
          label="Remove item"
          variant="ghost"
          className="h-7 w-7 text-destructive shrink-0 self-start"
          onClick={() => onRemove(item.inventory.id)}
          data-testid={`button-remove-${item.inventory.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </IconButton>
      </div>

      <QuantityPriceControls
        quantity={item.quantity}
        unitPrice={item.customPrice}
        listPrice={item.inventory.sellingPrice}
        lineTotal={item.totalPrice}
        allowFractional={item.inventory.allowFractional ?? false}
        unit={item.inventory.unit}
        maxQuantity={item.inventory.type === "service" ? 999 : item.inventory.quantity}
        formatCurrency={formatCurrency}
        onStep={(delta) => onUpdateQuantity(item.inventory.id, delta)}
        onSetQuantity={(qty) => onSetExactQuantity(item.inventory.id, qty)}
        onSetPrice={(price) => onUpdatePrice(item.inventory.id, price)}
        testIdSuffix={item.inventory.id}
        onKeyDown={advanceFocus}
        trailing={isService ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 shrink-0 gap-0.5 text-xs whitespace-nowrap",
              missingLead
                ? "text-destructive hover:text-destructive"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setStaffExpanded((v) => !v)}
            title="Staff assignment"
          >
            {missingLead && <AlertCircle className="h-3 w-3" />}
            <UserCog className="h-3 w-3" />
            {staffExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        ) : undefined}
        priceFootnote={loss ? (
          <span className="text-[11px] font-medium text-red-600 dark:text-red-400 w-full" role="status">
            Below cost, you lose {formatCurrency(loss.lossAmount)} on this line.
          </span>
        ) : undefined}
      />

      {/* Staff assignment — collapsible, only for services */}
      {isService && staffExpanded && (
        <StaffAssignmentFields
          value={item}
          staffList={staffList}
          idPrefix={item.inventory.id}
          onChange={(field, value) => onUpdateStaff(item.inventory.id, field as keyof CartItem, value)}
        />
      )}
    </div>
  );
}
