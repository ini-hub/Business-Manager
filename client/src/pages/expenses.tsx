import { useState } from "react";
import { Link, useLocation } from "wouter";
import { buildSlug } from "@/lib/slug";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Settings2, Trash2, Wallet, Receipt, Filter, Edit, Calendar, Banknote } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter } from "@/components/date-range-filter";
import { BulkExpenseImport } from "@/components/bulk-expense-import";
import { endOfDay, startOfDay, startOfMonth, format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import type { ExpenseWithCategory, ExpenseCategory, Inventory } from "@shared/schema";

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

export default function ExpensesPage() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const storeCurrency = currentStore?.currency || "NGN";
  
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date())
  });

  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isEditExpenseOpen, setIsEditExpenseOpen] = useState(false);
  const [isNewCategoryMode, setIsNewCategoryMode] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [isEditNewCategoryMode, setIsEditNewCategoryMode] = useState(false);
  const [editCustomCategoryName, setEditCustomCategoryName] = useState("");
  const [expenseToEdit, setExpenseToEdit] = useState<ExpenseWithCategory | null>(null);
  const [filterType, setFilterType] = useState<"all" | "general" | "linked">("all");
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<ExpenseCategory | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<ExpenseWithCategory | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryNameInput, setEditCategoryNameInput] = useState("");

  const { data: expenses = [], isLoading: isLoadingExpenses } = useQuery<ExpenseWithCategory[]>({
    queryKey: [
      "/api/expenses", 
      currentStore?.id,
      stores.map(s => s.id).join(","),
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const params = new URLSearchParams({ storeId: s.id });
              if (dateRange?.from) params.append("startDate", dateRange.from.toISOString().split('T')[0]);
              if (dateRange?.to) params.append("endDate", dateRange.to.toISOString().split('T')[0]);
              const res = await fetch(`/api/expenses?${params.toString()}`);
              if (!res.ok) return [];
              const list = await res.json() as ExpenseWithCategory[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", dateRange.from.toISOString().split('T')[0]);
      if (dateRange?.to) params.append("endDate", dateRange.to.toISOString().split('T')[0]);
      const res = await apiRequest("GET", `/api/expenses?${params.toString()}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ["/api/expense-categories", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/expense-categories?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as ExpenseCategory[];
              return list.map(item => ({ ...item, storeName: s.name }));
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

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      title: "",
      amount: 0,
      categoryId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      inventoryId: null,
      paymentMethod: "cash",
      splitCash: 0,
      splitTransfer: 0,
      splitPos: 0,
    },
  });

  const editForm = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      title: "",
      amount: 0,
      categoryId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      inventoryId: null,
      paymentMethod: "cash",
      splitCash: 0,
      splitTransfer: 0,
      splitPos: 0,
    },
  });

  const selectedInventoryId = form.watch("inventoryId");
  const editSelectedInventoryId = editForm.watch("inventoryId");

  const [newCategoryName, setNewCategoryName] = useState("");

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
        splitPayments
      };
      await apiRequest("POST", "/api/expenses", submissionData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss/summary"] });
      setIsAddExpenseOpen(false);
      setIsNewCategoryMode(false);
      setCustomCategoryName("");
      form.reset();
      toast({ title: "Success", description: "Expense added successfully." });
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: async (data: ExpenseFormValues & { id: string }) => {
      const isLinked = data.inventoryId && data.inventoryId !== "none";
      let catId = data.categoryId;

      if (!isLinked && isEditNewCategoryMode) {
        if (!editCustomCategoryName.trim()) {
          throw new Error("Please enter a category name.");
        }
        const existingCat = categories.find(
          c => c.name.toLowerCase() === editCustomCategoryName.trim().toLowerCase()
        );
        if (existingCat) {
          catId = existingCat.id;
        } else {
          const newCat = await addCategoryMutation.mutateAsync(editCustomCategoryName.trim());
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
        storeId: currentStore!.id,
        paymentMethod: data.paymentMethod,
        splitPayments
      };
      await apiRequest("PATCH", `/api/expenses/${data.id}`, submissionData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss/summary"] });
      setIsEditExpenseOpen(false);
      setExpenseToEdit(null);
      setIsEditNewCategoryMode(false);
      setEditCustomCategoryName("");
      toast({ title: "Success", description: "Expense updated successfully." });
    },
  });

  const handleEditClick = (e: ExpenseWithCategory) => setLocation(`/expenses/${buildSlug(e.title, e.id)}/edit`);

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/expense-categories", { name, storeId: currentStore!.id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      setNewCategoryName("");
      toast({ title: "Success", description: "Category created." });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async (data: { id: string, name: string }) => {
      const res = await apiRequest("PATCH", `/api/expense-categories/${data.id}`, { name: data.name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      setEditingCategoryId(null);
      setEditCategoryNameInput("");
      toast({ title: "Success", description: "Category updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update category.", variant: "destructive" });
    }
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss/summary"] });
      toast({ title: "Success", description: "Expense deleted." });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expense-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      toast({ title: "Success", description: "Category deleted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Cannot delete category that is in use.", variant: "destructive" });
    }
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const filteredExpenses = expenses.filter((e) => {
    if (filterType === "general") return !e.inventoryId;
    if (filterType === "linked") return !!e.inventoryId;
    return true;
  });

  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (e: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {e.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "date",
      header: "Date",
      render: (e: ExpenseWithCategory) => <span className="font-mono text-sm">{e.date}</span>,
    },
    {
      key: "title",
      header: "Description",
      render: (e: ExpenseWithCategory) => (
        <div>
          <p className="font-medium">{e.title}</p>
          <div className="flex items-center gap-1 mt-1">
            {e.inventory && (
              <Badge variant="secondary" className="text-[10px] h-4">
                {e.inventory.name}
              </Badge>
            )}
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{e.notes}</p>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (e: ExpenseWithCategory) => (
        <Badge variant="outline" className={e.category.isSystem ? "bg-amber-50" : ""}>
          {e.category.name}
        </Badge>
      ),
    },
    {
      key: "paymentMethod",
      header: "Payment Method",
      render: (e: ExpenseWithCategory) => {
        const method = (e as any).paymentMethod || "cash";
        
        if (method === "split" && (e as any).splitPayments) {
          const splits = (e as any).splitPayments as Array<{method: string, amount: number}>;
          const splitLabel = splits.map(s => `${s.method.toUpperCase()}: ${formatCurrency(s.amount)}`).join(", ");
          return (
            <Badge variant="outline" className="capitalize cursor-help" title={splitLabel}>
              Split ℹ️
            </Badge>
          );
        }

        const methodMap: Record<string, string> = {
          cash: "Cash",
          transfer: "Transfer",
          pos: "POS / Card"
        };

        return (
          <Badge variant="secondary" className="capitalize">
            {methodMap[method] || method}
          </Badge>
        );
      }
    },
    {
      key: "amount",
      header: "Amount",
      render: (e: ExpenseWithCategory) => (
        <span className="font-mono font-medium">{formatCurrency(e.amount)}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (e: ExpenseWithCategory) => {
        const canEdit = ["owner", "manager"].includes(user?.role || "");
        const canDelete = user?.role === "owner";
        
        if (e.isAutoGenerated) {
          return <Badge variant="secondary" className="text-[10px]">Auto</Badge>;
        }

        return (
          <div className="flex items-center gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleEditClick(e)}
                title="Edit expense"
              >
                <Edit className="h-4 w-4 text-blue-500" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpenseToDelete(e)}
                title="Delete expense"
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Expenses" description="Track operational costs and overhead" />
        <StoreRequiredAlert title="Store Required for Expenses" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track operational costs and overhead"
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <BulkExpenseImport categories={categories} />
            <Select value={filterType} onValueChange={(val: any) => setFilterType(val)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Expenses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Expenses</SelectItem>
                <SelectItem value="general">General OPEX</SelectItem>
                <SelectItem value="linked">Linked (Sustaining)</SelectItem>
              </SelectContent>
            </Select>
            <DateRangeFilter dateRange={dateRange ?? { from: undefined, to: undefined }} onDateRangeChange={(r) => setDateRange(r.from && r.to ? { from: r.from, to: r.to } : undefined)} />
            
            {user?.role === "owner" && (
              <Button variant="outline" onClick={() => setLocation("/expenses/categories")}>
                <Settings2 className="mr-2 h-4 w-4" /> Categories
              </Button>
            )}

            <Link href="/expenses/new">
              <Button><Plus className="mr-2 h-4 w-4" /> Add Expense</Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Expenses"
          value={formatCurrency(totalExpenses)}
          icon={<Wallet className="h-4 w-4" />}
          description={dateRange?.from && dateRange?.to ? `Period: ${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}` : "All time"}
          isLoading={isLoadingExpenses}
        />
        <MetricCard
          title="Transaction Count"
          value={filteredExpenses.length}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoadingExpenses}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense History</CardTitle>
          <CardDescription>A complete log of business expenditures</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const tableData = filteredExpenses.map((e) => ({
              ...e,
              categoryName: e.category.name,
              linkedTo: e.inventory ? e.inventory.name : "General",
              loggedBy: e.isAutoGenerated ? "System" : "Owner"
            }));

            const filterConfigs = [
              { key: "categoryName", label: "Category", type: "select" as const },
              { key: "linkedTo", label: "Linked To", type: "select" as const },
              { key: "loggedBy", label: "Logged By", type: "select" as const },
              { key: "amount", label: "Amount", type: "range" as const, currencySymbol: storeCurrency === "USD" ? "$" : "₦" }
            ];

            return (
              <DataTable
                data={tableData}
                columns={columns}
                searchable
                searchPlaceholder="Search descriptions..."
                searchKeys={["title", "notes"]}
                isLoading={isLoadingExpenses}
                emptyTitle="No Expenses"
                emptyMessage="No expenses recorded for this period. Log overheads, salaries, and operational costs to track profitability."
                emptyIcon={<Banknote className="h-6 w-6" />}
                emptyAction={
                  <Button size="sm" className="gap-2" onClick={() => setLocation("/expenses/new")}>
                    <Plus className="h-4 w-4" />Log Expense
                  </Button>
                }
                filterConfigs={filterConfigs}
              />
            );
          })()}
        </CardContent>
      </Card>

      <AlertDialog open={!!categoryToDelete} onOpenChange={(open) => !open && setCategoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the category "{categoryToDelete?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (categoryToDelete) {
                  deleteCategoryMutation.mutate(categoryToDelete.id);
                  setCategoryToDelete(null);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!expenseToDelete} onOpenChange={(open) => !open && setExpenseToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the expense "{expenseToDelete?.title}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (expenseToDelete) {
                  deleteExpenseMutation.mutate(expenseToDelete.id);
                  setExpenseToDelete(null);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Expense Dialog - REMOVED: now at /expenses/:id/edit */}
      {false && <Form {...editForm}>
            <form className="space-y-4 pt-4">
              <FormField
                control={editForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description / Title</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Office Supplies" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount ({storeCurrency})</FormLabel>
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
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {(!editSelectedInventoryId || editSelectedInventoryId === "none") && (
                <FormField
                  control={editForm.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center">
                        <FormLabel>{isEditNewCategoryMode ? "New Category Name" : "Category"}</FormLabel>
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            setIsEditNewCategoryMode(!isEditNewCategoryMode);
                            field.onChange("");
                            setEditCustomCategoryName("");
                          }}
                        >
                          {isEditNewCategoryMode ? "Select Existing" : "+ New Category"}
                        </Button>
                      </div>
                      {isEditNewCategoryMode ? (
                        <FormControl>
                          <Input 
                            placeholder="e.g. Subscriptions, Advertising, Office" 
                            value={editCustomCategoryName}
                            onChange={(e) => {
                              setEditCustomCategoryName(e.target.value);
                              field.onChange(e.target.value);
                            }}
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
              <FormField
                control={editForm.control}
                name="inventoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Related Service / Product (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an item" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {inventoryItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Notes</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Method</FormLabel>
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

              {editForm.watch("paymentMethod") === "split" && (
                <div className="p-4 bg-muted/40 rounded-lg space-y-4 border border-dashed animate-in fade-in duration-200">
                  <div className="flex justify-between items-center text-xs font-semibold text-muted-foreground">
                    <span>Split Breakdown</span>
                    {(() => {
                      const totalAmount = editForm.watch("amount") || 0;
                      const splitCash = editForm.watch("splitCash") || 0;
                      const splitTransfer = editForm.watch("splitTransfer") || 0;
                      const splitPos = editForm.watch("splitPos") || 0;
                      const allocated = splitCash + splitTransfer + splitPos;
                      const remaining = totalAmount - allocated;
                      
                      if (Math.abs(remaining) < 0.01) {
                        return <span className="text-emerald-600">✓ Splits Balanced</span>;
                      }
                      return (
                        <span className={remaining > 0 ? "text-amber-600" : "text-rose-600"}>
                          Remaining: {formatCurrency(remaining)}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <FormField
                      control={editForm.control}
                      name="splitCash"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px]">Cash Portion</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              value={field.value === 0 ? "" : field.value ?? ""}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs font-mono"
                            />
                          </FormControl>
                          <FormMessage className="text-[9px]" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="splitTransfer"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px]">Transfer Portion</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              value={field.value === 0 ? "" : field.value ?? ""}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs font-mono"
                            />
                          </FormControl>
                          <FormMessage className="text-[9px]" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="splitPos"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px]">POS Portion</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="0"
                              value={field.value === 0 ? "" : field.value ?? ""}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs font-mono"
                            />
                          </FormControl>
                          <FormMessage className="text-[9px]" />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={updateExpenseMutation.isPending}>
                {updateExpenseMutation.isPending ? "Updating..." : "Update Expense"}
              </Button>
            </form>
          </Form>}

      {user?.role !== "staff" && (
        <SpeedDialFAB
          actions={[
            {
              label: "Add Expense",
              icon: <Receipt className="h-5 w-5" />,
              onClick: () => setLocation("/expenses/new"),
              testId: "fab-add-expense",
            },
            {
              label: "Categories",
              icon: <Settings2 className="h-5 w-5" />,
              onClick: () => setLocation("/expenses/categories"),
              testId: "fab-expense-categories",
            },
          ]}
        />
      )}
    </div>
  );
}
