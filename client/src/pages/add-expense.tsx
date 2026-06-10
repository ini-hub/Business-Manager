import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Wallet, Calendar, FileText, Plus, Check, X, Link2 } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import type { ExpenseCategory, Inventory } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

const expenseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  amount: z.coerce.number().min(0, "Amount must be positive"),
  categoryId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
  inventoryId: z.string().optional().nullable(),
  storeId: z.string().optional(),
  paymentMethod: z.string().default("cash"),
  splitCash: z.coerce.number().min(0).default(0),
  splitTransfer: z.coerce.number().min(0).default(0),
  splitPos: z.coerce.number().min(0).default(0),
}).superRefine((data, ctx) => {
  const isLinked = data.inventoryId && data.inventoryId !== "none";
  if (!isLinked && (!data.categoryId || data.categoryId.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["categoryId"],
      message: "Category is required for general operational expenses",
    });
  }

  if (data.paymentMethod === "split") {
    const totalSplits = (data.splitCash || 0) + (data.splitTransfer || 0) + (data.splitPos || 0);
    if (Math.abs(totalSplits - data.amount) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["splitCash"],
        message: `Total splits (₦${totalSplits.toLocaleString()}) must equal total amount (₦${data.amount.toLocaleString()})`,
      });
    }
  }
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

