import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Plus, PlusCircle, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import type { Inventory } from "@shared/schema";

type Vendor = { id: string; name: string; phoneNumber?: string; email?: string; companyName?: string };

export default function PurchaseOrderFormPage() {
  const [, setLocation] = useLocation();
  const { currentStore, stores } = useStore();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  // New PO form state
  const [vendorId, setVendorId] = useState<string>("");
  const [poNumber, setPoNumber] = useState<string>(`PO-${Date.now().toString().slice(-6)}`);
  const [expectedDelivery, setExpectedDelivery] = useState<string>("");
  const [items, setItems] = useState<{ inventoryId: string; quantity: number; unitCost: number }[]>([]);

  // Quick Add Vendor State
  const [isQuickVendorOpen, setIsQuickVendorOpen] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorContact, setNewVendorContact] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorNotes, setNewVendorNotes] = useState("");
  const [newVendorStoreId, setNewVendorStoreId] = useState("");

  const createVendorMutation = useMutation({
    mutationFn: async () => {
      if (!newVendorName.trim()) throw new Error("Vendor name is required.");
      const storeIdToUse = currentStore?.id === "all" ? newVendorStoreId : currentStore!.id;
      if (!storeIdToUse) throw new Error("Please select a store location.");

      await apiRequest("POST", "/api/vendors", {
        storeId: storeIdToUse,
        name: newVendorName.trim(),
        contactName: newVendorContact.trim() || undefined,
        email: newVendorEmail.trim() || undefined,
        phone: newVendorPhone.trim() || undefined,
        address: newVendorAddress.trim() || undefined,
        notes: newVendorNotes.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      toast({ title: "Success", description: "Supplier / Vendor added successfully." });
      setIsQuickVendorOpen(false);
      setNewVendorName("");
      setNewVendorContact("");
      setNewVendorEmail("");
      setNewVendorPhone("");
      setNewVendorAddress("");
      setNewVendorNotes("");
      setNewVendorStoreId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create vendor.", variant: "destructive" });
    },
  });

  // Fetch Vendors
  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/vendors?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Vendor[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/vendors?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Fetch Inventory items
  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/inventory?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Inventory[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // Create PO mutation — "draft" just saves it for later editing/review; "ordered"
  // sends it to the supplier immediately.
  const createPOMutation = useMutation({
    mutationFn: async (status: "draft" | "ordered") => {
      if (items.length === 0) throw new Error("At least one item is required.");
      if (!vendorId) throw new Error("Please select a vendor.");

      const submission = {
        storeId: currentStore!.id,
        vendorId,
        poNumber,
        status,
        expectedDelivery: expectedDelivery || null,
        items,
      };
      await apiRequest("POST", "/api/purchase-orders", submission);
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: "Success",
        description: status === "ordered" ? "Purchase order sent to supplier." : "Purchase order saved as draft.",
      });
      setLocation("/purchase-orders");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save Purchase Order.", variant: "destructive" });
    },
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const addItemRow = () => {
    setItems([...items, { inventoryId: "", quantity: 1, unitCost: 0 }]);
  };

  const removeItemRow = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, field: string, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-populate cost if inventory item is selected
    if (field === "inventoryId") {
      const inv = inventoryItems.find(i => i.id === value);
      if (inv) {
        updated[index].unitCost = Number(inv.costPrice || 0);
      }
    }
    setItems(updated);
  };

  const poTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <StoreRequiredAlert title="Store Required for Purchase Orders" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Top nav bar — same pattern as the Customers "New Customer" screen */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <IconButton
          variant="ghost"
          label="Back to purchase orders"
          className="h-8 w-8"
          onClick={() => setLocation("/purchase-orders")}
        >
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">New Purchase Order</h1>
          <p className="text-xs text-muted-foreground">{currentStore.name}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 animate-in fade-in duration-300">
        <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
          <CardHeader>
            <CardTitle>New Purchase Order Form</CardTitle>
            <CardDescription>Issue procurement requests to vendors, establishing contract terms and cost bases.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="vendor">Target Supplier / Vendor</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-xs font-semibold text-primary flex items-center gap-1 underline hover:no-underline hover:bg-transparent"
                      onClick={() => setIsQuickVendorOpen(true)}
                    >
                      <Plus className="h-3 w-3" /> Quick Add
                    </Button>
                  </div>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name} ({v.companyName || "No Company"})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="poNumber">PO Identification Number</Label>
                  <Input
                    id="poNumber"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="e.g. PO-1002"
                    className="font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expectedDelivery">Expected Date of Arrival</Label>
                  <Input
                    id="expectedDelivery"
                    type="date"
                    value={expectedDelivery}
                    onChange={(e) => setExpectedDelivery(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Required Items Grid</Label>
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <div key={index} className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center bg-muted/40 p-3 rounded-lg border">
                      <div className="flex-1 sm:min-w-[200px]">
                        <Label className="text-xs text-muted-foreground">Select Product</Label>
                        <Select
                          value={item.inventoryId}
                          onValueChange={(val) => updateItemRow(index, "inventoryId", val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose item" />
                          </SelectTrigger>
                          <SelectContent>
                            {inventoryItems.map((inv) => (
                              <SelectItem key={inv.id} value={inv.id}>
                                {inv.name} - SKU: {inv.id.substring(0, 8).toUpperCase()} (In Stock: {inv.quantity})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 sm:flex gap-3 sm:gap-4">
                        <div className="w-full sm:w-24">
                          <Label className="text-xs text-muted-foreground">
                            Order Qty{inventoryItems.find(i => i.id === item.inventoryId)?.unit ? ` (${inventoryItems.find(i => i.id === item.inventoryId)?.unit})` : ""}
                          </Label>
                          <Input
                            type="number"
                            min={inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional ? "0.01" : "1"}
                            step={inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional ? "0.01" : "1"}
                            value={item.quantity}
                            onChange={(e) => {
                              const isFrac = inventoryItems.find(i => i.id === item.inventoryId)?.allowFractional;
                              updateItemRow(index, "quantity", isFrac ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 1);
                            }}
                          />
                        </div>

                        <div className="w-full sm:w-32">
                          <Label className="text-xs text-muted-foreground">Supplying Cost ({storeCurrency})</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitCost}
                            onChange={(e) => updateItemRow(index, "unitCost", Number(e.target.value))}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:block w-full sm:w-36 sm:text-right">
                        <Label className="text-xs text-muted-foreground sm:block">Cost Total</Label>
                        <span className="font-mono font-medium sm:block sm:mt-2">
                          {formatCurrency(item.quantity * item.unitCost)}
                        </span>
                      </div>

                      <IconButton
                        variant="ghost"
                        label="Remove line"
                        onClick={() => removeItemRow(index)}
                        className="text-red-500 hover:text-red-700 self-end sm:self-auto sm:mt-5"
                      >
                        <Trash className="h-4 w-4" />
                      </IconButton>
                    </div>
                  ))}

                  <Button variant="outline" onClick={addItemRow} className="w-full gap-2">
                    <PlusCircle className="h-4 w-4" /> Add Procurement Line
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-muted/20 p-4 rounded-lg border">
                <div className="min-w-0">
                  <span className="text-sm text-muted-foreground">Total Procurement Estimate</span>
                  <h2 className="text-2xl font-bold font-mono text-primary mt-1 truncate">{formatCurrency(poTotal)}</h2>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => createPOMutation.mutate("draft")}
                    disabled={createPOMutation.isPending || items.length === 0}
                    className="flex-1 sm:flex-initial"
                    data-testid="button-save-draft"
                  >
                    Save Draft
                  </Button>
                  <Button
                    onClick={() => createPOMutation.mutate("ordered")}
                    disabled={createPOMutation.isPending || items.length === 0}
                    className="flex-1 sm:flex-initial px-6"
                    data-testid="button-send-to-supplier"
                  >
                    Send to Supplier
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Add Vendor Dialog */}
      <Dialog open={isQuickVendorOpen} onOpenChange={setIsQuickVendorOpen}>
        <DialogContent className="max-w-md border border-border bg-background/95 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Plus className="h-5 w-5 text-primary" /> Quick Add Supplier
            </DialogTitle>
            <DialogDescription>
              Create a new supplier / vendor profile to authorize procurement orders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {currentStore?.id === "all" && (
              <div className="space-y-1.5">
                <Label htmlFor="vendor-store">Target Store Location</Label>
                <Select value={newVendorStoreId} onValueChange={setNewVendorStoreId}>
                  <SelectTrigger id="vendor-store">
                    <SelectValue placeholder="Choose a branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.filter(s => s.id !== "all").map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="vendor-name">Supplier Name</Label>
              <Input
                id="vendor-name"
                placeholder="e.g. Acme Supplies Ltd"
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-contact">Contact Person / Organization / Company (Optional)</Label>
              <Input
                id="vendor-contact"
                placeholder="e.g. John Doe or Acme Ltd."
                value={newVendorContact}
                onChange={(e) => setNewVendorContact(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vendor-email">Email (Optional)</Label>
                <Input
                  id="vendor-email"
                  type="email"
                  placeholder="e.g. acme@example.com"
                  value={newVendorEmail}
                  onChange={(e) => setNewVendorEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vendor-phone">Phone (Optional)</Label>
                <Input
                  id="vendor-phone"
                  placeholder="e.g. +234 80 1234 5678"
                  value={newVendorPhone}
                  onChange={(e) => setNewVendorPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-address">Address (Optional)</Label>
              <Input
                id="vendor-address"
                placeholder="e.g. 12 Industrial Way, Lagos"
                value={newVendorAddress}
                onChange={(e) => setNewVendorAddress(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-notes">Notes (Optional)</Label>
              <Input
                id="vendor-notes"
                placeholder="Preferred categories, lead times, etc."
                value={newVendorNotes}
                onChange={(e) => setNewVendorNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsQuickVendorOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createVendorMutation.mutate()}
                disabled={createVendorMutation.isPending || !newVendorName.trim() || (currentStore?.id === "all" && !newVendorStoreId)}
                className="px-6"
              >
                {createVendorMutation.isPending ? "Adding..." : "Add Supplier"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
