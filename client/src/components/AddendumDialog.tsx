import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { Check, AlertCircle, Plus, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddendumDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  checkoutId: string;
  receiptNumber: string;
  storeId: string;
  currency: string;
  customerStoreCreditBalance: number;
  onSuccess: () => void;
}

export function AddendumDialog({
  open,
  onOpenChange,
  checkoutId,
  receiptNumber,
  storeId,
  currency,
  customerStoreCreditBalance,
  onSuccess,
}: AddendumDialogProps) {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const fmt = (val: number) => formatCurrencyUtil(val, currency || currentStore?.currency || "NGN");

  const [itemSearch, setItemSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [price, setPrice] = useState<string>("");
  const [staffId, setStaffId] = useState("");
  const [leadStaffId, setLeadStaffId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedItem(null);
      setQuantity("1");
      setPrice("");
      setStaffId("");
      setLeadStaffId("");
      setPaymentMethod("cash");
      setReason("");
      setError("");
      setItemSearch("");
    }
  }, [open]);

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory", storeId, itemSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId, limit: "40" });
      if (itemSearch) params.set("search", itemSearch);
      const res = await apiRequest("GET", `/api/inventory?${params}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items ?? []);
      // Back-bar supplies are never sold — checkout and this addendum path both
      // reject them. Keep them out of the picker entirely rather than let staff
      // pick one and hit that rejection.
      return items.filter((item: any) => item.type !== "supply");
    },
    enabled: open && !!storeId,
  });

  const { data: staffList = [] } = useQuery({
    queryKey: ["/api/staff", storeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff?storeId=${storeId}`);
      return res.json();
    },
    enabled: open && !!storeId,
  });

  const isService = selectedItem?.type === "service";
  const unitPrice = Number(price) || 0;
  const qty = Number(quantity) || 0;
  const lineSubtotal = unitPrice * qty;
  const priceInvalid = !!selectedItem && (price === "" || unitPrice <= 0);
  const storeCreditInsufficient = paymentMethod === "store_credit" && lineSubtotal > customerStoreCreditBalance;

  const addendumMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/transactions/${checkoutId}/addendum`, {
        inventoryId: selectedItem.id,
        quantity: qty,
        customPrice: Number(price),
        staffId,
        leadStaffId: leadStaffId || undefined,
        paymentMethod,
        reason: reason.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add item.");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "Item added to receipt",
        description: data.payrollWarning
          ? `Added successfully. ⚠️ ${data.payrollWarning}`
          : `${selectedItem?.name} added to receipt ${receiptNumber}.`,
        variant: data.payrollWarning ? "destructive" : "default",
      });
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError("");
    if (!selectedItem) return setError("Please select an item.");
    if (qty <= 0) return setError("Quantity must be greater than 0.");
    if (!selectedItem.allowFractional && qty !== Math.floor(qty)) {
      return setError("This item does not allow fractional quantities.");
    }
    if (priceInvalid) return setError("");
    if (!staffId) return setError("Please select who processed this.");
    if (isService && !leadStaffId) {
      return setError("Lead staff is required for service items so commission is correctly attributed.");
    }
    if (storeCreditInsufficient) {
      return setError(`Insufficient store credit. Balance: ${fmt(customerStoreCreditBalance)}`);
    }
    if (!reason.trim()) return setError("A reason is required.");
    addendumMutation.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Add Missed Item
          </SheetTitle>
          <SheetDescription className="text-xs">
            Adding to receipt{" "}
            <span className="font-mono font-medium text-foreground">{receiptNumber}</span>.
            The original sale is not modified.
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Item search */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Item / Service</Label>
            <div className="border rounded-md overflow-hidden">
              <Command className="rounded-none border-none">
                <CommandInput
                  placeholder="Search by name..."
                  value={itemSearch}
                  onValueChange={setItemSearch}
                  className="h-10"
                />
                <CommandList className="max-h-52">
                  <CommandEmpty>
                    <div className="flex flex-col items-center gap-1 py-4 text-muted-foreground">
                      <PackageX className="h-5 w-5 opacity-40" />
                      <span className="text-xs">No items found</span>
                    </div>
                  </CommandEmpty>
                  <CommandGroup>
                    {inventoryItems.map((item: any) => {
                      const outOfStock = item.type === "product" && Number(item.quantity) <= 0;
                      return (
                        <CommandItem
                          key={item.id}
                          value={item.name}
                          disabled={outOfStock}
                          onSelect={() => {
                            if (outOfStock) return;
                            setSelectedItem(item);
                            setPrice(String(item.sellingPrice ?? "0"));
                            setLeadStaffId("");
                          }}
                          className={cn(outOfStock && "opacity-40 cursor-not-allowed")}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4 shrink-0",
                              selectedItem?.id === item.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="flex-1 truncate">{item.name}</span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] py-0 ml-2 shrink-0"
                          >
                            {item.type}
                          </Badge>
                          {item.type === "product" && (
                            <span
                              className={cn(
                                "text-xs ml-2 shrink-0",
                                outOfStock ? "text-destructive font-medium" : "text-muted-foreground"
                              )}
                            >
                              {outOfStock ? "Out of stock" : `${item.quantity} in stock`}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>

          {/* Selected item details */}
          {selectedItem && (
            <>
              <Separator />

              {/* Quantity + Price */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="addendum-qty" className="text-sm">Quantity</Label>
                  <Input
                    id="addendum-qty"
                    type="number"
                    min="0.01"
                    step={selectedItem.allowFractional ? "0.01" : "1"}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="addendum-price" className="text-sm">Price</Label>
                  <Input
                    id="addendum-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={cn(priceInvalid && "border-destructive focus-visible:ring-destructive")}
                  />
                  {priceInvalid && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Enter a price greater than 0
                    </p>
                  )}
                </div>
              </div>

              {/* Processed by */}
              <div className="space-y-1.5">
                <Label className="text-sm">Processed by</Label>
                <Select value={staffId} onValueChange={setStaffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Lead staff — required for services */}
              {isService && (
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Lead / Service Staff{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Required — determines commission attribution for this service.
                  </p>
                  <Select value={leadStaffId} onValueChange={setLeadStaffId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff who performed this..." />
                    </SelectTrigger>
                    <SelectContent>
                      {staffList.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Payment method */}
              <div className="space-y-2">
                <Label className="text-sm">Payment method</Label>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(v) => { setPaymentMethod(v); setError(""); }}
                  className="grid grid-cols-2 gap-2"
                >
                  {(["cash", "transfer", "credit"] as const).map((m) => (
                    <div key={m} className="flex items-center space-x-2">
                      <RadioGroupItem value={m} id={`pm-${m}`} />
                      <Label htmlFor={`pm-${m}`} className="font-normal cursor-pointer capitalize">{m}</Label>
                    </div>
                  ))}

                  <div className={cn("flex items-center space-x-2", customerStoreCreditBalance <= 0 && "opacity-40")}>
                    <RadioGroupItem
                      value="store_credit"
                      id="pm-store_credit"
                      disabled={customerStoreCreditBalance <= 0}
                    />
                    <Label
                      htmlFor="pm-store_credit"
                      className={cn("font-normal", customerStoreCreditBalance > 0 ? "cursor-pointer" : "cursor-not-allowed")}
                    >
                      Store Credit
                    </Label>
                  </div>
                </RadioGroup>

                {paymentMethod === "store_credit" && (
                  <p className={cn(
                    "text-[11px]",
                    storeCreditInsufficient ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {storeCreditInsufficient
                      ? `Insufficient balance. Available: ${fmt(customerStoreCreditBalance)}`
                      : `Available balance: ${fmt(customerStoreCreditBalance)}`}
                  </p>
                )}
                {customerStoreCreditBalance <= 0 && paymentMethod !== "store_credit" && (
                  <p className="text-[11px] text-muted-foreground">
                    Store Credit unavailable — customer has no balance.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Split payments are not supported for addendum items.
                </p>
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <Label htmlFor="addendum-reason" className="text-sm">Reason *</Label>
                <Input
                  id="addendum-reason"
                  placeholder="e.g. Service missed at checkout"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              {/* Amount preview */}
              {qty > 0 && unitPrice > 0 && (
                <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Amount to charge</span>
                  <span className="font-mono font-semibold text-base">{fmt(lineSubtotal)}</span>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-3 bg-background">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={addendumMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={addendumMutation.isPending || storeCreditInsufficient || !selectedItem || priceInvalid}
          >
            {addendumMutation.isPending ? "Adding..." : "Add to Receipt"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
