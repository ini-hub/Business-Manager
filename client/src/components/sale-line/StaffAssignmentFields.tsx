import { Check, ChevronsUpDown, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { cn } from "@/lib/utils";
import type { Staff } from "@shared/schema";

/**
 * The lead / assistants / commission-split block of a sale line. One component
 * for every place a line's staff is chosen (checkout cart, receipt line editor,
 * missed item), so they can never drift apart.
 */
export interface StaffAssignmentValue {
  leadStaffId?: string | null;
  assistingStaff1Id?: string | null;
  assistingStaff2Id?: string | null;
  commissionSplit: "standard" | "equal";
  showAsst1?: boolean;
  showAsst2?: boolean;
}

export type StaffAssignmentField = keyof StaffAssignmentValue;

/** Cascade rules: dropping the lead drops the assistants; dropping #1 drops #2. */
export function applyStaffChange<T extends StaffAssignmentValue>(
  item: T,
  field: StaffAssignmentField,
  value: string | null | boolean,
): T {
  const updated = { ...item, [field]: value } as T;
  if (field === "leadStaffId" && !value) {
    updated.assistingStaff1Id = null;
    updated.assistingStaff2Id = null;
    updated.showAsst1 = false;
    updated.showAsst2 = false;
  } else if (field === "assistingStaff1Id" && !value) {
    updated.assistingStaff2Id = null;
    updated.showAsst2 = false;
  }
  return updated;
}

interface Props {
  value: StaffAssignmentValue;
  staffList: Staff[];
  onChange: (field: StaffAssignmentField, value: string | null | boolean) => void;
  /** Unique per line — radio ids must not collide when several lines render. */
  idPrefix: string;
  /** Staff assigned today who may since have been archived; kept selectable so the line still reads correctly. */
  keepVisibleIds?: string[];
}

export function StaffAssignmentFields({ value, staffList, onChange, idPrefix, keepVisibleIds = [] }: Props) {
  const selectable = staffList.filter((s) => !s.isArchived || keepVisibleIds.includes(s.id));
  const hasAssistant = !!(value.assistingStaff1Id || value.assistingStaff2Id);

  return (
    <div className="pt-2 border-t border-muted space-y-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <UserCog className="h-3 w-3" />
        Staff Assignment
      </p>

      {/* Lead Staff */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Lead *</span>
        <StaffPopover
          staffList={selectable}
          selectedId={value.leadStaffId}
          hasError={!value.leadStaffId}
          onSelect={(id) => onChange("leadStaffId", id)}
        />
      </div>

      {/* Assisting Staff 1 */}
      {value.showAsst1 || value.assistingStaff1Id ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #1</span>
          <StaffPopover
            staffList={selectable.filter((s) => s.id !== value.leadStaffId)}
            selectedId={value.assistingStaff1Id}
            hasError={false}
            onSelect={(id) => onChange("assistingStaff1Id", id)}
            onClear={() => onChange("assistingStaff1Id", null)}
          />
          {value.assistingStaff1Id && !(value.showAsst2 || value.assistingStaff2Id) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => onChange("showAsst2", true)}
            >
              +Asst
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground"
          onClick={() => onChange("showAsst1", true)}
        >
          + Add Assisting Staff
        </Button>
      )}

      {/* Assisting Staff 2 */}
      {(value.showAsst2 || value.assistingStaff2Id) && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #2</span>
          <StaffPopover
            staffList={selectable.filter((s) => s.id !== value.leadStaffId && s.id !== value.assistingStaff1Id)}
            selectedId={value.assistingStaff2Id}
            hasError={false}
            onSelect={(id) => onChange("assistingStaff2Id", id)}
            onClear={() => onChange("assistingStaff2Id", null)}
          />
        </div>
      )}

      {/* Commission Split */}
      {hasAssistant && (
        <div className="pt-1 flex flex-col gap-1">
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-tight">Commission Split</p>
          <RadioGroup
            value={value.commissionSplit}
            onValueChange={(v) => onChange("commissionSplit", v)}
            className="flex gap-3"
          >
            <div className="flex items-center space-x-1">
              <RadioGroupItem value="standard" id={`split-std-${idPrefix}`} className="h-3 w-3" />
              <Label htmlFor={`split-std-${idPrefix}`} className="text-[11px] font-normal cursor-pointer">Standard (80/20)</Label>
            </div>
            <div className="flex items-center space-x-1">
              <RadioGroupItem value="equal" id={`split-eq-${idPrefix}`} className="h-3 w-3" />
              <Label htmlFor={`split-eq-${idPrefix}`} className="text-[11px] font-normal cursor-pointer">Equal (50/50)</Label>
            </div>
          </RadioGroup>
        </div>
      )}
    </div>
  );
}

interface StaffPopoverProps {
  staffList: Staff[];
  selectedId?: string | null;
  hasError: boolean;
  onSelect: (id: string) => void;
  /** Assistant slots only: lets a filled slot be emptied. */
  onClear?: () => void;
}

function StaffPopover({ staffList, selectedId, hasError, onSelect, onClear }: StaffPopoverProps) {
  const selectedName = staffList.find((s) => s.id === selectedId)?.name;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
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
              {onClear && selectedId && (
                <CommandItem value="__none__" onSelect={onClear}>
                  <Check className="mr-2 h-3 w-3 opacity-0" />
                  <span className="text-muted-foreground">None</span>
                </CommandItem>
              )}
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
