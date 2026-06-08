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
  WifiOff,
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
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { ReceiptModal } from "@/components/receipt-modal";
import type { Customer, Staff, Inventory } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { saveOfflineCheckout } from "@/lib/offline-db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CustomerPresenter, StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { NewCustomerDialog } from "./new-sale/NewCustomerDialog";
import { ProductGrid } from "./new-sale/ProductGrid";
import { CartItemRow } from "./new-sale/CartItemRow";
import type { CartItem } from "./new-sale/types";

export default function NewSale() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(navigator.onLine ? Date.now() : null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
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
  
  const [redeemPoints, setRedeemPoints] = useState<boolean>(false);
  const [redeemStoreCredit, setRedeemStoreCredit] = useState<boolean>(false);
  const [openRegisterDialogOpen, setOpenRegisterDialogOpen] = useState<boolean>(false);
  const [openingFloat, setOpeningFloat] = useState<number>(0);
  const [registerNotes, setRegisterNotes] = useState<string>("");

  // Cash Drawer Management UI States
  const [cashDropDialogOpen, setCashDropDialogOpen] = useState<boolean>(false);
  const [cashDropAmount, setCashDropAmount] = useState<string>("");
  const [cashDropNotes, setCashDropNotes] = useState<string>("");
  
  const [closeRegisterDialogOpen, setCloseRegisterDialogOpen] = useState<boolean>(false);
  const [actualCashCount, setActualCashCount] = useState<string>("");
  const [closeRegisterNotes, setCloseRegisterNotes] = useState<string>("");
  const [showCloseSummary, setShowCloseSummary] = useState<boolean>(false);
  const [closeSummaryData, setCloseSummaryData] = useState<any>(null);

  const { data: activeSession } = useQuery<any>({
    queryKey: ["/api/cash-register/session", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cash-register/session?storeId=${currentStore?.id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: taxRates = [] } = useQuery<any[]>({
    queryKey: ["/api/tax-rates", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tax-rates?storeId=${currentStore?.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const openRegisterMutation = useMutation({
    mutationFn: async (data: { openingFloat: number; notes: string }) => {
      const res = await apiRequest("POST", "/api/cash-register/open", {
        storeId: currentStore?.id,
        openingFloat: data.openingFloat,
        notes: data.notes,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to open register session");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash-register/session", currentStore?.id] });
      toast({ title: "Register drawer opened!", description: "You can now complete your checkout transactions." });
      setOpenRegisterDialogOpen(false);
      setOpeningFloat(0);
      setRegisterNotes("");
    },
    onError: (err: any) => {
      toast({
        title: "Could not open register session",
        description: err.message || "Please check your inputs and try again.",
        variant: "destructive",
      });
    },
  });

  // Mutation to record a cash drop
  const recordCashDropMutation = useMutation({
    mutationFn: async (data: { amount: number; notes: string }) => {
      const res = await apiRequest("POST", "/api/cash-register/drop", {
        sessionId: activeSession?.id,
        amount: data.amount,
        notes: data.notes,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to record cash drop");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash-register/session", currentStore?.id] });
      toast({
        title: "Cash Drop Recorded!",
        description: `Successfully dropped ₦${Number(cashDropAmount).toLocaleString()} from the drawer.`,
      });
      setCashDropAmount("");
      setCashDropNotes("");
      setCashDropDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could Not Record Drop",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to close the drawer session
  const closeRegisterMutation = useMutation({
    mutationFn: async (data: { actualCash: number; notes: string }) => {
      const res = await apiRequest("POST", "/api/cash-register/close", {
        sessionId: activeSession?.id,
        actualCash: data.actualCash,
        notes: data.notes,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to close register session");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash-register/session", currentStore?.id] });
      setCloseSummaryData(data);
      setShowCloseSummary(true);
      toast({
        title: "Drawer Session Closed!",
        description: "Reconciliation report generated successfully.",
      });
      setActualCashCount("");
      setCloseRegisterNotes("");
      setCloseRegisterDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could Not Close Drawer",
        description: err.message,
        variant: "destructive",
      });
    },
  });

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


  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: globalCustomerMatches = [] } = useQuery<any[]>({
    queryKey: ["/api/customers/search-global", currentStore?.id, customerSearchQuery],
    queryFn: async () => {
      if (customerSearchQuery.trim().length < 2) return [];
      const res = await apiRequest("GET", `/api/customers/search-global?storeId=${currentStore?.id}&query=${encodeURIComponent(customerSearchQuery)}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all" && customerSearchQuery.trim().length >= 2,
  });

  const profileCustomerMutation = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await apiRequest("POST", "/api/customers/profile-global", {
        customerId,
        storeId: currentStore?.id,
      });
      return res.json();
    },
    onSuccess: (newLocalCustomer) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      setSelectedCustomer(newLocalCustomer.id);
      setCustomerOpen(false);
      toast({
        title: "Customer Profiled Successfully",
        description: `${newLocalCustomer.name} has been imported to this branch.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Profile Customer",
        description: error.message || "Failed to copy customer profile.",
        variant: "destructive",
      });
    },
  });

  const { data: staffList = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/products", currentStore?.id],
    queryFn: async () => {
      const res = await fetch(`/api/products?storeId=${currentStore?.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  // Flat variant list — kept for booking prefill, cart logic, promotions
  const inventory: Inventory[] = products.flatMap((p: any) => p.variants ?? []);

  const { data: promotionsList = [] } = useQuery<any[]>({
    queryKey: ["/api/promotions", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/promotions?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const availableInventory = inventory.filter(
    (item) => item.type === "service" || item.quantity > 0
  );

  // Track online/offline state for stale-data warning
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); setLastOnlineAt(Date.now()); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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

  // Available product groups — used by ProductGrid (services always available, products need stock)
  const availableProducts = products.filter((p: any) =>
    p.type === "service" || (p.variants ?? []).some((v: any) => v.quantity > 0)
  );

  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const addToCart = (item: Inventory) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.inventory.id === item.id);
      const maxQty = item.type === "service" ? 999 : (item.quantity || 0);
      const step = item.allowFractional ? 0.5 : 1;

      if (existing) {
        if (existing.quantity >= maxQty) {
          toast({
            title: "Stock Limit Reached",
            description: `Only ${maxQty}${item.unit ? " " + item.unit : ""} of "${item.name}" available.`,
            variant: "destructive",
          });
          return prev;
        }
        const newQty = Math.min(Math.round((existing.quantity + step) * 100) / 100, maxQty);
        return prev.map((c) =>
          c.inventory.id === item.id
            ? { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 }
            : c
        );
      }

      // Cap initial quantity to available stock
      const initialQty = item.type === "service" ? 1 : Math.min(step, maxQty);
      if (item.type === "product" && maxQty <= 0) {
        toast({
          title: "Out of Stock",
          description: `"${item.name}" has no stock available.`,
          variant: "destructive",
        });
        return prev;
      }

      return [...prev, {
        inventory: item,
        quantity: initialQty,
        customPrice: item.sellingPrice,
        totalPrice: Math.round(initialQty * item.sellingPrice * 100) / 100,
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
            const newQty = Math.round((c.quantity + delta) * 10000) / 10000;
            const maxQty = c.inventory.type === "service" ? 999 : c.inventory.quantity;
            if (c.inventory.type === "product" && newQty > maxQty) {
              toast({
                title: "Stock Limit Reached",
                description: `Only ${maxQty}${c.inventory.unit ? " " + c.inventory.unit : ""} available.`,
                variant: "destructive",
              });
              return c;
            }
            const minQty = c.inventory.allowFractional ? 0.01 : 1;
            if (newQty < minQty) return null as unknown as CartItem;
            return { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 };
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
            const minQty = c.inventory.allowFractional ? 0.01 : 1;
            if (c.inventory.type === "product" && newQty > maxQty) {
              toast({
                title: "Stock Limit Reached",
                description: `Only ${maxQty}${c.inventory.unit ? " " + c.inventory.unit : ""} available.`,
                variant: "destructive",
              });
            }
            const validQty = Math.max(minQty, c.inventory.type === "product" ? Math.min(newQty, maxQty) : newQty);
            return { ...c, quantity: validQty, totalPrice: Math.round(validQty * c.customPrice * 100) / 100 };
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

  // Dynamic tax rate from fetched rates
  const defaultTaxRate = taxRates?.find((r: any) => r.isDefault);
  const taxRatePercent = defaultTaxRate ? Number(defaultTaxRate.rate) : 0;

  // Customer loyalty points & store credit
  const currentCustomer = customers.find((c: any) => String(c.id) === selectedCustomer);
  const customerPoints = currentCustomer?.loyaltyPoints || 0;
  const customerStoreCredit = currentCustomer?.storeCreditBalance || 0;
  const subtotalBeforePoints = Math.max(0, finalCartTotal - discountAmount);

  // 1 loyalty point = ₦10 discount. Max discount cannot exceed the subtotal before tax.
  const maxPointsToRedeem = Math.min(customerPoints, Math.floor(subtotalBeforePoints / 10));
  const pointsToRedeem = redeemPoints ? maxPointsToRedeem : 0;
  const loyaltyDiscount = pointsToRedeem * 10;

  const subtotalAfterPoints = Math.max(0, subtotalBeforePoints - loyaltyDiscount);
  const taxTotal = subtotalAfterPoints * (taxRatePercent / 100);
  const totalChargedBeforeCredit = subtotalAfterPoints + taxTotal;

  // Store Credit Redemption (applied on totalChargedBeforeCredit)
  const storeCreditRedeemed = redeemStoreCredit ? Math.min(customerStoreCredit, totalChargedBeforeCredit) : 0;
  const totalCharged = Math.max(0, totalChargedBeforeCredit - storeCreditRedeemed);
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

      const freshCustomer = customers.find((c: any) => String(c.id) === selectedCustomer);
      const freshCustomerPoints = freshCustomer?.loyaltyPoints || 0;
      const freshCustomerStoreCredit = freshCustomer?.storeCreditBalance || 0;
      const freshSubtotalBeforePoints = Math.max(0, freshFinalTotal - (discountAmount || 0));
      const freshMaxPointsToRedeem = Math.min(freshCustomerPoints, Math.floor(freshSubtotalBeforePoints / 10));
      const freshPointsToRedeem = redeemPoints ? freshMaxPointsToRedeem : 0;
      const freshLoyaltyDiscount = freshPointsToRedeem * 10;

      const freshSubtotalAfterPoints = Math.max(0, freshSubtotalBeforePoints - freshLoyaltyDiscount);
      const freshTaxTotal = freshSubtotalAfterPoints * (taxRatePercent / 100);
      const freshTotalChargedBeforeCredit = freshSubtotalAfterPoints + freshTaxTotal;

      const freshStoreCreditRedeemed = redeemStoreCredit ? Math.min(freshCustomerStoreCredit, freshTotalChargedBeforeCredit) : 0;
      const freshTotalCharged = Math.max(0, freshTotalChargedBeforeCredit - freshStoreCreditRedeemed);
      const freshBalance = Math.max(0, freshTotalCharged - freshDepositAmount);

      let finalPaymentMethod = freshBalance === 0 && freshDepositAmount > 0 ? "deposit" : paymentMethod;
      let finalSplitPayments = paymentMethod === "split" ? splitPayments.filter(s => s.amount > 0) : undefined;

      if (freshStoreCreditRedeemed > 0) {
        if (freshBalance === 0) {
          finalPaymentMethod = "store_credit";
          finalSplitPayments = undefined;
        } else {
          if (paymentMethod === "split") {
            finalSplitPayments = [
              ...splitPayments.filter(s => s.amount > 0),
              { method: "store_credit", amount: freshStoreCreditRedeemed }
            ] as any[];
          } else {
            finalPaymentMethod = "split";
            finalSplitPayments = [
              { method: paymentMethod as any, amount: freshBalance },
              { method: "store_credit", amount: freshStoreCreditRedeemed }
            ];
          }
        }
      }

      const checkoutPayload = {
        storeId: currentStore?.id,
        bookingId: bookingId || undefined,
        customerId: selectedCustomer || null,
        staffId: selectedStaff,
        items: orderData,
        paymentMethod: finalPaymentMethod,
        discountAmount: discountAmount || undefined,
        discountPercent: discountPercent || undefined,
        discountReason: discountReason || undefined,
        discountApprovedBy: discountApprovedBy || undefined,
        effectiveDate: isDateModified ? effectiveDate : undefined,
        creditUpfrontPaid: paymentMethod === "credit" ? creditUpfrontPaid : undefined,
        creditDueDate: paymentMethod === "credit" ? (creditDueDate || undefined) : undefined,
        splitPayments: finalSplitPayments,
        bookingDepositAmount: freshDepositAmount > 0 ? freshDepositAmount : undefined,
        bookingDepositMethod: freshDepositMethod || undefined,
        balanceCollectedToday: freshBalance,
        pointsRedeemed: freshPointsToRedeem > 0 ? freshPointsToRedeem : undefined,
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
        queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        toast({ title: "Sale completed successfully!" });
      }

      setCart([]);
      setSelectedCustomer("");
      setSelectedStaff("");
      setPaymentMethod("cash");
      setApplyDiscount(false);
      setRedeemPoints(false);
      setRedeemStoreCredit(false);
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
      const msg = error.message || "";
      const isZeroPriceError = msg.toLowerCase().includes("cannot be sold for ₦0") ||
                               msg.toLowerCase().includes("only active promotions can apply");
      const isStockError = msg.toLowerCase().includes("only have") ||
                           msg.toLowerCase().includes("in stock") ||
                           msg.toLowerCase().includes("cannot be sold in fractional") ||
                           msg.toLowerCase().includes("stock limit") ||
                           msg.toLowerCase().includes("out of stock");

      toast({
        title: isZeroPriceError ? "Invalid Item Price"
             : isStockError    ? "Stock Issue"
             :                   "Couldn't Complete Sale",
        description: isZeroPriceError
          ? "Items cannot be priced at ₦0 during checkout unless covered by an active promotion."
          : isStockError
          ? msg
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
  
  const validateCheckout = (): string | null => {
    if (cart.length === 0) return "Your cart is empty. Add items to proceed.";
    if (!selectedCustomer) return "Please select a customer (e.g. Walk-in).";
    if (!selectedStaff) return "Please select the staff member handling this transaction.";
    if (serviceItemsMissingLead.length > 0) return "Please assign a lead staff member to all service items.";
    if (discountAmount > 0 && (!discountReason || !discountApprovedBy)) return "Discount requires both a reason and manager approval.";
    if (!isFullyCoveredByDeposit && paymentMethod === "split" && !splitIsValid) return "Split payment amounts must exactly match the balance due.";
    return null;
  };

  const handleCheckoutClick = () => {
    // If discount requires override but is not approved, trigger the override dialog instead of showing a blocking validation error
    const pct = finalCartTotal > 0 ? (discountAmount / finalCartTotal) * 100 : 0;
    const requiresOverride = discountAmount > 0 && (
      user?.role === "staff" || 
      (user?.role === "manager" && pct > 20)
    );
    
    if (requiresOverride && !discountApprovedBy) {
      if (!discountReason) {
        toast({
          title: "Discount Reason Required",
          description: "Please specify a reason for applying a transaction discount before seeking supervisor approval.",
          variant: "destructive",
        });
        return;
      }
      setSupervisorOverrideOpen(true);
      return;
    }

    const validationError = validateCheckout();
    if (validationError) {
      toast({
        title: "Missing Requirements",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    if (!activeSession) {
      setOpenRegisterDialogOpen(true);
      return;
    }
    checkoutMutation.mutate();
  };

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

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <PageHeader
          title="New Sale"
          description="Create a new sales transaction"
        />
        <ConsolidatedFallbackAlert pageTitle="Point of Sale (POS) Checkout" />
      </div>
    );
  }

  const staleMinutes = lastOnlineAt ? Math.floor((Date.now() - lastOnlineAt) / 60_000) : null;

  return (
    <div className={`space-y-6 ${!isOnline ? "pb-14" : ""}`}>
      {/* Stale-data warning when offline */}
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>You're offline.</strong> Prices and stock levels shown are
            {staleMinutes !== null && staleMinutes > 0
              ? ` as of ${staleMinutes < 60 ? `${staleMinutes} min` : `${Math.floor(staleMinutes / 60)}h`} ago`
              : " from your last visit"}
            . Completed sales will be queued and synced when you reconnect.
          </span>
        </div>
      )}
      <PageHeader
        title="New Sale"
        description={`Create a new sales transaction for ${currentStore.name}`}
        actions={
          <div className="flex items-center gap-2">
            {activeSession ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="bg-slate-900/40 border-slate-800 text-slate-200 hover:text-white flex items-center gap-2 rounded-xl h-9 px-3">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-mono text-xs">₦{activeSession.expectedCash.toLocaleString()} expected</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4 bg-slate-900 border-slate-800 text-slate-350 rounded-2xl shadow-xl space-y-4 z-50">
                  <div className="space-y-1">
                    <h4 className="font-bold text-white text-sm flex items-center gap-1.5">
                      <Banknote className="h-4 w-4 text-emerald-400" />
                      Active Register Session
                    </h4>
                    <p className="text-[10px] text-slate-500">
                      Opened {new Date(activeSession.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ₦{activeSession.openingFloat.toLocaleString()} float
                    </p>
                  </div>
                  
                  <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-xl space-y-1.5 text-xs">
                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                      <span>Expected Drawer Balance</span>
                      <span className="font-bold font-mono text-white">₦{activeSession.expectedCash.toLocaleString()}</span>
                    </div>
                    {activeSession.notes && (
                      <div className="pt-1.5 border-t border-slate-850 text-[10px] text-slate-450 italic">
                        "{activeSession.notes}"
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="text-xs h-8 border-slate-800 hover:bg-slate-800 text-slate-300"
                      onClick={() => setCashDropDialogOpen(true)}
                    >
                      Cash Drop
                    </Button>
                    <Button 
                      type="button" 
                      className="text-xs h-8 bg-rose-600 hover:bg-rose-700 text-white font-bold"
                      onClick={() => setCloseRegisterDialogOpen(true)}
                    >
                      Close Shift
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <Button 
                variant="outline" 
                className="bg-rose-500/10 border-rose-500/20 text-rose-450 hover:bg-rose-500/20 flex items-center gap-2 rounded-xl h-9 px-3"
                onClick={() => setOpenRegisterDialogOpen(true)}
              >
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-xs font-bold">Register Drawer Closed</span>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <ProductGrid
            products={availableProducts}
            isLoading={isLoading}
            cart={cart}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onAddToCart={addToCart}
            formatCurrency={formatCurrency}
            isOffline={!isOnline}
          />
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
                      <CartItemRow
                        key={item.inventory.id}
                        item={item}
                        staffList={staffList}
                        formatCurrency={formatCurrency}
                        onUpdateQuantity={updateQuantity}
                        onSetExactQuantity={setExactQuantity}
                        onUpdatePrice={updateCustomPrice}
                        onRemove={removeFromCart}
                        onUpdateStaff={updateStaffAssignment}
                      />
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
                              setDiscountApprovedBy("");
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
                              setDiscountApprovedBy("");
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

              {/* Customer Loyalty Points Panel */}
              {selectedCustomer && customerPoints > 0 && (
                <div className="w-full border border-primary/10 rounded-lg p-3.5 bg-primary/5 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-tight text-primary flex items-center gap-1.5">
                      <Gift className="h-3.5 w-3.5 text-primary" />
                      Customer Loyalty
                    </p>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="redeem-points-toggle" className="text-xs font-medium cursor-pointer">
                        Redeem Points?
                      </Label>
                      <Switch
                        id="redeem-points-toggle"
                        checked={redeemPoints}
                        onCheckedChange={setRedeemPoints}
                      />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-primary/10 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available Points:</span>
                      <span className="font-semibold">{customerPoints} pts</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Points Value:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(customerPoints * 10)}
                      </span>
                    </div>
                    {redeemPoints && (
                      <div className="mt-2 pt-2 border-t border-dashed border-primary/10 flex justify-between items-center text-xs font-semibold bg-emerald-500/10 p-2 rounded">
                        <span className="text-emerald-800 dark:text-emerald-300">Points Redeemed:</span>
                        <span className="text-emerald-800 dark:text-emerald-300 font-mono">
                          {pointsToRedeem} pts (-{formatCurrency(loyaltyDiscount)})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Customer Store Credit Panel */}
              {selectedCustomer && customerStoreCredit > 0 && (
                <div className="w-full border border-indigo-500/10 rounded-lg p-3.5 bg-indigo-500/5 space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-tight text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                      Customer Store Credit
                    </p>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="redeem-credit-toggle" className="text-xs font-medium cursor-pointer">
                        Redeem Store Credit?
                      </Label>
                      <Switch
                        id="redeem-credit-toggle"
                        checked={redeemStoreCredit}
                        onCheckedChange={setRedeemStoreCredit}
                      />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-indigo-500/10 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available Credit:</span>
                      <span className="font-semibold font-mono text-indigo-600 dark:text-indigo-400">
                        {formatCurrency(customerStoreCredit)}
                      </span>
                    </div>
                    {redeemStoreCredit && (
                      <div className="mt-2 pt-2 border-t border-dashed border-indigo-500/10 flex justify-between items-center text-xs font-semibold bg-indigo-500/10 p-2 rounded">
                        <span className="text-indigo-800 dark:text-indigo-300">Credit Applied today:</span>
                        <span className="text-indigo-800 dark:text-indigo-300 font-mono">
                          -{formatCurrency(storeCreditRedeemed)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="w-full space-y-2 pt-2 border-t text-xs">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Cart Subtotal</span>
                  <span className="font-mono">{formatCurrency(finalCartTotal)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between items-center text-red-500">
                    <span>Coupon / Custom Discount</span>
                    <span className="font-mono">- {formatCurrency(discountAmount)}</span>
                  </div>
                )}

                {loyaltyDiscount > 0 && (
                  <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                    <span>Loyalty Points Discount</span>
                    <span className="font-mono">- {formatCurrency(loyaltyDiscount)}</span>
                  </div>
                )}

                {(discountAmount > 0 || loyaltyDiscount > 0) && (
                  <div className="flex justify-between items-center font-medium text-foreground border-t border-dashed border-primary/10 pt-1.5">
                    <span>Net Subtotal</span>
                    <span className="font-mono">{formatCurrency(subtotalAfterPoints)}</span>
                  </div>
                )}

                {taxRatePercent > 0 && (
                  <div className="flex justify-between items-center text-muted-foreground">
                    <span>
                      VAT / Sales Tax ({defaultTaxRate?.name || "Tax"} {taxRatePercent}%)
                    </span>
                    <span className="font-mono">{formatCurrency(taxTotal)}</span>
                  </div>
                )}

                {storeCreditRedeemed > 0 && (
                  <>
                    <div className="flex justify-between items-center font-medium text-muted-foreground border-t border-dashed border-primary/10 pt-1.5">
                      <span>Subtotal (incl. Tax)</span>
                      <span className="font-mono">{formatCurrency(totalChargedBeforeCredit)}</span>
                    </div>
                    <div className="flex justify-between items-center text-indigo-600 dark:text-indigo-400 font-semibold animate-fade-in">
                      <span>Store Credit Applied</span>
                      <span className="font-mono">- {formatCurrency(storeCreditRedeemed)}</span>
                    </div>
                  </>
                )}

                <div className="flex justify-between items-center font-bold text-sm text-foreground pt-1.5 border-t">
                  <span>Total Charged</span>
                  <span className="font-mono">{formatCurrency(totalCharged)}</span>
                </div>
                
                {bookingDepositAmount > 0 && (
                  <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Booking Deposit Paid</span>
                    <span className="font-mono">- {formatCurrency(bookingDepositAmount)}</span>
                  </div>
                )}
                
                <div className="flex justify-between items-center pt-2.5 border-t border-primary/20">
                  <span className="font-bold text-base text-primary uppercase tracking-tight">Total Remaining</span>
                  <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
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
                  <Popover open={customerOpen} onOpenChange={(open) => {
                    setCustomerOpen(open);
                    if (!open) setCustomerSearchQuery("");
                  }}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerOpen}
                        className="flex-1 justify-between font-normal"
                        data-testid="select-customer"
                        disabled={!!bookingId || profileCustomerMutation.isPending}
                      >
                        {profileCustomerMutation.isPending ? (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
                            Profiling customer...
                          </span>
                        ) : selectedCustomer ? (
                          customers.find((c) => c.id === selectedCustomer)?.name
                        ) : (
                          "Search customers..."
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput 
                        placeholder="Search by name or ID..." 
                        data-testid="input-search-customer" 
                        value={customerSearchQuery}
                        onValueChange={setCustomerSearchQuery}
                      />
                      <CommandList>
                        {profileCustomerMutation.isPending ? (
                          <CommandEmpty>Profiling customer, please wait...</CommandEmpty>
                        ) : (
                          customers.filter(c => !c.isArchived).length === 0 &&
                          globalCustomerMatches.length === 0 && (
                            <CommandEmpty>
                              {!isOnline ? "No cached customers — add one below." : "No customer found."}
                            </CommandEmpty>
                          )
                        )}
                        {!isOnline && customers.length > 0 && (
                          <div className="px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <WifiOff className="h-2.5 w-2.5" />Showing cached customers
                          </div>
                        )}
                        
                        {!profileCustomerMutation.isPending && (
                          <>
                            {/* Local matches */}
                            <CommandGroup heading="Local Store Branch">
                              {customers
                                .filter((c) => !c.isArchived)
                                .filter((c) => {
                                  if (!customerSearchQuery.trim()) return true;
                                  const query = customerSearchQuery.toLowerCase();
                                  return (
                                    c.name.toLowerCase().includes(query) ||
                                    c.customerNumber.toLowerCase().includes(query) ||
                                    (c.mobileNumber || "").toLowerCase().includes(query)
                                  );
                                })
                                .map((customer) => {
                                  const presenter = new CustomerPresenter(customer);
                                  return (
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
                                      <EntityDisplay presenter={presenter} />
                                    </CommandItem>
                                  );
                                })}
                            </CommandGroup>

                            {/* Cross-branch matches */}
                            {globalCustomerMatches.length > 0 && (
                              <CommandGroup heading="Other Branches (Same Business)">
                                {globalCustomerMatches.map((customer) => {
                                  const presenter = new CustomerPresenter(customer);
                                  return (
                                    <CommandItem
                                      key={customer.id}
                                      value={`${customer.name} ${customer.customerNumber} ${customer.mobileNumber || ''}`}
                                      onSelect={() => {
                                        profileCustomerMutation.mutate(customer.id);
                                      }}
                                      data-testid={`customer-global-option-${customer.id}`}
                                      className="flex items-center justify-between cursor-pointer"
                                    >
                                      <div className="flex items-center flex-1">
                                        <Check className="mr-2 h-4 w-4 opacity-0" />
                                        <EntityDisplay presenter={presenter} />
                                      </div>
                                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium shrink-0 ml-2">
                                        {customer.storeName}
                                      </span>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            )}
                          </>
                        )}
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
                          {staffList.filter(s => !s.isArchived).map((staff) => {
                            const presenter = new StaffPresenter(staff);
                            return (
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
                                <EntityDisplay presenter={presenter} />
                              </CommandItem>
                            );
                          })}
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
                        <p className="text-xs text-muted-foreground">Credit Sales entry (needs customer)</p>
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
                    Credit Sales Details
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
                disabled={checkoutMutation.isPending}
                onClick={handleCheckoutClick}
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

      <Dialog open={openRegisterDialogOpen} onOpenChange={(open) => {
        if (!open) { setOpeningFloat(0); setRegisterNotes(""); }
        setOpenRegisterDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <Banknote className="h-5 w-5 text-emerald-500" />
              Open Register Drawer
            </DialogTitle>
            <DialogDescription className="text-xs">
              There is currently no active cash register session. You must open the drawer with an initial float to start checking out customers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Opening Float (₦)</Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={openingFloat === 0 ? "0" : openingFloat || ""}
                onChange={(e) => {
                  const valStr = e.target.value;
                  let cleanValStr = valStr;
                  if (/^0\d+/.test(valStr)) cleanValStr = valStr.replace(/^0+/, '');
                  const val = parseFloat(cleanValStr);
                  setOpeningFloat(isNaN(val) || val < 0 ? 0 : val);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes (Optional)</Label>
              <Textarea
                placeholder="Initial cash breakdown or details..."
                className="h-20 text-sm resize-none"
                value={registerNotes}
                onChange={(e) => setRegisterNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpenRegisterDialogOpen(false);
                setOpeningFloat(0);
                setRegisterNotes("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={openRegisterMutation.isPending}
              onClick={() => {
                openRegisterMutation.mutate({ openingFloat, notes: registerNotes });
              }}
            >
              {openRegisterMutation.isPending ? "Opening..." : "Open Drawer Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NewCustomerDialog
        open={newCustomerDialogOpen}
        storeId={currentStore?.id ?? ""}
        onClose={() => setNewCustomerDialogOpen(false)}
        onCreated={(id) => {
          setSelectedCustomer(id);
          setNewCustomerDialogOpen(false);
        }}
      />

      <ReceiptModal
        checkoutId={receiptCheckoutId}
        open={!!receiptCheckoutId}
        onClose={() => setReceiptCheckoutId(null)}
      />

      <Dialog 
        open={supervisorOverrideOpen} 
        onOpenChange={(open) => {
          if (!open) {
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

      {/* 1. Cash Drop Dialog */}
      <Dialog open={cashDropDialogOpen} onOpenChange={(open) => {
        if (!open) { setCashDropAmount(""); setCashDropNotes(""); }
        setCashDropDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <Banknote className="h-5 w-5 text-amber-500" />
              Record Cash Drop (Safe Transfer)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Record a transfer of excess physical cash from the till drawer into the back-office secure safe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Amount to Drop (₦)</Label>
              <Input
                type="number"
                min="1"
                max={activeSession?.expectedCash || 9999999}
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={cashDropAmount}
                onChange={(e) => setCashDropAmount(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Max drop eligible: ₦{(activeSession?.expectedCash || 0).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Drawer Drop Notes</Label>
              <Textarea
                placeholder="e.g. ₦50k rush drop to safe by shift supervisor."
                className="text-xs resize-none h-20"
                value={cashDropNotes}
                onChange={(e) => setCashDropNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCashDropAmount("");
                setCashDropNotes("");
                setCashDropDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={recordCashDropMutation.isPending || !cashDropAmount || Number(cashDropAmount) <= 0}
              onClick={() => {
                recordCashDropMutation.mutate({
                  amount: Number(cashDropAmount),
                  notes: cashDropNotes,
                });
              }}
            >
              {recordCashDropMutation.isPending ? "Recording Drop..." : "Confirm Drop to Safe"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 2. Close Register Dialog */}
      <Dialog open={closeRegisterDialogOpen} onOpenChange={(open) => {
        if (!open) { setActualCashCount(""); setCloseRegisterNotes(""); }
        setCloseRegisterDialogOpen(open);
      }}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-bold">
              <AlertCircle className="h-5 w-5 text-rose-500 animate-pulse" />
              Close Shift Register Drawer
            </DialogTitle>
            <DialogDescription className="text-xs">
              Reconcile your physical cash draw. Key in your counted till balance to calculate variance reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 bg-slate-950/60 border rounded-xl space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between items-center text-[10px]">
                <span>Shift Started At:</span>
                <span className="font-semibold text-white">
                  {activeSession?.openedAt ? new Date(activeSession.openedAt).toLocaleString() : ""}
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span>Opening Float:</span>
                <span className="font-mono text-white">₦{(activeSession?.openingFloat || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1.5 border-t">
                <span className="font-bold">Expected Till Balance:</span>
                <span className="font-mono font-bold text-emerald-400">
                  ₦{(activeSession?.expectedCash || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Counted Drawer Cash (₦) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min="0"
                placeholder="0.00"
                className="font-mono h-10 text-lg"
                value={actualCashCount}
                onChange={(e) => setActualCashCount(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Count all physical notes/coins in the till. Do not subtract the starting float.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Closing Notes</Label>
              <Textarea
                placeholder="e.g. End of morning shift. Drawer checks out cleanly."
                className="text-xs resize-none h-20"
                value={closeRegisterNotes}
                onChange={(e) => setCloseRegisterNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setActualCashCount("");
                setCloseRegisterNotes("");
                setCloseRegisterDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
              disabled={closeRegisterMutation.isPending || !actualCashCount}
              onClick={() => {
                closeRegisterMutation.mutate({
                  actualCash: Number(actualCashCount),
                  notes: closeRegisterNotes,
                });
              }}
            >
              {closeRegisterMutation.isPending ? "Reconciling..." : "Reconcile & Close Drawer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 3. Reconciliation Summary Report Modal */}
      <Dialog open={showCloseSummary} onOpenChange={setShowCloseSummary}>
        <DialogContent className="max-w-md border-primary/20 shadow-lg p-6">
          <DialogHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-lg font-extrabold text-white font-outfit">
              Shift Reconciled Successfully!
            </DialogTitle>
            <DialogDescription className="text-xs">
              The register session is now closed. Your shift metrics are saved to the platform's audit ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-3.5 text-xs font-medium">
            <div className="grid grid-cols-2 gap-2.5 p-3.5 bg-slate-950/60 border rounded-2xl">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Expected till count</span>
                <span className="block font-mono text-sm text-slate-300">
                  ₦{(closeSummaryData?.expectedCash || 0).toLocaleString()}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Counted till count</span>
                <span className="block font-mono text-sm text-white">
                  ₦{(closeSummaryData?.actualCash || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center p-3 bg-slate-900 border rounded-xl">
              <span className="font-semibold text-slate-300">Shift Discrepancy (Drift)</span>
              <Badge 
                variant="outline"
                className={cn(
                  "border-none font-bold text-xs uppercase px-2.5 py-1",
                  (closeSummaryData?.difference || 0) === 0
                    ? "bg-slate-800 text-slate-300"
                    : (closeSummaryData?.difference || 0) > 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                )}
              >
                {(closeSummaryData?.difference || 0) === 0
                  ? "Balanced"
                  : (closeSummaryData?.difference || 0) > 0
                  ? `+₦${(closeSummaryData?.difference || 0).toLocaleString()} (Surplus)`
                  : `-₦${Math.abs(closeSummaryData?.difference || 0).toLocaleString()} (Shortage)`
                }
              </Badge>
            </div>

            <div className="space-y-1 text-[11px] text-slate-400 pt-1">
              <span className="font-bold text-slate-500 block uppercase text-[10px]">Reconciliation Notes:</span>
              <span className="italic block p-2.5 bg-slate-950/40 rounded-xl">
                "{closeSummaryData?.notes || "No shift notes provided."}"
              </span>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Button
              type="button"
              className="w-full py-5 text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl"
              onClick={() => {
                setShowCloseSummary(false);
                setCloseSummaryData(null);
              }}
            >
              Done / Sync Complete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
