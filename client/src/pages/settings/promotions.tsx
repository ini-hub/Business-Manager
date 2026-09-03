import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Gift, Sparkles, AlertCircle, RefreshCw, Percent, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency } from "@/lib/currency-utils";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import type { Promotion, Inventory } from "@shared/schema";

export default function PromotionsPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [promoType, setPromoType] = useState<"buy_x_get_y" | "spend_x_get_y">("buy_x_get_y");
  
  // Form State
  const [name, setName] = useState("");
  const [buyItemId, setBuyItemId] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("1");
  const [getItemId, setGetItemId] = useState("");
  const [getQuantity, setGetQuantity] = useState("1");
  const [spendAmount, setSpendAmount] = useState("");

  // Fetch Promotions
  const { data: promotionsList = [], isLoading: promoLoading } = useQuery<Promotion[]>({
    queryKey: ["/api/promotions", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/promotions?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Fetch Inventory (for selectors)
  const { data: inventoryList = [], isLoading: inventoryLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Create Promotion Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return apiRequest("POST", "/api/promotions", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions", currentStore?.id] });
      toast({ title: "Promotion created successfully" });
      setIsOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create promotion",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Toggle Active Status Mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/promotions/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions", currentStore?.id] });
      toast({ title: "Promotion status updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update promotion",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete Promotion Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/promotions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/promotions", currentStore?.id] });
      toast({ title: "Promotion deleted successfully" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to delete promotion",
        description: err.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setBuyItemId("");
    setBuyQuantity("1");
    setGetItemId("");
    setGetQuantity("1");
    setSpendAmount("");
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }

    const payload: any = {
      storeId: currentStore?.id,
      name: name.trim(),
      type: promoType,
      isActive: true,
    };

    if (promoType === "buy_x_get_y") {
      if (!buyItemId || !getItemId) {
        toast({ title: "Please select both items", variant: "destructive" });
        return;
      }
      payload.buyItemId = buyItemId;
      payload.buyQuantity = parseInt(buyQuantity) || 1;
      payload.getItemId = getItemId;
      payload.getQuantity = parseInt(getQuantity) || 1;
    } else {
      if (!spendAmount || parseFloat(spendAmount) <= 0 || !getItemId) {
        toast({ title: "Please configure spend amount and reward item", variant: "destructive" });
        return;
      }
      payload.spendAmount = parseFloat(spendAmount);
      payload.getItemId = getItemId;
      payload.getQuantity = parseInt(getQuantity) || 1;
    }

    createMutation.mutate(payload);
  };

  const getInventoryItemName = (id: string | null) => {
    if (!id) return "Unknown Item";
    const found = inventoryList.find(i => i.id === id);
    return found ? found.name : "Unknown Item";
  };

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Promotions Management"
          description="Configure Buy X Get Y and Spend X Get Y discounts for automated application at POS checkout."
          actions={<BackToSettingsButton />}
        />
        <StoreRequiredAlert title="Store Required for Promotions" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotions Management"
        description="Configure Buy X Get Y and Spend X Get Y discounts for automated application at POS checkout."
        actions={
          <>
            <BackToSettingsButton />
            <Button onClick={() => { resetForm(); setIsOpen(true); }} className="hover-elevate shadow-md flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Promotion
            </Button>
          </>
        }
      />

      {promoLoading || inventoryLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : promotionsList.length === 0 ? (
        <Card className="border-dashed flex flex-col items-center justify-center p-12 text-center bg-card/50 backdrop-blur-sm">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary animate-pulse">
            <Sparkles className="h-8 w-8" />
          </div>
          <CardTitle className="mb-2 text-lg">No active promotions</CardTitle>
          <CardDescription className="max-w-sm mb-6">
            Get started by creating your first discount rule. Promotions will automatically apply when customer carts match qualification criteria.
          </CardDescription>
          <Button onClick={() => setIsOpen(true)} variant="outline">
            Create First Promotion
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {promotionsList.map((promo) => (
            <Card 
              key={promo.id} 
              className={`hover-elevate overflow-hidden border bg-gradient-to-b from-card to-card/95 relative transition-all duration-300 ${
                promo.isActive ? "shadow-md shadow-primary/5" : "opacity-75"
              }`}
            >
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {promo.type === "buy_x_get_y" ? (
                        <>
                          <Percent className="h-3 w-3" />
                          Buy X Get Y
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3" />
                          Spend X Get Y
                        </>
                      )}
                    </span>
                    <h3 className="font-bold text-lg text-foreground truncate max-w-[200px]" title={promo.name}>
                      {promo.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={promo.isActive}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: promo.id, isActive: checked })}
                      disabled={toggleMutation.isPending}
                    />
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this promotion?")) {
                          deleteMutation.mutate(promo.id);
                        }
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg bg-muted/50 p-4 border space-y-2">
                  {promo.type === "buy_x_get_y" ? (
                    <div className="flex flex-col gap-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-muted-foreground">Buy:</span>
                        <span className="font-medium text-foreground">
                          {promo.buyQuantity} × {getInventoryItemName(promo.buyItemId)}
                        </span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground self-center my-0.5" />
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">Get Free:</span>
                        <span className="font-bold text-primary">
                          {promo.getQuantity} × {getInventoryItemName(promo.getItemId)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-muted-foreground">Spend:</span>
                        <span className="font-bold text-foreground">
                          {formatCurrency(promo.spendAmount || 0)}
                        </span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground self-center my-0.5" />
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-primary">Get Free:</span>
                        <span className="font-bold text-primary">
                          {promo.getQuantity} × {getInventoryItemName(promo.getItemId)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Promotion</DialogTitle>
            <DialogDescription>Configure details for automated checkout discount applications.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-name">Promotion Label / Campaign Name</Label>
              <Input
                id="promo-name"
                placeholder="e.g. Easter Special BOGO"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promo-type">Promotion Strategy Type</Label>
              <Select value={promoType} onValueChange={(val: any) => setPromoType(val)}>
                <SelectTrigger id="promo-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy_x_get_y">Buy X Get Y (BOGO / Multi-buy)</SelectItem>
                  <SelectItem value="spend_x_get_y">Spend X Get Y (Basket Threshold)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {promoType === "buy_x_get_y" ? (
              <>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="buy-item">When Customer Buys</Label>
                    <Select value={buyItemId} onValueChange={setBuyItemId}>
                      <SelectTrigger id="buy-item">
                        <SelectValue placeholder="Choose item" />
                      </SelectTrigger>
                      <SelectContent>
                        {inventoryList.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="buy-qty">Quantity</Label>
                    <Input
                      id="buy-qty"
                      type="number"
                      min="1"
                      value={buyQuantity}
                      onChange={(e) => setBuyQuantity(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="get-item">They Get For Free</Label>
                    <Select value={getItemId} onValueChange={setGetItemId}>
                      <SelectTrigger id="get-item">
                        <SelectValue placeholder="Choose reward item" />
                      </SelectTrigger>
                      <SelectContent>
                        {inventoryList.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="get-qty">Reward Qty</Label>
                    <Input
                      id="get-qty"
                      type="number"
                      min="1"
                      value={getQuantity}
                      onChange={(e) => setGetQuantity(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="spend-amount">When Basket Total Is At Least (₦)</Label>
                  <Input
                    id="spend-amount"
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="10000.00"
                    value={spendAmount}
                    onChange={(e) => setSpendAmount(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="get-item">They Get For Free</Label>
                    <Select value={getItemId} onValueChange={setGetItemId}>
                      <SelectTrigger id="get-item">
                        <SelectValue placeholder="Choose reward item" />
                      </SelectTrigger>
                      <SelectContent>
                        {inventoryList.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="get-qty">Reward Qty</Label>
                    <Input
                      id="get-qty"
                      type="number"
                      min="1"
                      value={getQuantity}
                      onChange={(e) => setGetQuantity(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Promotion"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
