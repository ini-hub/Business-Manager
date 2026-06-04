import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as fmt } from "@/lib/currency-utils";
import type { ExpenseCategory, Inventory } from "@shared/schema";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  amount: z.coerce.number().min(0),
  categoryId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
  inventoryId: z.string().optional().nullable(),
  paymentMethod: z.string().default("cash"),
  splitCash: z.coerce.number().min(0).default(0),
  splitTransfer: z.coerce.number().min(0).default(0),
  splitPos: z.coerce.number().min(0).default(0),
}).superRefine((d, ctx) => {
  const linked = d.inventoryId && d.inventoryId !== "none";
  if (!linked && (!d.categoryId || !d.categoryId.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "Category is required" });
  }
  if (d.paymentMethod === "split") {
    const total = (d.splitCash || 0) + (d.splitTransfer || 0) + (d.splitPos || 0);
    if (Math.abs(total - d.amount) > 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["splitCash"], message: `Splits (${total}) must equal total (${d.amount})` });
    }
  }
});

type FormValues = z.infer<typeof schema>;

export default function ExpenseEditPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();
  const currency = currentStore?.currency || "NGN";

  const [isNewCategoryMode, setIsNewCategoryMode] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const { data: expense, isLoading } = useQuery<any>({
    queryKey: ["/api/expenses", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/expenses/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ["/api/expense-categories", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/expense-categories?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", amount: 0, date: "", notes: "", paymentMethod: "cash", splitCash: 0, splitTransfer: 0, splitPos: 0 },
  });

  useEffect(() => {
    if (expense) {
      const splits = (expense as any).splitPayments || [];
      form.reset({
        title: expense.title,
        amount: expense.amount,
        categoryId: expense.categoryId || "",
        date: expense.date,
        notes: expense.notes || "",
        inventoryId: expense.inventoryId || "none",
        paymentMethod: (expense as any).paymentMethod || "cash",
        splitCash: splits.find((p: any) => p.method === "cash")?.amount || 0,
        splitTransfer: splits.find((p: any) => p.method === "transfer")?.amount || 0,
        splitPos: splits.find((p: any) => p.method === "pos")?.amount || 0,
      });
    }
  }, [expense, form]);

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/expense-categories", { name, storeId: currentStore!.id });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const isLinked = data.inventoryId && data.inventoryId !== "none";
      let catId = data.categoryId;

      if (!isLinked && isNewCategoryMode) {
        if (!newCategoryName.trim()) throw new Error("Enter a category name.");
        const existing = categories.find((c) => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
        catId = existing ? existing.id : (await addCategoryMutation.mutateAsync(newCategoryName.trim())).id;
      } else if (isLinked) {
        catId = categories.find((c) => !(c as any).isSystem)?.id || categories[0]?.id || "";
      }

      const splitPayments =
        data.paymentMethod === "split"
          ? [
              { method: "cash", amount: data.splitCash || 0 },
              { method: "transfer", amount: data.splitTransfer || 0 },
              { method: "pos", amount: data.splitPos || 0 },
            ].filter((p) => p.amount > 0)
          : null;

      await apiRequest("PATCH", `/api/expenses/${id}`, {
        title: data.title, amount: data.amount, categoryId: catId,
        date: data.date, notes: data.notes,
        inventoryId: data.inventoryId === "none" ? null : data.inventoryId,
        storeId: currentStore!.id, paymentMethod: data.paymentMethod, splitPayments,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense updated" });
      setLocation("/expenses");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading…</div>;

  const watchMethod = form.watch("paymentMethod");
  const watchInvId = form.watch("inventoryId");
  const watchAmount = form.watch("amount") || 0;
  const isLinked = watchInvId && watchInvId !== "none";

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="Edit Expense"
        actions={
          <Button variant="outline" onClick={() => setLocation("/expenses")}>
            <ChevronLeft className="h-4 w-4 mr-1" />Back to Expenses
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => updateMutation.mutate(d))} className="space-y-5">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description / Title</FormLabel>
                  <FormControl><Input {...field} autoFocus /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount ({currency})</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="date" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {!isLinked && (
                <FormField control={form.control} name="categoryId" render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center">
                      <FormLabel>Category</FormLabel>
                      <button type="button" className="text-xs text-primary hover:underline"
                        onClick={() => { setIsNewCategoryMode((v) => !v); field.onChange(""); setNewCategoryName(""); }}>
                        {isNewCategoryMode ? "Select existing" : "+ New category"}
                      </button>
                    </div>
                    {isNewCategoryMode ? (
                      <FormControl>
                        <Input placeholder="e.g. Subscriptions"
                          value={newCategoryName}
                          onChange={(e) => { setNewCategoryName(e.target.value); field.onChange(e.target.value); }} />
                      </FormControl>
                    ) : (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories.filter((c) => !(c as any).isSystem).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={form.control} name="inventoryId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Linked Service / Product (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || "none"}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {inventoryItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} ({i.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
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
              )} />

              {watchMethod === "split" && (
                <div className="p-4 bg-muted/40 rounded-lg space-y-3 border border-dashed">
                  <div className="grid grid-cols-3 gap-2">
                    {(["splitCash", "splitTransfer", "splitPos"] as const).map((f, i) => (
                      <FormField key={f} control={form.control} name={f} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">{["Cash", "Transfer", "POS"][i]}</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" className="h-8 text-xs font-mono"
                              placeholder="0"
                              value={field.value === 0 ? "" : field.value}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                          </FormControl>
                          <FormMessage className="text-[9px]" />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  {(() => {
                    const s = (form.watch("splitCash") || 0) + (form.watch("splitTransfer") || 0) + (form.watch("splitPos") || 0);
                    const diff = watchAmount - s;
                    return Math.abs(diff) < 0.01
                      ? <p className="text-xs text-emerald-600">✓ Balanced</p>
                      : <p className="text-xs text-amber-600">Remaining: {fmt(diff, currency)}</p>;
                  })()}
                </div>
              )}

              <Separator />
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => setLocation("/expenses")}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Updating…" : "Update Expense"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
