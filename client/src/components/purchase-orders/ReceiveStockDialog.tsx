import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fetchAllStaff } from "@/lib/staff-api";
import { stagePoReceipt, checkPoReceiptFile, PO_RECEIPT_ACCEPT } from "@/lib/poReceiptUpload";
import type { FullPO } from "@/lib/purchase-order-types";
import type { Staff } from "@shared/schema";

interface Props {
  po: FullPO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Book a delivery against a placed PO: pick who received it, how much of each
// line arrived (capped at what's outstanding) and optionally attach the
// supplier's delivery receipt.
export function ReceiveStockDialog({ po, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [staffId, setStaffId] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", po.storeId, "all"],
    queryFn: () => fetchAllStaff<Staff>(po.storeId),
    enabled: open,
  });

  // Reset to "everything still outstanding" each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQuantities(Object.fromEntries(po.items.map((i) => [i.inventoryId, Math.max(0, i.quantity - (i.receivedQuantity || 0))])));
    setReceiptFile(null);
  }, [open, po.items]);

  useEffect(() => {
    if (open && !staffId && staffList.length > 0) setStaffId(staffList[0].id);
  }, [open, staffId, staffList]);

  const receive = useMutation({
    mutationFn: async () => {
      if (!staffId) throw new Error("Please select the receiving staff member.");
      const itemsToReceive = Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([inventoryId, quantity]) => ({ inventoryId, quantity }));
      if (itemsToReceive.length === 0) throw new Error("Enter the quantity received for at least one item.");

      // Optional delivery receipt, uploaded before stock is booked.
      const receiptKey = receiptFile ? await stagePoReceipt(po.id, receiptFile) : undefined;
      await apiRequest("POST", `/api/purchase-orders/${po.id}/receive`, {
        staffId,
        receiptKey,
        receiptName: receiptFile?.name,
        itemsToReceive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", po.id] });
      toast({ title: "Stock received", description: "Inventory updated and the supplier bill recorded." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't receive stock", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription>
            Count what arrived. Inventory and cost update, and a supplier bill is recorded for the amount received.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="receiveStaff">Received by</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger id="receiveStaff"><SelectValue placeholder="Choose staff member" /></SelectTrigger>
              <SelectContent>
                {staffList.map((st) => (
                  <SelectItem key={st.id} value={st.id}>{st.name} ({st.staffNumber})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Items</Label>
            <div className="space-y-2">
              {po.items.map((item) => {
                const outstanding = Math.max(0, item.quantity - (item.receivedQuantity || 0));
                const frac = !!item.inventory.allowFractional;
                const unit = item.inventory.unit ? ` ${item.inventory.unit}` : "";
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{item.inventory.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Ordered {item.quantity}{unit} · received {item.receivedQuantity || 0} · outstanding {outstanding}
                      </p>
                    </div>
                    <Input
                      type="number"
                      aria-label={`Quantity received for ${item.inventory.name}`}
                      min={0}
                      max={outstanding}
                      step={frac ? "0.01" : "1"}
                      disabled={outstanding === 0}
                      className="w-24 text-right shrink-0"
                      value={quantities[item.inventoryId] ?? 0}
                      onChange={(e) => {
                        const parsed = frac ? parseFloat(e.target.value) : parseInt(e.target.value);
                        const val = Math.min(outstanding, Math.max(0, parsed || 0));
                        setQuantities((q) => ({ ...q, [item.inventoryId]: val }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="deliveryReceipt">Delivery receipt (optional)</Label>
            <Input
              id="deliveryReceipt"
              type="file"
              accept={PO_RECEIPT_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  try { checkPoReceiptFile(f); } catch (err) {
                    toast({ title: "Can't use that file", description: (err as Error).message, variant: "destructive" });
                    e.target.value = "";
                    return;
                  }
                }
                setReceiptFile(f);
              }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
              {receive.isPending ? "Receiving…" : "Confirm & add to stock"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
