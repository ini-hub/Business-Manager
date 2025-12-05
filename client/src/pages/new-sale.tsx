import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ShoppingCart,
  Minus,
  Plus,
  Trash2,
  Package,
  Wrench,
  Users,
  UserCog,
  CheckCircle,
  Search,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { Link } from "wouter";
import type { Customer, Staff, Inventory } from "@shared/schema";

interface CartItem {
  inventory: Inventory;
  quantity: number;
  totalPrice: number;
}

export default function NewSale() {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: inventory = [], isLoading } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const availableInventory = inventory.filter(
    (item) => item.type === "service" || item.quantity > 0
  );

  const filteredInventory = searchTerm
    ? availableInventory.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : availableInventory;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const addToCart = (item: Inventory) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.inventory.id === item.id);
      if (existing) {
        const maxQty = item.type === "service" ? 999 : item.quantity;
        if (existing.quantity >= maxQty) {
          toast({
            title: "Stock Limit Reached",
            description: `Sorry, only ${maxQty} ${item.name} available right now.`,
            variant: "destructive",
          });
          return prev;
        }
        return prev.map((c) =>
          c.inventory.id === item.id
            ? { ...c, quantity: c.quantity + 1, totalPrice: (c.quantity + 1) * item.sellingPrice }
            : c
        );
      }
      return [...prev, { inventory: item, quantity: 1, totalPrice: item.sellingPrice }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.inventory.id === itemId) {
            const newQty = c.quantity + delta;
            const maxQty = c.inventory.type === "service" ? 999 : c.inventory.quantity;
            if (newQty > maxQty) {
              toast({
                title: "Stock Limit Reached",
                description: `Sorry, only ${maxQty} available right now.`,
                variant: "destructive",
              });
              return c;
            }
            if (newQty <= 0) return null as unknown as CartItem;
            return { ...c, quantity: newQty, totalPrice: newQty * c.inventory.sellingPrice };
          }
          return c;
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.inventory.id !== itemId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const orderData = cart.map((item) => ({
        inventoryId: item.inventory.id,
        quantity: item.quantity,
      }));

      return apiRequest("POST", "/api/sales/checkout", {
        storeId: currentStore?.id,
        customerId: selectedCustomer,
        staffId: selectedStaff,
        items: orderData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", currentStore?.id] });
      toast({ title: "Sale completed successfully!" });
      setCart([]);
      setSelectedCustomer("");
      setSelectedStaff("");
      setLocation("/transactions");
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Complete Sale",
        description: getUserFriendlyError(error, "processing this sale"),
        variant: "destructive",
      });
    },
  });

  const canCheckout = cart.length > 0 && selectedCustomer && selectedStaff;

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="New Sale"
          description="Create a new sales transaction"
        />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to create sales.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Sale"
        description={`Create a new sales transaction for ${currentStore.name}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Select Items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search products and services..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-items"
                />
              </div>
              {isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-4 rounded-lg border animate-pulse">
                      <div className="h-4 w-32 bg-muted rounded mb-2" />
                      <div className="h-3 w-20 bg-muted rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredInventory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {searchTerm ? "No items found" : "No items available for sale"}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredInventory.map((item) => {
                    const inCart = cart.find((c) => c.inventory.id === item.id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                        onClick={() => addToCart(item)}
                        data-testid={`item-${item.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                            {item.type === "product" ? (
                              <Package className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <Wrench className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{item.name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-muted-foreground font-mono">
                                {formatCurrency(item.sellingPrice)}
                              </p>
                              {item.type === "product" && (
                                <span className="text-xs text-muted-foreground">
                                  ({item.quantity} in stock)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {inCart && (
                          <Badge>{inCart.quantity}</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart ({cart.length} items)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ShoppingCart className="h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Your cart is empty
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.inventory.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{item.inventory.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {formatCurrency(item.inventory.sellingPrice)} each
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.inventory.id, -1)}
                            data-testid={`button-decrease-${item.inventory.id}`}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center font-mono text-sm">
                            {item.quantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.inventory.id, 1)}
                            data-testid={`button-increase-${item.inventory.id}`}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromCart(item.inventory.id)}
                            data-testid={`button-remove-${item.inventory.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
            <Separator />
            <CardFooter className="flex justify-between pt-4">
              <span className="font-medium">Total</span>
              <span className="text-xl font-bold font-mono">{formatCurrency(cartTotal)}</span>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Checkout Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users className="h-3 w-3" />
                  Customer
                </Label>
                <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                  <SelectTrigger data-testid="select-customer">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} ({customer.customerNumber})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <UserCog className="h-3 w-3" />
                  Staff Member
                </Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger data-testid="select-staff">
                    <SelectValue placeholder="Select staff" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.name} ({staff.staffNumber})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                disabled={!canCheckout || checkoutMutation.isPending}
                onClick={() => checkoutMutation.mutate()}
                data-testid="button-checkout"
              >
                {checkoutMutation.isPending ? (
                  "Processing..."
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Complete Sale
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
