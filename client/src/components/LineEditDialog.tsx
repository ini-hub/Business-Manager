import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronsUpDown, Repeat } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchAllStaff } from "@/lib/staff-api";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";
import {
  StaffAssignmentFields,
  applyStaffChange,
  type StaffAssignmentField,
  type StaffAssignmentValue,
} from "@/components/sale-line/StaffAssignmentFields";
import { QuantityPriceControls } from "@/components/sale-line/QuantityPriceControls";
import type { Staff } from "@shared/schema";

/** One receipt line as the editor needs it (built from the receipt payload). */
export interface EditableLine {
  /** checkouts.id of the line */
  checkoutId: string;
  inventoryId: string;
  name: string;
  type: "service" | "product";
  allowFractional: boolean;
  unit?: string | null;
  /** Units still on the sale (ordered minus returned). */
  quantity: number;
  /** Pre-tax unit price actually sold at. */
  unitPrice: number;
  listPrice: number;
  /** What the customer paid for the units still on the sale (tax/discount inclusive). */
  chargedTotal: number;
  /** Tax as a fraction of the pre-tax line — used only for the settlement estimate. */
  taxRate: number;
  leadStaffId?: string | null;
  assistingStaff1Id?: string | null;
  assistingStaff2Id?: string | null;
  commissionSplit: "standard" | "equal";
}

type Settlement = "cash" | "transfer" | "store_credit" | "credit";

interface Draft extends StaffAssignmentValue {
  inventoryId: string;
  name: string;
  type: "service" | "product";
  allowFractional: boolean;
  unit?: string | null;
  listPrice: number;
  quantity: number;
  unitPrice: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Any checkout id on the receipt — only used for cache keys. */
  checkoutId: string;
  storeId: string;
  currency: string;
  hasCustomer: boolean;
  lines: EditableLine[];
  onSaved?: () => void;
}

const EPS = 0.005;

function toDraft(l: EditableLine): Draft {
  return {
    inventoryId: l.inventoryId,
    name: l.name,
    type: l.type,
    allowFractional: l.allowFractional,
    unit: l.unit,
    listPrice: l.listPrice,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    leadStaffId: l.leadStaffId ?? null,
    assistingStaff1Id: l.assistingStaff1Id ?? null,
    assistingStaff2Id: l.assistingStaff2Id ?? null,
    commissionSplit: l.commissionSplit,
    showAsst1: !!l.assistingStaff1Id,
    showAsst2: !!l.assistingStaff2Id,
  };
}

/** Mirrors SalesRepository.amendLine so the footer can say what will happen. */
function classify(line: EditableLine, d: Draft): "none" | "staff" | "partial_return" | "add_quantity" | "replace" {
  const sameItem = d.inventoryId === line.inventoryId;
  const samePrice = Math.abs(d.unitPrice - line.unitPrice) < EPS;
  const sameQty = Math.abs(d.quantity - line.quantity) < 0.00005;
  if (sameItem && samePrice && sameQty) {
    const staffChanged =
      (d.leadStaffId ?? null) !== (line.leadStaffId ?? null) ||
      (d.assistingStaff1Id ?? null) !== (line.assistingStaff1Id ?? null) ||
      (d.assistingStaff2Id ?? null) !== (line.assistingStaff2Id ?? null) ||
      (!!(d.assistingStaff1Id || d.assistingStaff2Id) && d.commissionSplit !== line.commissionSplit);
    return staffChanged ? "staff" : "none";
  }
  if (sameItem && samePrice) return d.quantity < line.quantity ? "partial_return" : "add_quantity";
  return "replace";
}

