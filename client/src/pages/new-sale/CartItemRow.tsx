import type { KeyboardEvent } from "react";
import { Minus, Plus, Trash2, UserCog } from "lucide-react";
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

// Pressing Enter on a cart input moves focus to the next focusable element
// inside #pos-cart-section, stopping at the checkout button.
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
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium text-sm truncate">{item.inventory.name}</p>
            <Badge variant="outline" className="text-[10px] h-5 py-0 capitalize">
              {item.inventory.type}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <span>List price: {formatCurrency(item.inventory.sellingPrice)}</span>
            {item.customPrice !== item.inventory.sellingPrice && (
              <Badge variant="secondary" className="text-[9px] h-4 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                Custom Price
              </Badge>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          onClick={() => onRemove(item.inventory.id)}
          data-testid={`button-remove-${item.inventory.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Price:</Label>
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
            className="h-7 w-20 font-mono text-sm"
            data-testid={`input-price-${item.inventory.id}`}
            onKeyDown={advanceFocus}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onUpdateQuantity(item.inventory.id, -1)}
            data-testid={`button-decrease-${item.inventory.id}`}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            step="1"
            min="1"
            max={item.inventory.type === "service" ? 999 : item.inventory.quantity}
            value={item.quantity || ""}
            onChange={(e) => {
              const val = e.target.value;
              onSetExactQuantity(item.inventory.id, val === "" ? 1 : parseInt(val) || 1);
            }}
            className="h-7 w-14 text-center font-mono text-sm px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            data-testid={`input-quantity-${item.inventory.id}`}
            onKeyDown={advanceFocus}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onUpdateQuantity(item.inventory.id, 1)}
            disabled={item.quantity >= (item.inventory.type === "service" ? 999 : item.inventory.quantity)}
            data-testid={`button-increase-${item.inventory.id}`}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <span className="font-mono text-sm font-medium ml-auto">
          {formatCurrency(item.totalPrice)}
        </span>
      </div>

      {item.inventory.type === "service" && (
        <div className="mt-2 pt-2 border-t border-muted space-y-2">
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
