import { useState, useEffect } from "react";
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
  ChevronsUpDown,
  Check,
  Banknote,
  CreditCard,
  Link2,
  Gift,
  Sparkles,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { ReceiptModal } from "@/components/receipt-modal";
import type { Customer, Staff, Inventory, InsertCustomer } from "@shared/schema";
import { insertCustomerSchema } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { saveOfflineCheckout } from "@/lib/offline-db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";


const newCustomerSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
});

interface CartItem {
  inventory: Inventory;
  quantity: number;
  customPrice: number; // Allow negotiable pricing
  totalPrice: number;
  // Per-item staff assignment (services only)
  leadStaffId?: string | null;
  assistingStaff1Id?: string | null;
  assistingStaff2Id?: string | null;
  commissionSplit: "standard" | "equal";
  showAsst1?: boolean; // UI toggle
  showAsst2?: boolean; // UI toggle
}

export default function NewSale() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "flutterwave" | "credit" | "split">("cash");
  const [splitPayments, setSplitPayments] = useState<Array<{method: "cash" | "transfer" | "credit", amount: number}>>([
    { method: "cash", amount: 0 },
    { method: "transfer", amount: 0 }
  ]);
  const [creditUpfrontPaid, setCreditUpfrontPaid] = useState<number>(0);

  const updateSplitPayment = (index: number, field: "method" | "amount", value: string | number) => {
    const newSplits = [...splitPayments];
    newSplits[index] = { ...newSplits[index], [field]: value };
    setSplitPayments(newSplits);
  };

  const removeSplitPayment = (index: number) => {
    const newSplits = [...splitPayments];
    newSplits.splice(index, 1);
    setSplitPayments(newSplits);
  };
  const [creditDueDate, setCreditDueDate] = useState<string>("");
  const [newCustomerDialogOpen, setNewCustomerDialogOpen] = useState(false);
  const [receiptCheckoutId, setReceiptCheckoutId] = useState<string | null>(null);
  
  const searchParams = new URLSearchParams(window.location.search);
  const bookingId = searchParams.get("bookingId");

  const { data: bookingDetails } = useQuery<any>({
    queryKey: ["/api/bookings", bookingId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/bookings/${bookingId}`);
      if (!res.ok) throw new Error("Failed to fetch booking details");
      return res.json();
    },
    enabled: !!bookingId,
  });

  // Discount Module Version 1.2 Option B states
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string>("");
  const [applyDiscount, setApplyDiscount] = useState<boolean>(false);
  const [discountApprovedBy, setDiscountApprovedBy] = useState<string>("");

  const [supervisorEmail, setSupervisorEmail] = useState<string>("");
  const [supervisorPassword, setSupervisorPassword] = useState<string>("");
  const [supervisorOverrideOpen, setSupervisorOverrideOpen] = useState<boolean>(false);
  const [isAuthorizingSupervisor, setIsAuthorizingSupervisor] = useState<boolean>(false);
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [isDateModified, setIsDateModified] = useState<boolean>(false);

  const customerForm = useForm<InsertCustomer>({
    resolver: zodResolver(newCustomerSchema),
    defaultValues: {
      storeId: currentStore?.id || "",
      name: "",
      countryCode: "NG",
      mobileNumber: "",
      address: "",
      customerNumber: "",
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: InsertCustomer) => {
      const response = await apiRequest("POST", "/api/customers", { ...data, storeId: currentStore?.id });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Customer created successfully" });
      setSelectedCustomer(data.id);
      setNewCustomerDialogOpen(false);
      customerForm.reset();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Couldn't Add Customer", 
        description: getUserFriendlyError(error, "customer"), 
        variant: "destructive" 
      });
    },
  });

  const onCustomerSubmit = (data: InsertCustomer) => {
    createCustomerMutation.mutate(data);
  };

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

  const { data: promotionsList = [] } = useQuery<any[]>({
    queryKey: ["/api/promotions", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/promotions?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const availableInventory = inventory.filter(
    (item) => item.type === "service" || item.quantity > 0
  );

  useEffect(() => {
    if (bookingDetails && inventory.length > 0 && cart.length === 0) {
      if (bookingDetails.customerId) setSelectedCustomer(bookingDetails.customerId);
      if (bookingDetails.leadStaffId) setSelectedStaff(bookingDetails.leadStaffId);
      
      if (bookingDetails.discountAmount > 0) {
        setApplyDiscount(true);
        setDiscountAmount(bookingDetails.discountAmount);
        setDiscountPercent(bookingDetails.discountPercent || 0);
        setDiscountReason(bookingDetails.discountReason || "");
        
        if (bookingDetails.discountApprovedBy) {
          setDiscountApprovedBy(bookingDetails.discountApprovedBy);
        } else {
          const pct = bookingDetails.discountPercent || 0;
          const requiresOverride = user?.role === "staff" || (user?.role === "manager" && pct > 20);
          if (!requiresOverride) {
            const displayName = user?.name || user?.email || "Owner";
            setDiscountApprovedBy(`${displayName} (${user?.role})`);
          } else {
            setDiscountApprovedBy("");
          }
        }
      }
      
      if (bookingDetails.items && bookingDetails.items.length > 0) {
        const newCart: CartItem[] = bookingDetails.items.map((item: any) => {
          const inv = inventory.find(i => i.id === item.inventoryId);
          if (!inv) return null;
          return {
            inventory: inv,
            quantity: item.quantity,
            customPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            leadStaffId: bookingDetails.leadStaffId || null,
            assistingStaff1Id: null,
            assistingStaff2Id: null,
            commissionSplit: "standard",
            showAsst1: false,
            showAsst2: false,
          };
        }).filter(Boolean) as CartItem[];
        setCart(newCart);
      }
    }
  }, [bookingDetails, inventory]);

  useEffect(() => {
    if (bookingDetails?.status === "completed") {
      toast({
        title: "Booking Already Completed",
        description: "This booking has already been converted to a sale.",
        variant: "destructive",
      });
      setLocation(`/bookings/${bookingDetails.id}`);
    }
  }, [bookingDetails, setLocation, toast]);

  const filteredInventory = searchTerm
    ? availableInventory.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : availableInventory;

  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
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
            ? { ...c, quantity: c.quantity + 1, totalPrice: (c.quantity + 1) * c.customPrice }
            : c
        );
      }
      return [...prev, { 
        inventory: item, 
        quantity: 1, 
        customPrice: item.sellingPrice, 
        totalPrice: item.sellingPrice,
        leadStaffId: null,
        assistingStaff1Id: null,
        assistingStaff2Id: null,
        commissionSplit: "standard",
        showAsst1: false,
        showAsst2: false,
      }];
    });
  };

  const updateStaffAssignment = (itemId: string, field: keyof CartItem, value: string | null | boolean) => {
    setCart((prev) => prev.map(c => {
      if (c.inventory.id === itemId) {
        const updated = { ...c, [field]: value };
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
      return c;
    }));
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
            return { ...c, quantity: newQty, totalPrice: newQty * c.customPrice };
          }
          return c;
        })
        .filter(Boolean)
    );
  };

  const setExactQuantity = (itemId: string, newQty: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.inventory.id === itemId) {
            const maxQty = c.inventory.type === "service" ? 999 : c.inventory.quantity;
            const validQty = Math.max(1, Math.min(newQty, maxQty));
            if (newQty > maxQty) {
              toast({
                title: "Stock Limit Reached",
                description: `Sorry, only ${maxQty} available right now.`,
                variant: "destructive",
              });
            }
            return { ...c, quantity: validQty, totalPrice: validQty * c.customPrice };
          }
          return c;
        })
    );
  };

  const updateCustomPrice = (itemId: string, newPrice: number) => {
    if (newPrice < 0) return;
    setCart((prev) =>
      prev.map((c) => {
        if (c.inventory.id === itemId) {
          return { ...c, customPrice: newPrice, totalPrice: c.quantity * newPrice };
        }
        return c;
      })
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.inventory.id !== itemId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  // Compute promotions automatically on the client-side cart
  const activePromos = promotionsList.filter(p => p.isActive);
  
  const appliedPromos: Array<{ name: string; type: string; description: string }> = [];
  const freeItemsPreview: Array<{ name: string; quantity: number }> = [];
  let promoDiscount = 0;

  // 1. Buy X Get Y (Same Item)
  activePromos.forEach(promo => {
    if (promo.type === "buy_x_get_y" && promo.buyItemId === promo.getItemId && promo.buyItemId) {
      const cartItem = cart.find(c => c.inventory.id === promo.buyItemId);
      if (cartItem) {
        const buyQty = promo.buyQuantity || 1;
        const getQty = promo.getQuantity || 1;
        const cycle = buyQty + getQty;
        if (cartItem.quantity >= cycle) {
          const times = Math.floor(cartItem.quantity / cycle);
          const freeQty = times * getQty;
          promoDiscount += freeQty * cartItem.customPrice;
          appliedPromos.push({
            name: promo.name,
            type: "buy_x_get_y",
            description: `Buy ${buyQty} get ${getQty} free (Deducted ${freeQty} × free item(s) value)`
          });
          freeItemsPreview.push({
            name: cartItem.inventory.name,
            quantity: freeQty
          });
        }
      }
    }
  });

  // 2. Buy X Get Y (Different Item)
  activePromos.forEach(promo => {
    if (promo.type === "buy_x_get_y" && promo.buyItemId !== promo.getItemId && promo.buyItemId && promo.getItemId) {
      const cartItem = cart.find(c => c.inventory.id === promo.buyItemId);
      if (cartItem && cartItem.quantity >= (promo.buyQuantity || 1)) {
        const times = Math.floor(cartItem.quantity / (promo.buyQuantity || 1));
        const freeQty = times * (promo.getQuantity || 1);
        const rewardItem = inventory.find(i => i.id === promo.getItemId);
        if (rewardItem) {
          appliedPromos.push({
            name: promo.name,
            type: "buy_x_get_y",
            description: `Buy ${promo.buyQuantity} of ${cartItem.inventory.name} get ${freeQty} of ${rewardItem.name} free!`
          });
          freeItemsPreview.push({
            name: rewardItem.name,
            quantity: freeQty
          });
        }
      }
    }
  });

  // 3. Spend X Get Y Free
  activePromos.forEach(promo => {
    if (promo.type === "spend_x_get_y" && promo.spendAmount && promo.getItemId) {
      const remainingTotal = Math.max(0, cartTotal - promoDiscount);
      if (remainingTotal >= promo.spendAmount) {
        const rewardItem = inventory.find(i => i.id === promo.getItemId);
        if (rewardItem) {
          appliedPromos.push({
            name: promo.name,
            type: "spend_x_get_y",
            description: `Spend threshold of ₦${promo.spendAmount.toLocaleString()} reached. Get ${promo.getQuantity || 1} × ${rewardItem.name} free!`
          });
          freeItemsPreview.push({
            name: rewardItem.name,
            quantity: promo.getQuantity || 1
          });
        }
      }
    }
  });

  const finalCartTotal = Math.max(0, cartTotal - promoDiscount);
  const bookingDepositAmount = bookingDetails?.depositAmount || 0;
  const bookingDepositMethod = bookingDetails?.depositPaymentMethod || "";
  const totalCharged = Math.max(0, finalCartTotal - discountAmount);
  const balanceCollectedToday = Math.max(0, totalCharged - bookingDepositAmount);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const orderData = cart.map((item) => ({
        inventoryId: item.inventory.id,
        quantity: item.quantity,
        customPrice: item.customPrice,
        // Only pass staff assignment for service items
        leadStaffId: item.inventory.type === "service" ? (item.leadStaffId || null) : null,
        assistingStaff1Id: item.inventory.type === "service" ? (item.assistingStaff1Id || null) : null,
        assistingStaff2Id: item.inventory.type === "service" ? (item.assistingStaff2Id || null) : null,
        commissionSplit: item.commissionSplit,
      }));

      // Re-read booking deposit values fresh inside the mutation to avoid stale closure
      const freshDepositAmount = Number(bookingDetails?.depositAmount ?? 0);
      const freshDepositMethod = bookingDetails?.depositPaymentMethod ?? "";
      const freshCartSubtotal = cart.reduce((sum, item) => sum + (item.customPrice * item.quantity), 0);
      const freshPromoDiscount = promoDiscount;
      const freshFinalTotal = Math.max(0, freshCartSubtotal - freshPromoDiscount);
      const freshTotalCharged = Math.max(0, freshFinalTotal - (discountAmount || 0));
      const freshBalance = Math.max(0, freshTotalCharged - freshDepositAmount);

      const checkoutPayload = {
        storeId: currentStore?.id,
        bookingId: bookingId || undefined,
        customerId: selectedCustomer || null,
        staffId: selectedStaff,
        items: orderData,
        paymentMethod: freshBalance === 0 && freshDepositAmount > 0 ? "deposit" : paymentMethod,
        discountAmount: discountAmount || undefined,
        discountPercent: discountPercent || undefined,
        discountReason: discountReason || undefined,
        discountApprovedBy: discountApprovedBy || undefined,
        effectiveDate: isDateModified ? effectiveDate : undefined,
        creditUpfrontPaid: paymentMethod === "credit" ? creditUpfrontPaid : undefined,
        creditDueDate: paymentMethod === "credit" ? (creditDueDate || undefined) : undefined,
        splitPayments: paymentMethod === "split" ? splitPayments.filter(s => s.amount > 0) : undefined,
        bookingDepositAmount: freshDepositAmount > 0 ? freshDepositAmount : undefined,
        bookingDepositMethod: freshDepositMethod || undefined,
        balanceCollectedToday: freshBalance,
      };

      if (!navigator.onLine) {
        await saveOfflineCheckout(checkoutPayload, currentStore!.id);
        return { offline: true };
      }

      try {
        const response = await apiRequest("POST", "/api/sales/checkout", checkoutPayload);
        return response.json();
      } catch (error) {
        const isNetworkError = error instanceof TypeError || 
          (error as any).message?.toLowerCase().includes("failed to fetch") ||
          (error as any).message?.toLowerCase().includes("networkerror") ||
          (error as any).status === 503 ||
          (error as any).status === 504;
        if (isNetworkError) {
          await saveOfflineCheckout(checkoutPayload, currentStore!.id);
          return { offline: true };
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      if (data.offline) {
        toast({
          title: "Checkout Queued Offline!",
          description: "No network connection. The sale has been saved locally and will sync when you are back online.",
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/profit-loss", currentStore?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", currentStore?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        toast({ title: "Sale completed successfully!" });
      }

      setCart([]);
      setSelectedCustomer("");
      setSelectedStaff("");
      setPaymentMethod("cash");
      setApplyDiscount(false);
      setDiscountAmount(0);
      setDiscountPercent(0);
      setDiscountReason("");
      setDiscountApprovedBy("");
      setCreditUpfrontPaid(0);
      setCreditDueDate("");
      setEffectiveDate(new Date().toISOString().split("T")[0]);
      setIsDateModified(false);
      
      // Open receipt modal only for physical online checkouts
      if (!data.offline && data.checkoutIds && data.checkoutIds.length > 0) {
        setReceiptCheckoutId(data.checkoutIds[0]);
      }
    },
    onError: (error: Error) => {
      const isZeroPriceError = error.message?.toLowerCase().includes("cannot be sold for ₦0") || 
                              error.message?.toLowerCase().includes("only active promotions can apply");
      toast({
        title: isZeroPriceError ? "Invalid Item Price" : "Couldn't Complete Sale",
        description: isZeroPriceError 
          ? "Items cannot be priced at ₦0 during checkout unless covered by an active promotion." 
          : getUserFriendlyError(error, "processing this sale"),
        variant: "destructive",
      });
    },
  });

  // Block checkout if any service item has no lead staff assigned
  const serviceItemsMissingLead = cart.filter(c => c.inventory.type === "service" && !c.leadStaffId);
  
  // When fully covered by deposit, skip payment method validation entirely
  const isFullyCoveredByDeposit = balanceCollectedToday === 0 && bookingDepositAmount > 0;
  
  const splitTotal = splitPayments.reduce((s, p) => s + p.amount, 0);
  const splitIsValid = Math.abs(splitTotal - balanceCollectedToday) < 0.01 && splitPayments.filter(s => s.amount > 0).length > 0;
  
  const canCheckout = 
    cart.length > 0 && 
    selectedCustomer && 
    selectedStaff && 
    serviceItemsMissingLead.length === 0 &&
    (discountAmount === 0 || (discountReason !== "" && discountApprovedBy !== "")) &&
    (isFullyCoveredByDeposit || paymentMethod !== "split" || splitIsValid);

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="New Sale"
          description="Create a new sales transaction"
        />
        <StoreRequiredAlert title="Store Required for POS" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Sale"
        description={`Create a new sales transaction for ${currentStore.name}`}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
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

        <div id="pos-cart-section" className="space-y-6">
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
                        className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50"
                      >
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
                            onClick={() => removeFromCart(item.inventory.id)}
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
                                let cleanVal = val;
                                if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                updateCustomPrice(item.inventory.id, cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                              }}
                              className="h-7 w-20 font-mono text-sm"
                              data-testid={`input-price-${item.inventory.id}`}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.inventory.id, -1)}
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
                                if (val === "") {
                                  // Temporary empty state handled by a local override or just forcing it to 1 is better?
                                  // For simplicity, we can let the input be empty but don't commit it to state until parsed.
                                  // Wait, if it's controlled by item.quantity, we can't type an empty string. 
                                  // Let's use parseInt(val) or 1
                                  setExactQuantity(item.inventory.id, 1);
                                } else {
                                  setExactQuantity(item.inventory.id, parseInt(val) || 1);
                                }
                              }}
                              className="h-7 w-14 text-center font-mono text-sm px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              data-testid={`input-quantity-${item.inventory.id}`}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.inventory.id, 1)}
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
                        {/* Staff assignment for service items */}
                        {item.inventory.type === "service" && (
                          <div className="mt-2 pt-2 border-t border-muted space-y-2">
                            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <UserCog className="h-3 w-3" />
                              Staff Assignment
                            </p>
                            {/* Lead staff */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-16 shrink-0">Lead *</span>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className={`flex-1 justify-between font-normal h-7 text-xs ${!item.leadStaffId ? "border-destructive/50" : ""}`}>
                                    {item.leadStaffId ? staffList.find(s => s.id === item.leadStaffId)?.name : "Select lead…"}
                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-52 p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search staff…" />
                                    <CommandList>
                                      <CommandEmpty>Not found</CommandEmpty>
                                      <CommandGroup>
                                        {staffList.filter(s => !s.isArchived).map(s => (
                                          <CommandItem key={s.id} value={s.name} onSelect={() => updateStaffAssignment(item.inventory.id, "leadStaffId", s.id)}>
                                            <Check className={cn("mr-2 h-3 w-3", item.leadStaffId === s.id ? "opacity-100" : "opacity-0")} />
                                            {s.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>

                            {/* Assisting staff 1 */}
                            {item.showAsst1 ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #1</span>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="flex-1 justify-between font-normal h-7 text-xs">
                                      {item.assistingStaff1Id ? staffList.find(s => s.id === item.assistingStaff1Id)?.name : "Select…"}
                                      <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-52 p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Search staff…" />
                                      <CommandList>
                                        <CommandEmpty>Not found</CommandEmpty>
                                        <CommandGroup>
                                          {staffList.filter(s => !s.isArchived && s.id !== item.leadStaffId).map(s => (
                                            <CommandItem key={s.id} value={s.name} onSelect={() => {
                                              updateStaffAssignment(item.inventory.id, "assistingStaff1Id", s.id);
                                            }}>
                                              <Check className={cn("mr-2 h-3 w-3", item.assistingStaff1Id === s.id ? "opacity-100" : "opacity-0")} />
                                              {s.name}
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                {item.assistingStaff1Id && !item.showAsst2 && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => updateStaffAssignment(item.inventory.id, "showAsst2", true)}>
                                    +Asst
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => updateStaffAssignment(item.inventory.id, "showAsst1", true)}>
                                + Add Assisting Staff
                              </Button>
                            )}

                            {/* Assisting staff 2 */}
                            {item.showAsst2 && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Asst. #2</span>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="flex-1 justify-between font-normal h-7 text-xs">
                                      {item.assistingStaff2Id ? staffList.find(s => s.id === item.assistingStaff2Id)?.name : "Select…"}
                                      <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-52 p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Search staff…" />
                                      <CommandList>
                                        <CommandEmpty>Not found</CommandEmpty>
                                        <CommandGroup>
                                          {staffList.filter(s => !s.isArchived && s.id !== item.leadStaffId && s.id !== item.assistingStaff1Id).map(s => (
                                            <CommandItem key={s.id} value={s.name} onSelect={() => updateStaffAssignment(item.inventory.id, "assistingStaff2Id", s.id)}>
                                              <Check className={cn("mr-2 h-3 w-3", item.assistingStaff2Id === s.id ? "opacity-100" : "opacity-0")} />
                                              {s.name}
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            )}

                            {/* Commission Split Override (only if assistants exist) */}
                            {(item.assistingStaff1Id || item.assistingStaff2Id) && (
                              <div className="pt-1 flex flex-col gap-1">
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-tight">Commission Split</p>
                                <RadioGroup 
                                  value={item.commissionSplit} 
                                  onValueChange={(v) => updateStaffAssignment(item.inventory.id, "commissionSplit", v)}
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
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
            <Separator />
            <CardFooter className="flex flex-col gap-4 pt-4">
              {/* Applied Promotions Indicator */}
              {appliedPromos.length > 0 && (
                <div className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 rounded-lg p-3 text-xs space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Gift className="h-4 w-4 text-emerald-500 animate-bounce" />
                    Applied Promotions ({appliedPromos.length})
                  </p>
                  <ul className="list-disc list-inside space-y-1 pl-1">
                    {appliedPromos.map((p, idx) => (
                      <li key={idx} className="leading-tight">
                        <span className="font-medium">{p.name}:</span> {p.description}
                      </li>
                    ))}
                  </ul>
                  {freeItemsPreview.length > 0 && (
                    <div className="mt-1 pt-1.5 border-t border-emerald-500/20 font-semibold text-[11px] text-emerald-600 dark:text-emerald-400">
                      Reward Free Item(s) to hand over: {freeItemsPreview.map(f => `${f.quantity} × ${f.name}`).join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="w-full flex justify-between items-center text-sm font-medium">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatCurrency(cartTotal)}</span>
              </div>

              {promoDiscount > 0 && (
                <div className="w-full flex justify-between items-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    Promotional Savings
                  </span>
                  <span className="font-mono">- {formatCurrency(promoDiscount)}</span>
                </div>
              )}

              {/* Standalone Option B Discount Panel */}
              <div className="w-full border border-primary/10 rounded-lg p-3.5 bg-primary/5 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-tight text-primary flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                    Transaction Discount
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="apply-discount-toggle" className="text-xs font-medium cursor-pointer">
                      Apply Discount?
                    </Label>
                    <Switch
                      id="apply-discount-toggle"
                      checked={applyDiscount}
                      onCheckedChange={(checked) => {
                        setApplyDiscount(checked);
                        if (!checked) {
                          setDiscountAmount(0);
                          setDiscountPercent(0);
                          setDiscountReason("");
                          setDiscountApprovedBy("");
                        }
                      }}
                    />
                  </div>
                </div>

                {applyDiscount && (
                  <div className="space-y-3 pt-2 border-t border-primary/10">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground uppercase font-medium">Amount Off</Label>
                        <Input
                          type="number"
                          min={0}
                          max={finalCartTotal}
                          className="h-8 font-mono text-xs"
                          placeholder="0.00"
                          value={discountAmount === 0 ? "0" : discountAmount || ""}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            let cleanValStr = valStr;
                            if (/^0\d+/.test(valStr)) cleanValStr = valStr.replace(/^0+/, '');
                            const val = parseFloat(cleanValStr);
                            if (isNaN(val) || val <= 0) {
                              setDiscountAmount(0);
                              setDiscountPercent(0);
                              setDiscountApprovedBy("");
                              return;
                            }
                            const amt = Math.min(finalCartTotal, Math.max(0, val));
                            setDiscountAmount(amt);
                            const pct = finalCartTotal > 0 ? (amt / finalCartTotal) * 100 : 0;
                            setDiscountPercent(pct);
                            
                            // Check if authorization is required
                            const requiresOverride = 
                              user?.role === "staff" || 
                              (user?.role === "manager" && pct > 20);
                            if (requiresOverride) {
                              setSupervisorOverrideOpen(true);
                            } else {
                              const displayName = user?.name || user?.email || "Owner";
                              setDiscountApprovedBy(`${displayName} (${user?.role})`);
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground uppercase font-medium">Target Total</Label>
                        <Input
                          type="number"
                          min={0}
                          max={finalCartTotal}
                          className="h-8 font-mono text-xs"
                          placeholder={finalCartTotal ? (finalCartTotal - discountAmount).toFixed(2) : "0.00"}
                          value={discountAmount > 0 ? (finalCartTotal - discountAmount).toFixed(2) : ""}
                          onChange={(e) => {
                            const valStr = e.target.value;
                            let cleanValStr = valStr;
                            if (/^0\d+/.test(valStr)) cleanValStr = valStr.replace(/^0+/, '');
                            const val = parseFloat(cleanValStr);
                            if (isNaN(val) || val >= finalCartTotal) {
                              setDiscountAmount(0);
                              setDiscountPercent(0);
                              setDiscountApprovedBy("");
                              return;
                            }
                            const target = Math.max(0, val);
                            const amt = Math.max(0, finalCartTotal - target);
                            setDiscountAmount(amt);
                            const pct = finalCartTotal > 0 ? (amt / finalCartTotal) * 100 : 0;
                            setDiscountPercent(pct);

                            // Check if authorization is required
                            const requiresOverride = 
                              user?.role === "staff" || 
                              (user?.role === "manager" && pct > 20);
                            if (requiresOverride) {
                              setSupervisorOverrideOpen(true);
                            } else {
                              const displayName = user?.name || user?.email || "Owner";
                              setDiscountApprovedBy(`${displayName} (${user?.role})`);
                            }
                          }}
                        />
                      </div>
                    </div>

                    {discountAmount > 0 && (
                      <div className="space-y-2 pt-1 border-t border-primary/10">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground uppercase font-medium">Reason for Discount <span className="text-red-500">*</span></Label>
                          <select
                            className="w-full h-8 px-2 rounded-md border bg-background text-xs"
                            value={discountReason}
                            onChange={(e) => setDiscountReason(e.target.value)}
                            required
                          >
                            <option value="">Select a reason...</option>
                            <option value="Negotiated">Negotiated</option>
                            <option value="Loyalty">Loyalty</option>
                            <option value="Promo">Promo</option>
                            <option value="Error Correction">Error Correction</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div className="flex justify-between items-center text-[10px] bg-background p-2 rounded border border-primary/10">
                          <span className="text-muted-foreground">Approved By:</span>
                          <span className="font-semibold text-primary font-mono truncate max-w-[150px]" title={discountApprovedBy}>
                            {discountApprovedBy || "Pending Override..."}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="w-full space-y-2 pt-2 border-t">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm text-foreground">Total Value</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrency(totalCharged)}
                  </span>
                </div>
                
                {bookingDepositAmount > 0 && (
                  <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                    <span className="font-medium text-sm">Booking Deposit Paid</span>
                    <span className="font-mono text-sm">- {formatCurrency(bookingDepositAmount)}</span>
                  </div>
                )}
                
                <div className="flex justify-between items-center pt-2 border-t border-primary/20">
                  <span className="font-bold text-base text-primary uppercase tracking-tight">Total Remaining</span>
                  <span className="text-2xl font-bold font-mono text-emerald-600">
                    {formatCurrency(balanceCollectedToday)}
                  </span>
                </div>
              </div>
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
                <div className="flex items-center gap-2">
                  <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerOpen}
                        className="flex-1 justify-between font-normal"
                        data-testid="select-customer"
                        disabled={!!bookingId}
                      >
                        {selectedCustomer
                          ? customers.find((c) => c.id === selectedCustomer)?.name
                          : "Search customers..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name or ID..." data-testid="input-search-customer" />
                      <CommandList>
                        <CommandEmpty>No customer found.</CommandEmpty>
                        <CommandGroup>
                          {customers.filter(c => !c.isArchived).map((customer) => (
                            <CommandItem
                              key={customer.id}
                              value={`${customer.name} ${customer.customerNumber} ${customer.mobileNumber || ''}`}
                              onSelect={() => {
                                setSelectedCustomer(customer.id);
                                setCustomerOpen(false);
                              }}
                              data-testid={`customer-option-${customer.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedCustomer === customer.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{customer.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {customer.customerNumber} {customer.mobileNumber ? `• ${customer.mobileNumber}` : ''}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                  {!bookingId && (
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => setNewCustomerDialogOpen(true)}
                      title="Add New Customer"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <UserCog className="h-3 w-3" />
                  Staff Member
                </Label>
                <Popover open={staffOpen} onOpenChange={setStaffOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={staffOpen}
                      className="w-full justify-between font-normal"
                      data-testid="select-staff"
                    >
                      {selectedStaff
                        ? staffList.find((s) => s.id === selectedStaff)?.name
                        : "Search staff..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name or ID..." data-testid="input-search-staff" />
                      <CommandList>
                        <CommandEmpty>No staff found.</CommandEmpty>
                        <CommandGroup>
                          {staffList.filter(s => !s.isArchived).map((staff) => (
                            <CommandItem
                              key={staff.id}
                              value={`${staff.name} ${staff.staffNumber}`}
                              onSelect={() => {
                                setSelectedStaff(staff.id);
                                setStaffOpen(false);
                              }}
                              data-testid={`staff-option-${staff.id}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedStaff === staff.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{staff.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{staff.staffNumber}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <Separator className="my-4" />
              
              {balanceCollectedToday === 0 ? (
                <div className="space-y-2">
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg space-y-1">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Fully Covered
                    </p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      This booking is fully covered by the deposit paid. No additional payment required.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CreditCard className="h-3 w-3" />
                    Payment Method
                  </Label>
                  <RadioGroup
                    value={paymentMethod}
                    onValueChange={(value) => setPaymentMethod(value as any)}
                    className="grid grid-cols-1 gap-2"
                  >
                    <label
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        paymentMethod === "cash" ? "border-primary bg-primary/5" : "hover-elevate"
                      )}
                    >
                      <RadioGroupItem value="cash" id="cash" data-testid="radio-cash" />
                      <Banknote className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Cash</p>
                        <p className="text-xs text-muted-foreground">Pay with cash</p>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        paymentMethod === "transfer" ? "border-primary bg-primary/5" : "hover-elevate"
                      )}
                    >
                      <RadioGroupItem value="transfer" id="transfer" data-testid="radio-transfer" />
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Bank Transfer</p>
                        <p className="text-xs text-muted-foreground">Direct bank transfer</p>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        paymentMethod === "flutterwave" ? "border-primary bg-primary/5" : "hover-elevate"
                      )}
                    >
                      <RadioGroupItem value="flutterwave" id="flutterwave" data-testid="radio-flutterwave" />
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Payment Link</p>
                        <p className="text-xs text-muted-foreground">Generate Flutterwave payment link</p>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        paymentMethod === "credit" ? "border-primary bg-primary/5" : "hover-elevate"
                      )}
                    >
                      <RadioGroupItem value="credit" id="credit" data-testid="radio-credit" />
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Credit (Owe)</p>
                        <p className="text-xs text-muted-foreground">Borrow Book entry (needs customer)</p>
                      </div>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        paymentMethod === "split" ? "border-primary bg-primary/5" : "hover-elevate"
                      )}
                    >
                      <RadioGroupItem value="split" id="split" data-testid="radio-split" />
                      <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Split Payment</p>
                        <p className="text-xs text-muted-foreground">Pay with multiple methods</p>
                      </div>
                    </label>
                  </RadioGroup>
                </div>
              )}

              {paymentMethod === "split" && balanceCollectedToday > 0 && (
                <div className="mt-4 p-4 bg-muted/30 border border-border rounded-lg space-y-4 animate-in fade-in-50 duration-200">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      Split Configuration
                    </h4>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => setSplitPayments([...splitPayments, { method: "cash", amount: 0 }])}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  </div>
                  
                  <div className="space-y-3">
                    {splitPayments.map((split, index) => (
                      <div key={index} className="flex gap-2 items-start relative group">
                        <div className="flex-1 space-y-1">
                          <Label className="text-[10px] text-muted-foreground uppercase font-medium">Method</Label>
                          <Select 
                            value={split.method} 
                            onValueChange={(v: any) => updateSplitPayment(index, "method", v)}
                          >
                            <SelectTrigger className="h-8 text-xs bg-background">
                              <SelectValue>
                                {split.method === "cash" ? "Cash" : split.method === "transfer" ? "Bank Transfer" : split.method === "credit" ? "Credit (Owe)" : split.method}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="transfer">Bank Transfer</SelectItem>
                              <SelectItem value="credit">Credit (Owe)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex-1 space-y-1">
                          <Label className="text-[10px] text-muted-foreground uppercase font-medium">Amount</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1.5 text-xs text-muted-foreground">₦</span>
                            <Input 
                              type="number" 
                              min="0"
                              value={split.amount === 0 ? "0" : split.amount || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                let cleanVal = val;
                                if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                                updateSplitPayment(index, "amount", cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                              }}
                              className="pl-6 h-8 text-xs font-mono bg-background"
                            />
                          </div>
                        </div>
                        {splitPayments.length > 1 && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 mt-[18px] text-muted-foreground hover:text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                            onClick={() => removeSplitPayment(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-border space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-muted-foreground">Total Split:</span>
                      <div className="text-right flex items-center gap-1.5">
                        <span className={cn(
                          "text-sm font-bold font-mono",
                          splitIsValid
                            ? "text-emerald-600 dark:text-emerald-400" 
                            : "text-red-500"
                        )}>
                          {formatCurrency(splitTotal)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / {formatCurrency(balanceCollectedToday)}
                        </span>
                      </div>
                    </div>
                    {!splitIsValid && splitTotal > 0 && (
                      <p className="text-[11px] text-red-500 text-right">
                        {splitTotal < balanceCollectedToday 
                          ? `Still need: ${formatCurrency(balanceCollectedToday - splitTotal)}`
                          : `Over by: ${formatCurrency(splitTotal - balanceCollectedToday)}`
                        }
                      </p>
                    )}
                    {splitIsValid && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 text-right flex items-center justify-end gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Balanced — ready to checkout
                      </p>
                    )}
                  </div>

                </div>
              )}

              {paymentMethod === "credit" && balanceCollectedToday > 0 && (
                <div className="mt-4 p-4 bg-muted/30 border border-border rounded-lg space-y-3 animate-in fade-in-50 duration-200">
                  <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    Borrow Book Details
                  </h4>
                  
                  {!selectedCustomer ? (
                    <p className="text-xs text-destructive flex items-center gap-1 font-medium bg-destructive/5 p-2 rounded border border-destructive/10">
                      ⚠️ You must select a customer first to sell on credit.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="credit-upfront" className="text-xs font-medium text-muted-foreground">Amount Paid Upfront (₦)</Label>
                        <Input
                          id="credit-upfront"
                          type="number"
                          placeholder="e.g. 1000 (leave 0 if none)"
                          value={creditUpfrontPaid === 0 ? "0" : creditUpfrontPaid || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            let cleanVal = val;
                            if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                            const floatVal = cleanVal === "" ? 0 : parseFloat(cleanVal) || 0;
                            setCreditUpfrontPaid(Math.max(0, Math.min(floatVal, finalCartTotal)));
                          }}
                          className="bg-background"
                        />
                        <div className="flex justify-between items-center text-[10px] text-muted-foreground px-0.5">
                          <span>Total Cart: ₦{finalCartTotal.toLocaleString()}</span>
                          <span className="font-semibold text-primary">Outstanding Debt: ₦{(finalCartTotal - creditUpfrontPaid).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="credit-due" className="text-xs font-medium text-muted-foreground">Due Date (Expected Repayment)</Label>
                        <Input
                          id="credit-due"
                          type="date"
                          min={new Date().toISOString().split("T")[0]}
                          value={creditDueDate}
                          onChange={(e) => setCreditDueDate(e.target.value)}
                          className="bg-background"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {user?.role !== "staff" && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    <Label htmlFor="effective-date" className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                      Effective Transaction Date
                    </Label>
                    <Input
                      id="effective-date"
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => {
                        setEffectiveDate(e.target.value);
                        setIsDateModified(true);
                      }}
                      max={new Date().toISOString().split("T")[0]}
                      className="bg-background text-sm cursor-pointer hover:border-primary/50 transition-colors"
                    />
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Backdate this transaction to record a past sale. Future dates are blocked.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
            {serviceItemsMissingLead.length > 0 && (
              <div className="px-6 pb-2">
                <Alert variant="destructive" className="py-2 text-xs">
                  <AlertDescription className="flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />
                    Please assign a Lead staff to all service items.
                  </AlertDescription>
                </Alert>
              </div>
            )}
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
                    {paymentMethod === "flutterwave" ? "Generate Payment Link" : "Complete Sale"}
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <Dialog open={newCustomerDialogOpen} onOpenChange={setNewCustomerDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>
              Create a new customer quickly during checkout.
            </DialogDescription>
          </DialogHeader>
          <Form {...customerForm}>
            <form onSubmit={customerForm.handleSubmit(onCustomerSubmit)} className="space-y-4">
              <FormField
                control={customerForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customerForm.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="8012345678" {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter number without country code
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customerForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address (Optional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="123 Main St, City" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setNewCustomerDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createCustomerMutation.isPending}
                >
                  {createCustomerMutation.isPending ? "Creating..." : "Create Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ReceiptModal
        checkoutId={receiptCheckoutId}
        open={!!receiptCheckoutId}
        onClose={() => setReceiptCheckoutId(null)}
      />

      <Dialog 
        open={supervisorOverrideOpen} 
        onOpenChange={(open) => {
          if (!open) {
            // Cancelling the override resets the discount
            setApplyDiscount(false);
            setDiscountAmount(0);
            setDiscountPercent(0);
            setDiscountApprovedBy("");
            setSupervisorEmail("");
            setSupervisorPassword("");
          }
          setSupervisorOverrideOpen(open);
        }}
      >
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
              Supervisor Override Required
            </DialogTitle>
            <DialogDescription className="text-xs">
              {user?.role === "staff" 
                ? "Staff accounts cannot grant discounts. A Manager or Owner must input their credentials to authorize this adjustment."
                : "Manager accounts can only authorize discounts up to 20%. An Owner must authorize this discount."
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Supervisor Email</Label>
              <Input
                type="email"
                placeholder="supervisor@business.com"
                className="text-xs h-9"
                value={supervisorEmail}
                onChange={(e) => setSupervisorEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Supervisor Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="text-xs h-9"
                value={supervisorPassword}
                onChange={(e) => setSupervisorPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              className="text-xs h-9"
              onClick={() => {
                setApplyDiscount(false);
                setDiscountAmount(0);
                setDiscountPercent(0);
                setDiscountApprovedBy("");
                setSupervisorEmail("");
                setSupervisorPassword("");
                setSupervisorOverrideOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="text-xs h-9"
              disabled={isAuthorizingSupervisor || !supervisorEmail || !supervisorPassword}
              onClick={async () => {
                try {
                  setIsAuthorizingSupervisor(true);
                  const res = await fetch("/api/auth/supervisor-override", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: supervisorEmail, password: supervisorPassword }),
                  });
                  if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Invalid credentials.");
                  }
                  const resData = await res.json();
                  const sup = resData.supervisor;
                  
                  // Enforce Owner check for discounts > 20%
                  if (discountPercent > 20 && sup.role !== "owner") {
                    throw new Error("Only an Owner can authorize discounts exceeding 20%.");
                  }

                  toast({
                    title: "Override Authorized!",
                    description: `Approved by ${sup.name} (${sup.role})`,
                  });
                  setDiscountApprovedBy(`${sup.name} (${sup.role})`);
                  setSupervisorEmail("");
                  setSupervisorPassword("");
                  setSupervisorOverrideOpen(false);
                } catch (err: any) {
                  toast({
                    title: "Authorization Failed",
                    description: err.message || "Could not verify credentials.",
                    variant: "destructive",
                  });
                } finally {
                  setIsAuthorizingSupervisor(false);
                }
              }}
            >
              {isAuthorizingSupervisor ? "Authorizing..." : "Authorize"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Mobile/Tablet Floating Cart Navigator */}
      {cart.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 xl:hidden">
          <Button
            onClick={() => {
              const cartElement = document.getElementById("pos-cart-section");
              if (cartElement) {
                cartElement.scrollIntoView({ behavior: "smooth" });
              }
            }}
            className="flex items-center gap-2 rounded-full shadow-xl bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-6 text-sm font-semibold transition-all hover:scale-105 active:scale-95 duration-200"
          >
            <ShoppingCart className="h-5 w-5" />
            <span>View Cart ({cart.length}) — {formatCurrency(cartTotal)}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
