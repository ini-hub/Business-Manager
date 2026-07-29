import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { cn } from "@/lib/utils";

interface AuditItem {
  inventoryId: string;
  name: string;
  systemQuantity: number;
  physicalQuantity: number;
  reason: string;
}

export default function InventoryAuditNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [conductedByStaffId, setConductedByStaffId] = useState("");
  const [notes, setNotes] = useState("");
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: inventoryList = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!conductedByStaffId) throw new Error("Select who conducted the audit.");
      if (auditItems.length === 0) throw new Error("Add at least one product to audit.");
      const res = await apiRequest("POST", "/api/stock-audits", {
        storeId: currentStore!.id,
        conductedByStaffId,
        notes,
        items: auditItems,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to submit audit");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-audits"] });
      toast({ title: "Audit draft submitted" });
      setLocation("/inventory");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  const addItem = (val: string) => {
    const item = inventoryList.find((i) => i.id === val);
    if (item && !auditItems.some((ai) => ai.inventoryId === item.id)) {
      setAuditItems((prev) => [
        ...prev,
        { inventoryId: item.id, name: item.name, systemQuantity: item.quantity, physicalQuantity: item.quantity, reason: "Miscount" },
      ]);
    }
  };

  const updateItem = (index: number, field: keyof AuditItem, value: any) => {
    setAuditItems((prev) => prev.map((ai, i) => (i === index ? { ...ai, [field]: value } : ai)));
  };

  const removeItem = (inventoryId: string) => {
    setAuditItems((prev) => prev.filter((ai) => ai.inventoryId !== inventoryId));
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        title="New Stock Audit"
        description="Record a physical count to reconcile with system stock."
        actions={
          <Button variant="outline" onClick={() => setLocation("/inventory")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Inventory
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Conducted By <span className="text-destructive">*</span>
              </Label>
              <Select value={conductedByStaffId} onValueChange={setConductedByStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staff…" />
                </SelectTrigger>
                <SelectContent>
                  {staffList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-notes">General Notes</Label>
              <Input
                id="audit-notes"
                placeholder="e.g. Monthly stock take"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Add Products to Audit</Label>
            <Select value="" onValueChange={addItem}>
              <SelectTrigger>
                <SelectValue placeholder="Select a product to add…" />
              </SelectTrigger>
              <SelectContent>
                {inventoryList
                  .filter((i) => i.type !== "service" && !auditItems.some((ai) => ai.inventoryId === i.id))
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} (stock: {i.quantity}{i.unit ? ` ${i.unit}` : ""})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {auditItems.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No products added yet. Select one above.
            </div>
          ) : (
            <div className="space-y-3 max-h-[450px] overflow-y-auto">
              {auditItems.map((ai, index) => {
                const variance = ai.physicalQuantity - ai.systemQuantity;
                return (
                  <div key={ai.inventoryId} className="rounded-lg border p-4 space-y-3 bg-muted/10">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{ai.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(ai.inventoryId)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">System Qty</span>
                        <Input
                          type="number"
                          readOnly
                          value={ai.systemQuantity}
                          className="h-8 font-mono text-xs bg-muted/30"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">Physical Qty</span>
                        <Input
                          type="number"
                          min="0"
                          step={inventoryList.find(i => i.id === ai.inventoryId)?.allowFractional ? "0.01" : "1"}
                          value={ai.physicalQuantity}
                          onChange={(e) => {
                            const isFrac = inventoryList.find(i => i.id === ai.inventoryId)?.allowFractional;
                            updateItem(index, "physicalQuantity", isFrac ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0));
                          }}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block mb-1">Variance</span>
                        <div className={cn(
                          "h-8 flex items-center justify-center rounded-md border text-xs font-mono font-bold",
                          variance > 0 ? "bg-green-500/10 border-green-500/30 text-green-600"
                            : variance < 0 ? "bg-red-500/10 border-red-500/30 text-red-600"
                            : "bg-muted border-border text-muted-foreground"
                        )}>
                          {variance > 0 ? `+${parseFloat(variance.toFixed(4))}` : parseFloat(variance.toFixed(4))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block mb-1">Reason for Drift</span>
                      <Select value={ai.reason} onValueChange={(v) => updateItem(index, "reason", v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Theft">Theft / Pilferage</SelectItem>
                          <SelectItem value="Damage">Damage / Spillage</SelectItem>
                          <SelectItem value="Miscount">Regular Miscount</SelectItem>
                          <SelectItem value="DataEntry">Data Entry Error</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Separator />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/inventory")}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || auditItems.length === 0 || !conductedByStaffId}
            >
              <ClipboardList className="h-4 w-4 mr-2" />
              {createMutation.isPending ? "Submitting…" : "Submit Audit Draft"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