export default function AddExpensePage() {
  const { currentStore, stores } = useStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (val: number) => formatCurrencyUtil(val, storeCurrency);

  const [isNewCategoryMode, setIsNewCategoryMode] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [linkedProductIds, setLinkedProductIds] = useState<string[]>([]);
  const [allocationDriver, setAllocationDriver] = useState<"count" | "revenue">("count");

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      title: "",
      amount: 0,
      categoryId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      inventoryId: "none",
      paymentMethod: "cash",
      splitCash: 0,
      splitTransfer: 0,
      splitPos: 0,
      storeId: currentStore?.id === "all" ? "" : (currentStore?.id || ""),
    },
  });

  const selectedInventoryId = form.watch("inventoryId");

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ["/api/expense-categories", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/expense-categories?storeId=${s.id}`);
              if (!res.ok) return [];
              return await res.json() as ExpenseCategory[];
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/expense-categories?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/inventory?storeId=${s.id}`);
              if (!res.ok) return [];
              return await res.json() as Inventory[];
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

  const { data: productGroups = [] } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/products", currentStore?.id],
    queryFn: async () => {
      const storeId = currentStore?.id === "all" ? (stores[0]?.id ?? "") : (currentStore?.id ?? "");
      if (!storeId) return [];
      const res = await apiRequest("GET", `/api/products?storeId=${storeId}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const activeStoreId = form.getValues("storeId") || currentStore!.id;
      const res = await apiRequest("POST", "/api/expense-categories", { name, storeId: activeStoreId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      toast({ title: "Success", description: "Category created." });
    },
  });

  const addExpenseMutation = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      const isLinked = data.inventoryId && data.inventoryId !== "none";
      let catId = data.categoryId;

      if (!isLinked && isNewCategoryMode) {
        if (!customCategoryName.trim()) {
          throw new Error("Please enter a category name.");
        }
        const existingCat = categories.find(
          c => c.name.toLowerCase() === customCategoryName.trim().toLowerCase()
        );
        if (existingCat) {
          catId = existingCat.id;
        } else {
          const newCat = await addCategoryMutation.mutateAsync(customCategoryName.trim());
          catId = newCat.id;
        }
      } else if (isLinked) {
        catId = categories.find(c => !c.isSystem)?.id || categories[0]?.id || "";
      }

      const splitPayments = data.paymentMethod === "split" ? [
        { method: "cash", amount: data.splitCash || 0 },
        { method: "transfer", amount: data.splitTransfer || 0 },
        { method: "pos", amount: data.splitPos || 0 },
      ].filter(p => p.amount > 0) : null;

      const submissionData = {
        title: data.title,
        amount: data.amount,
        categoryId: catId,
        date: data.date,
        notes: data.notes,
        inventoryId: data.inventoryId === "none" ? null : data.inventoryId,
        storeId: data.storeId || currentStore!.id,
        paymentMethod: data.paymentMethod,
        splitPayments,
        linkedProductIds: linkedProductIds.length > 0 ? linkedProductIds : undefined,
        allocationDriver: linkedProductIds.length > 0 ? allocationDriver : undefined,
      };
      await apiRequest("POST", "/api/expenses", submissionData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss/summary"] });
      toast({ title: "Success", description: "Expense logged successfully." });
      setLocation("/expenses");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to log expense.", variant: "destructive" });
    }
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Log New Expense" description="Record a store operational or service expense" />
        <StoreRequiredAlert title="Store Required for Expenses" />
      </div>
    );
  }

  const handleBack = () => {
    setLocation("/expenses");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-2">
        <Link href="/expenses">
          <Button variant="ghost" size="sm" className="w-fit">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Expenses
          </Button>
        </Link>
        <PageHeader title="Log New Expense" description="Record a store operational or service expense" />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => addExpenseMutation.mutate(d))} className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            {/* Form Fields Card */}
            <Card className="xl:col-span-2 shadow-sm border border-border/80">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  Expense Details
                </CardTitle>
                <CardDescription>Fill in the required information to log this expense.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                {currentStore?.id === "all" && (
                  <FormField
                    control={form.control}
                    name="storeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">Target Store Location</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-store">
                              <SelectValue placeholder="Select a branch..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {stores.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Description / Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Office Supplies, Generator Fuel" className="focus-visible:ring-primary" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium">Amount ({storeCurrency})</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0"
                            value={field.value === 0 ? "0" : field.value ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              let cleanVal = val;
                              if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                              field.onChange(cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                            }}
                            className="focus-visible:ring-primary font-medium"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Date
                        </FormLabel>
                        <FormControl>
                          <Input type="date" {...field} className="focus-visible:ring-primary" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {(!selectedInventoryId || selectedInventoryId === "none") && (
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between items-center">
                          <FormLabel className="text-sm font-medium">
                            {isNewCategoryMode ? "New Category Name" : "Category"}
                          </FormLabel>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            className="h-auto p-0 text-xs font-semibold text-primary hover:text-primary/90"
                            onClick={() => {
                              setIsNewCategoryMode(!isNewCategoryMode);
                              field.onChange("");
                              setCustomCategoryName("");
                            }}
                          >
                            {isNewCategoryMode ? "Select Existing" : "+ New Category"}
                          </Button>
                        </div>
                        {isNewCategoryMode ? (
                          <FormControl>
                            <Input 
                              placeholder="e.g. Subscriptions, Advertising, Office" 
                              value={customCategoryName}
                              onChange={(e) => {
                                setCustomCategoryName(e.target.value);
                                field.onChange(e.target.value);
                              }}
                              className="focus-visible:ring-primary"
                            />
                          </FormControl>
                        ) : (
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.filter(c => !c.isSystem).map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* Multi-select product/service linker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Related Services / Products <span className="text-muted-foreground font-normal">(Optional)</span>
                  </label>

                  {/* Selected chips */}
                  {linkedProductIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {linkedProductIds.map(pid => {
                        const p = productGroups.find(g => g.id === pid);
                        return (
                          <Badge key={pid} variant="secondary" className="flex items-center gap-1 pr-1">
                            <span className="text-xs">{p?.name ?? pid}</span>
                            <button
                              type="button"
                              onClick={() => setLinkedProductIds(ids => ids.filter(id => id !== pid))}
                              className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  <Select
                    value=""
                    onValueChange={(val) => {
                      if (val && !linkedProductIds.includes(val))
                        setLinkedProductIds(ids => [...ids, val]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Add a service or product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {productGroups
                        .filter(p => !linkedProductIds.includes(p.id))
                        .map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            <span className="ml-1.5 text-xs text-muted-foreground capitalize">({p.type})</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {linkedProductIds.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-xs font-medium text-muted-foreground">Allocation driver</p>
                      <div className="flex gap-3">
                        {(["count", "revenue"] as const).map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setAllocationDriver(d)}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                              allocationDriver === d
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            {d === "count" ? "By transaction count" : "By revenue generated"}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Cost splits automatically based on how often each service/product is sold in the report period.
                      </p>
                    </div>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Additional Notes
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Invoice numbers, merchant information" className="focus-visible:ring-primary" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Payment Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a payment method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="transfer">Bank Transfer</SelectItem>
                          <SelectItem value="pos">POS / Card</SelectItem>
                          <SelectItem value="split">Split Payment</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Split / Calculations & Action Column */}
            <div className="space-y-6">
              {form.watch("paymentMethod") === "split" && (
                <Card className="border border-border/80 shadow-sm animate-in fade-in duration-200">
                  <CardHeader className="bg-amber-500/5 border-b pb-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Plus className="h-4 w-4 text-amber-600" />
                      Configure Split Outflows
                    </CardTitle>
                    <CardDescription>Allocate how the total amount was distributed.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="flex justify-between items-center text-xs font-semibold p-2.5 bg-muted rounded border border-border/60">
                      <span>Live Outstanding</span>
                      {(() => {
                        const totalAmount = form.watch("amount") || 0;
                        const splitCash = form.watch("splitCash") || 0;
                        const splitTransfer = form.watch("splitTransfer") || 0;
                        const splitPos = form.watch("splitPos") || 0;
                        const allocated = splitCash + splitTransfer + splitPos;
                        const remaining = totalAmount - allocated;
                        
                        if (Math.abs(remaining) < 0.01) {
                          return <span className="text-emerald-600 flex items-center gap-1"><Check className="h-3 w-3" /> Splits Balanced</span>;
                        }
                        return (
                          <span className={remaining > 0 ? "text-amber-600" : "text-rose-600 animate-pulse"}>
                            Remaining: {formatCurrency(remaining)}
                          </span>
                        );
                      })()}
                    </div>
                    
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="splitCash"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium">Cash Outflow</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="0"
                                value={field.value === 0 ? "" : field.value ?? ""}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                className="h-9 text-sm font-mono focus-visible:ring-primary"
                              />
                            </FormControl>
                            <FormMessage className="text-[11px]" />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="splitTransfer"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium">Bank Transfer Outflow</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="0"
                                value={field.value === 0 ? "" : field.value ?? ""}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                className="h-9 text-sm font-mono focus-visible:ring-primary"
                              />
                            </FormControl>
                            <FormMessage className="text-[11px]" />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="splitPos"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium">POS / Card Outflow</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="0"
                                value={field.value === 0 ? "" : field.value ?? ""}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                className="h-9 text-sm font-mono focus-visible:ring-primary"
                              />
                            </FormControl>
                            <FormMessage className="text-[11px]" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Action Card */}
              <Card className="border border-border/80 shadow-sm">
                <CardHeader className="bg-primary/5 border-b pb-4">
                  <CardTitle className="text-sm font-semibold">Expense Summary</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Total Amount:</span>
                      <span className="font-bold text-foreground">{formatCurrency(form.watch("amount") || 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Date:</span>
                      <span className="font-medium text-foreground">{form.watch("date") || "Not set"}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Method:</span>
                      <span className="font-medium text-foreground capitalize">{form.watch("paymentMethod")}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2">
                    <Button type="submit" className="w-full font-semibold shadow-sm" disabled={addExpenseMutation.isPending}>
                      {addExpenseMutation.isPending ? "Saving..." : "Save Expense"}
                    </Button>
                    <Button type="button" variant="outline" className="w-full text-muted-foreground" onClick={handleBack} disabled={addExpenseMutation.isPending}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
