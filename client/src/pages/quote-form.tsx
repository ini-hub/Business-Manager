import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronLeft, Package, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { ProductGrid } from "@/pages/new-sale/ProductGrid";
import { QuoteItemRow } from "@/pages/quotes/QuoteItemRow";
import type { QuoteCartItem } from "@/pages/quotes/types";
import { cn } from "@/lib/utils";
import type { Customer, Inventory } from "@shared/schema";

export default function QuoteFormPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const storeCurrency = currentStore?.currency || "NGN";

  const [customerId, setCustomerId] = useState<string>("");
  const [quoteRef, setQuoteRef] = useState<string>(`QT-${Date.now().toString().slice(-6)}`);
  const [notes, setNotes] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [quoteCart, setQuoteCart] = useState<QuoteCartItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  // Mobile-only pane switcher — mirrors the POS builder's Products/Cart tab bar.
  const [builderView, setBuilderView] = useState<"items" | "review">("items");

  const { isDisabled } = useEntitlements();
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    queryFn: async () => {
      return fetchAllPages<Customer>(`/api/customers?storeId=${currentStore!.id}`);
    },
    enabled: !isDisabled("customer_management") && !!currentStore?.id,
  });

  // Open to any authenticated staff (unlike /api/products), so quoting stays non-manager-only.
  const { data: inventoryItems = [], isLoading: isLoadingInventory } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      return fetchAllPages<any>(`/api/inventory?storeId=${currentStore!.id}`);
    },
    enabled: !!currentStore?.id,
  });

  const productGroups = inventoryItems
    .filter((inv) => inv.type !== "supply")
    .map((inv) => ({
      id: inv.id,
      name: inv.name,
      type: (inv.type === "service" ? "service" : "product") as "product" | "service",
      variants: [inv],
    }));

  const saveQuoteMutation = useMutation({
    mutationFn: async (status: "draft" | "sent") => {
      if (status !== "draft" && quoteCart.length === 0) throw new Error("At least one item is required.");
      await apiRequest("POST", "/api/quotes", {
        storeId: currentStore!.id,
        customerId: customerId || null,
        quoteRef,
        notes: notes || null,
        validUntil: validUntil || null,
        status,
        items: quoteCart.map((c) => ({
          inventoryId: c.inventory.id,
          quantity: c.quantity,
          unitPrice: c.customPrice,
        })),
      });
      return status;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: status === "draft" ? "Draft saved" : "Quote created", description: status === "draft" ? "You can finish it later from the quotes list." : "Quote proposal created successfully." });
      setLocation("/quotes");
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to save quote.", variant: "destructive" });
    },
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const addToQuoteCart = (item: Inventory) => {
    setQuoteCart((prev) => {
      const existing = prev.find((c) => c.inventory.id === item.id);
      const step = item.allowFractional ? 0.5 : 1;
      if (existing) {
        const newQty = Math.round((existing.quantity + step) * 100) / 100;
        return prev.map((c) =>
          c.inventory.id === item.id
            ? { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 }
            : c
        );
      }
      const initialQty = item.allowFractional ? step : 1;
      const price = Number(item.sellingPrice || item.costPrice || 0);
      return [...prev, {
        inventory: item,
        quantity: initialQty,
        customPrice: price,
        totalPrice: Math.round(initialQty * price * 100) / 100,
      }];
    });
  };

  const updateQuoteQuantity = (itemId: string, delta: number) => {
    setQuoteCart((prev) =>
      prev
        .map((c) => {
          if (c.inventory.id !== itemId) return c;
          const newQty = Math.round((c.quantity + delta) * 10000) / 10000;
          const minQty = c.inventory.allowFractional ? 0.01 : 1;
          if (newQty < minQty) return null as unknown as QuoteCartItem;
          return { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 };
        })
        .filter(Boolean)
    );
  };

  const setQuoteExactQuantity = (itemId: string, newQty: number) => {
    setQuoteCart((prev) =>
      prev.map((c) => {
        if (c.inventory.id !== itemId) return c;
        const minQty = c.inventory.allowFractional ? 0.01 : 1;
        const validQty = Math.max(minQty, newQty);
        return { ...c, quantity: validQty, totalPrice: Math.round(validQty * c.customPrice * 100) / 100 };
      })
    );
  };

  const updateQuoteItemPrice = (itemId: string, newPrice: number) => {
    if (newPrice < 0) return;
    setQuoteCart((prev) =>
      prev.map((c) =>
        c.inventory.id === itemId
          ? { ...c, customPrice: newPrice, totalPrice: Math.round(c.quantity * newPrice * 100) / 100 }
          : c
      )
    );
  };

  const removeFromQuoteCart = (itemId: string) => {
    setQuoteCart((prev) => prev.filter((c) => c.inventory.id !== itemId));
  };

  const quoteTotal = quoteCart.reduce((sum, item) => sum + item.totalPrice, 0);

  if (!currentStore) return <StoreRequiredAlert />;

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="New Quote"
        description="Assemble pricing lists and adjust unit rates. Save as a draft to finish later."
        actions={
          <Button variant="outline" onClick={() => setLocation("/quotes")}>
            <ChevronLeft className="h-4 w-4 lg:mr-1" />
            <span className="hidden lg:inline">Back to Quotes</span>
          </Button>
        }
      />
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    {!isDisabled("customer_management") && (
    <div className="space-y-2">
      <Label htmlFor="customer">Customer Link (Optional)</Label>
      <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Walk-in Customer" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Walk-in / General</SelectItem>
          {customers.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name} ({c.mobileNumber || "No Phone"})</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    )}

    <div className="space-y-2">
      <Label htmlFor="quoteRef">Quote Reference</Label>
      <Input
        id="quoteRef"
        value={quoteRef}
        onChange={(e) => setQuoteRef(e.target.value)}
        placeholder="e.g. QT-1002"
        className="font-mono"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="validUntil">Proposal Validity Expiry</Label>
      <Input
        id="validUntil"
        type="date"
        value={validUntil}
        onChange={(e) => setValidUntil(e.target.value)}
      />
    </div>
  </div>

  <div className="space-y-2">
    <Label>Proposal Line Items</Label>

    {/* Mobile pane switcher — same pattern as the POS builder's Products/Cart tab bar */}
    <div className="flex lg:hidden rounded-lg border bg-muted/40 p-1 gap-1">
      <button
        type="button"
        onClick={() => setBuilderView("items")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors",
          builderView === "items" ? "bg-background shadow-sm text-primary" : "text-muted-foreground"
        )}
      >
        <Package className="h-3.5 w-3.5" /> Items
      </button>
      <button
        type="button"
        onClick={() => setBuilderView("review")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors relative",
          builderView === "review" ? "bg-background shadow-sm text-primary" : "text-muted-foreground"
        )}
      >
        <ShoppingCart className="h-3.5 w-3.5" /> Review
        {quoteCart.length > 0 && (
          <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[11px]">{quoteCart.length}</Badge>
        )}
      </button>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
      <div className={cn(builderView === "items" ? "block" : "hidden lg:block")}>
        <ProductGrid
          products={productGroups}
          isLoading={isLoadingInventory}
          cart={quoteCart}
          searchTerm={productSearch}
          onSearchChange={setProductSearch}
          onAddToCart={addToQuoteCart}
          formatCurrency={formatCurrency}
          allowOutOfStock
        />
      </div>

      <div className={cn(builderView === "review" ? "block" : "hidden lg:block")}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Proposal Items ({quoteCart.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quoteCart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ShoppingCart className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Pick a product or service to add it to the proposal
                </p>
              </div>
            ) : (
              <div id="quote-builder-cart" className="space-y-3">
                {quoteCart.map((item) => (
                  <QuoteItemRow
                    key={item.inventory.id}
                    item={item}
                    formatCurrency={formatCurrency}
                    onUpdateQuantity={updateQuoteQuantity}
                    onSetExactQuantity={setQuoteExactQuantity}
                    onUpdatePrice={updateQuoteItemPrice}
                    onRemove={removeFromQuoteCart}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  </div>

  <div className="space-y-2">
    <Label htmlFor="notes">Terms & Additional Notes (Optional)</Label>
    <Input
      id="notes"
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      placeholder="e.g. Price valid for 14 days. 50% deposit required to confirm transaction."
    />
  </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t bg-background/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:static lg:mx-0 lg:rounded-lg lg:border lg:bg-muted/20 lg:backdrop-blur-none">
        <div>
          <span className="text-sm text-muted-foreground">Proposal Total</span>
          <h2 className="text-lg font-bold font-mono text-primary mt-1">{formatCurrency(quoteTotal)}</h2>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => saveQuoteMutation.mutate("draft")}
            disabled={saveQuoteMutation.isPending}
            className="w-full sm:w-auto"
            data-testid="button-save-quote-draft"
          >
            Save as Draft
          </Button>
          <Button
            onClick={() => saveQuoteMutation.mutate("sent")}
            disabled={saveQuoteMutation.isPending || quoteCart.length === 0}
            className="w-full px-6 sm:w-auto"
            data-testid="button-create-quote"
          >
            Create &amp; Mark Sent
          </Button>
        </div>
      </div>
    </div>
  );
}
