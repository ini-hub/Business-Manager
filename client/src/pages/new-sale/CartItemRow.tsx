import { useState, type KeyboardEvent } from "react";
import { Minus, Plus, Trash2, UserCog, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import type { Staff } from "@shared/schema";
import type { CartItem } from "./types";
import { quantityStep, parseQuantityInput, formatQuantity } from "@/lib/quantity-utils";

interface CartItemRowProps {
  item: CartItem;
  staffList: Staff[];
  formatCurrency: (v: number) => string;
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
        : isService
          ? "border-l-violet-500 dark:border-l-violet-400"
          : "border-l-sky-500 dark:border-l-sky-400"
    )}>
      {/* Row 1: name + delete (delete always anchored top-right); item type is shown via the left-edge color accent, not a badge, so it never competes with the name for space */}
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
          data-testid={`button-remove-${item.inventory.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Row 2a: qty stepper + total + staff toggle — wraps instead of overflowing when the cart panel is narrow, but stays packed together (no ml-auto/justify-between) so it doesn't stretch apart when the panel is wide */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onUpdateQuantity(item.inventory.id, item.inventory.allowFractional ? -0.5 : -1)}
          data-testid={`button-decrease-${item.inventory.id}`}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          type="number"
          step={quantityStep(item.inventory.allowFractional ?? false)}
          min={item.inventory.allowFractional ? "0.01" : "1"}
          max={item.inventory.type === "service" ? 999 : item.inventory.quantity || undefined}
          value={item.quantity || ""}
          onChange={(e) => {
            const parsed = parseQuantityInput(e.target.value, item.inventory.allowFractional ?? false);
            onSetExactQuantity(item.inventory.id, parsed);
          }}
          className="h-7 w-10 text-center font-mono text-xs px-1 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          data-testid={`input-quantity-${item.inventory.id}`}
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
          disabled={!item.inventory.allowFractional && item.quantity >= (item.inventory.type === "service" ? 999 : item.inventory.quantity)}
          data-testid={`button-increase-${item.inventory.id}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
        <span className="font-mono text-sm font-medium shrink-0 ml-2">
          {formatCurrency(item.totalPrice)}
        </span>
        {isService && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-1.5 shrink-0 gap-0.5 text-xs whitespace-nowrap",
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
        )}
      </div>

      {/* Row 2c: unit price input */}
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
          data-testid={`input-price-${item.inventory.id}`}
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

      {/* Staff assignment — collapsible, only for services */}
      {isService && staffExpanded && (
        <div className="pt-2 border-t border-muted space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <UserCog className="h-3 w-3" />
            Staff Assignment
          </p>

          {/* Lead Staff */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Lead *</span>
            <StaffPopover
              staffList={staffList.filter((s) => !s.isArchived)}
              selectedId={item.leadStaffId}
              excludeIds={[]}
              hasError={!item.leadStaffId}
              onSelect={(id) => onUpdateStaff(item.inventory.id, "leadStaffId", id)}
            />
          </div>

          {/* Assisting Staff 1 */}
          {item.showAsst1 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #1</span>
              <StaffPopover
                staffList={staffList.filter((s) => !s.isArchived && s.id !== item.leadStaffId)}
                selectedId={item.assistingStaff1Id}
                excludeIds={[item.leadStaffId ?? ""]}
                hasError={false}
                onSelect={(id) => onUpdateStaff(item.inventory.id, "assistingStaff1Id", id)}
              />
              {item.assistingStaff1Id && !item.showAsst2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => onUpdateStaff(item.inventory.id, "showAsst2", true)}
                >
                  +Asst
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={() => onUpdateStaff(item.inventory.id, "showAsst1", true)}
            >
              + Add Assisting Staff
            </Button>
          )}

          {/* Assisting Staff 2 */}
          {item.showAsst2 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #2</span>
              <StaffPopover
                staffList={staffList.filter(
                  (s) => !s.isArchived && s.id !== item.leadStaffId && s.id !== item.assistingStaff1Id
                )}
                selectedId={item.assistingStaff2Id}
                excludeIds={[item.leadStaffId ?? "", item.assistingStaff1Id ?? ""]}
                hasError={false}
                onSelect={(id) => onUpdateStaff(item.inventory.id, "assistingStaff2Id", id)}
              />
            </div>
          )}

          {/* Commission Split */}
          {(item.assistingStaff1Id || item.assistingStaff2Id) && (
            <div className="pt-1 flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">Commission Split</p>
              <RadioGroup
                value={item.commissionSplit}
                onValueChange={(v) => onUpdateStaff(item.inventory.id, "commissionSplit", v)}
                className="flex gap-3"
              >
                <div className="flex items-center space-x-1">
                  <RadioGroupItem value="standard" id={`split-std-${item.inventory.id}`} className="h-3 w-3" />
                  <Label htmlFor={`split-std-${item.inventory.id}`} className="text-[10px] font-normal cursor-pointer">Standard (80/20)</Label>
                </div>
                <div className="flex items-center space-x-1">
                  <RadioGroupItem value="equal" id={`split-eq-${item.inventory.id}`} className="h-3 w-3" />
                  <Label htmlFor={`split-eq-${item.inventory.id}`} className="text-[10px] font-normal cursor-pointer">Equal (50/50)</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StaffPopoverProps {
  staffList: Staff[];
  selectedId?: string | null;
  excludeIds: string[];
  hasError: boolean;
  onSelect: (id: string) => void;
}

function StaffPopover({ staffList, selectedId, hasError, onSelect }: StaffPopoverProps) {
  const selectedName = staffList.find((s) => s.id === selectedId)?.name;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`flex-1 justify-between font-normal h-7 text-xs ${hasError ? "border-destructive/50" : ""}`}
        >
          {selectedName ?? "Select…"}
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search staff…" />
          <CommandList>
            <CommandEmpty>Not found</CommandEmpty>
            <CommandGroup>
              {staffList.map((s) => {
                const presenter = new StaffPresenter(s);
                return (
                  <CommandItem key={s.id} value={s.name} onSelect={() => onSelect(s.id)}>
                    <Check className={cn("mr-2 h-3 w-3", selectedId === s.id ? "opacity-100" : "opacity-0")} />
                    <EntityDisplay presenter={presenter} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