export function LineEditDialog({ open, onOpenChange, checkoutId, storeId, currency, hasCustomer, lines, onSaved }: Props) {
  const { toast } = useToast();
  const fmt = (v: number) => formatCurrencyUtil(v, currency || "NGN");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<Settlement>("cash");
  const [error, setError] = useState("");

  // Seed once per open. `lines` is rebuilt by the parent on every render, so
  // depending on it would wipe the user's edits whenever the receipt refetches.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(linesRef.current.map((l) => [l.checkoutId, toDraft(l)])));
    setReason("");
    setSettlement("cash");
    setError("");
  }, [open]);

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", storeId],
    queryFn: () => fetchAllStaff(storeId),
    enabled: open && !!storeId,
  });

  const patch = (id: string, change: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));

  const changeStaff = (id: string, field: StaffAssignmentField, value: string | null | boolean) =>
    setDrafts((prev) => ({ ...prev, [id]: applyStaffChange(prev[id], field, value) }));

  const plan = useMemo(() => {
    const rows = lines
      .map((l) => ({ line: l, draft: drafts[l.checkoutId] }))
      .filter((r) => !!r.draft)
      .map((r) => ({ ...r, mode: classify(r.line, r.draft) }));
    const changed = rows.filter((r) => r.mode !== "none");
    const moneyRows = changed.filter((r) => r.mode !== "staff");

    // Estimate only: the server prices the replacement with the store's tax rate.
    let net = 0;
    for (const r of moneyRows) {
      const unitCharged = r.line.chargedTotal / r.line.quantity;
      const newUnit = r.draft.unitPrice * (1 + r.line.taxRate);
      if (r.mode === "partial_return") net -= unitCharged * (r.line.quantity - r.draft.quantity);
      else if (r.mode === "add_quantity") net += newUnit * (r.draft.quantity - r.line.quantity);
      else net += newUnit * r.draft.quantity - unitCharged * r.line.quantity;
    }
    const creditOk = moneyRows.length > 0 && moneyRows.every((r) => r.mode === "add_quantity");
    const missingLead = changed.some((r) => r.draft.type === "service" && !r.draft.leadStaffId);
    return { changed, moneyRows, net, creditOk, missingLead };
  }, [lines, drafts]);

  useEffect(() => {
    if (settlement === "credit" && !plan.creditOk) setSettlement("cash");
  }, [settlement, plan.creditOk]);

  const mutation = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      for (const { line, draft, mode } of plan.changed) {
        const body: Record<string, unknown> = {
          reason: reason.trim() || "Corrected performed by",
          leadStaffId: draft.type === "service" ? draft.leadStaffId : null,
          assistingStaff1Id: draft.type === "service" ? draft.assistingStaff1Id : null,
          assistingStaff2Id: draft.type === "service" ? draft.assistingStaff2Id : null,
          commissionSplit: draft.commissionSplit,
        };
        if (mode !== "staff") {
          body.inventoryId = draft.inventoryId;
          body.quantity = draft.quantity;
          body.unitPrice = draft.unitPrice;
          body.settlementMethod = settlement;
        }
        const res = await apiRequest("PATCH", `/api/transactions/${checkoutId}/lines/${line.checkoutId}`, body);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const prefix = done.length ? `(${done.length} earlier line${done.length > 1 ? "s" : ""} already saved) ` : "";
          throw new Error(`${prefix}${line.name}: ${data.error || "could not be updated."}`);
        }
        done.push(line.checkoutId);
      }
      return done.length;
    },
    onSuccess: (count) => {
      for (const key of ["/api/transactions", "/api/staff", "/api/inventory", "/api/dashboard/stats", "/api/profit-loss"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: count > 1 ? `${count} lines updated` : "Line updated" });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err: Error) => {
      setError(err.message);
      // Earlier lines may have been saved — refresh so the form shows reality.
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    },
  });

  const needsReason = plan.moneyRows.length > 0;
  const canSave =
    plan.changed.length > 0 &&
    !plan.missingLead &&
    !mutation.isPending &&
    (!needsReason || reason.trim().length > 0) &&
    !(settlement === "store_credit" && !hasCustomer);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit line items</DialogTitle>
          <DialogDescription>
            Change who did the work, the quantity, the price or the item. Staff and split drive commission; money and
            stock changes are booked as a return plus a replacement dated to the original sale. Not possible once the
            sale is in a finalized payroll period.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {lines.map((line) => {
            const d = drafts[line.checkoutId];
            if (!d) return null;
            const mode = classify(line, d);
            const isService = d.type === "service";
            const missingLead = isService && !d.leadStaffId;
            const keepVisible = [line.leadStaffId, line.assistingStaff1Id, line.assistingStaff2Id].filter(Boolean) as string[];
            return (
              <div
                key={line.checkoutId}
                className={cn(
                  "flex flex-col gap-2 p-3 rounded-lg bg-muted/50 border-l-4",
                  missingLead
                    ? "border border-destructive/40"
                    : isService
                      ? "border-l-violet-500 dark:border-l-violet-400"
                      : "border-l-sky-500 dark:border-l-sky-400",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <p className="font-medium text-sm leading-snug">{d.name}</p>
                    {mode !== "none" && (
                      <Badge variant="secondary" className="text-[11px] h-4 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                        Edited
                      </Badge>
                    )}
                  </div>
                  <ItemSwapPicker
                    storeId={storeId}
                    type={line.type}
                    currentId={d.inventoryId}
                    onPick={(item) =>
                      patch(line.checkoutId, {
                        inventoryId: item.id,
                        name: item.name,
                        listPrice: Number(item.sellingPrice) || 0,
                        unitPrice: Number(item.sellingPrice) || 0,
                        allowFractional: !!item.allowFractional,
                        unit: item.unit,
                        quantity: item.allowFractional ? d.quantity : Math.max(1, Math.round(d.quantity)),
                      })
                    }
                  />
                </div>

                <QuantityPriceControls
                  quantity={d.quantity}
                  unitPrice={d.unitPrice}
                  listPrice={d.listPrice}
                  lineTotal={d.quantity * d.unitPrice}
                  allowFractional={d.allowFractional}
                  unit={d.unit}
                  maxQuantity={isService ? 999 : undefined}
                  formatCurrency={fmt}
                  onStep={(delta) =>
                    patch(line.checkoutId, { quantity: Math.max(d.allowFractional ? 0.01 : 1, Math.round((d.quantity + delta) * 10000) / 10000) })
                  }
                  onSetQuantity={(qty) => patch(line.checkoutId, { quantity: qty })}
                  onSetPrice={(price) => patch(line.checkoutId, { unitPrice: price })}
                  testIdSuffix={line.checkoutId}
                />

                {isService && (
                  <StaffAssignmentFields
                    value={d}
                    staffList={staffList}
                    idPrefix={line.checkoutId}
                    keepVisibleIds={keepVisible}
                    onChange={(field, value) => changeStaff(line.checkoutId, field, value)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {plan.moneyRows.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {plan.net > EPS ? "Customer pays (est.)" : plan.net < -EPS ? "Refund due (est.)" : "Net change"}
              </span>
              <span className="font-mono font-semibold">{fmt(Math.abs(plan.net))}</span>
            </div>

            {Math.abs(plan.net) > EPS && (
              <div className="space-y-1.5">
                <Label className="text-sm">{plan.net > 0 ? "Collected by" : "Refunded by"}</Label>
                <Select value={settlement} onValueChange={(v) => setSettlement(v as Settlement)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                    <SelectItem value="store_credit" disabled={!hasCustomer}>Store credit{hasCustomer ? "" : " (needs a customer)"}</SelectItem>
                    {plan.creditOk && plan.net > 0 && <SelectItem value="credit">On credit (balance due)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="line-edit-reason" className="text-sm">Reason <span className="text-destructive">*</span></Label>
              <Textarea
                id="line-edit-reason"
                rows={2}
                placeholder="Why is this being changed?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
        )}

        {(error || plan.missingLead) && (
          <p className="text-xs text-destructive flex items-start gap-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
            {error || "Every service needs a lead."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={() => {
              setError("");
              mutation.mutate();
            }}
            disabled={!canSave}
          >
            {mutation.isPending ? "Saving..." : plan.changed.length > 1 ? `Save ${plan.changed.length} changes` : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SwapItem {
  id: string;
  name: string;
  type: string;
  sellingPrice: number | string | null;
  allowFractional?: boolean | null;
  unit?: string | null;
  quantity?: number | string | null;
}

/** Same-type item picker, same search source as the missed-item sheet. */
function ItemSwapPicker({ storeId, type, currentId, onPick }: {
  storeId: string;
  type: "service" | "product";
  currentId: string;
  onPick: (item: SwapItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: items = [] } = useQuery<SwapItem[]>({
    queryKey: ["/api/inventory", storeId, "swap", type, search],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId, limit: "40" });
      if (search) params.set("search", search);
      const res = await apiRequest("GET", `/api/inventory?${params}`);
      const data = await res.json();
      const rows: SwapItem[] = Array.isArray(data) ? data : (data.data ?? []);
      return rows.filter((i) => i.type === type);
    },
    enabled: open && !!storeId,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 shrink-0 text-muted-foreground">
          <Repeat className="h-3 w-3" />
          Change item
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${type}s…`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>Not found</CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
                const out = type === "product" && Number(item.quantity ?? 0) <= 0 && item.id !== currentId;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    disabled={out}
                    onSelect={() => {
                      onPick(item);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-3 w-3", item.id === currentId ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{item.name}</span>
                    {out && <span className="text-[11px] text-destructive ml-2">Out of stock</span>}
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
