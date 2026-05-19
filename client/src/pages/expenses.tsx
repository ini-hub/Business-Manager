import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Settings2, Trash2, Wallet, Receipt, Filter, Edit, Calendar } from "lucide-react";
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
}).superRefine((data, ctx) => {
  const isLinked = data.inventoryId && data.inventoryId !== "none";
  if (!isLinked && (!data.categoryId || data.categoryId.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["categoryId"],
      message: "Category is required for general operational expenses",
    });
  }
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

export default function ExpensesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
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

  const { data: expenses = [], isLoading: isLoadingExpenses } = useQuery<ExpenseWithCategory[]>({
    queryKey: [
      "/api/expenses", 
      currentStore?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", dateRange.from.toISOString().split('T')[0]);
      if (dateRange?.to) params.append("endDate", dateRange.to.toISOString().split('T')[0]);
      const res = await apiRequest("GET", `/api/expenses?${params.toString()}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
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

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      title: "",
      amount: 0,
      categoryId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      inventoryId: null,
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

      const submissionData = {
        ...data,
        storeId: currentStore!.id,
        inventoryId: data.inventoryId === "none" ? null : data.inventoryId,
        categoryId: catId
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

      const submissionData = {
        ...data,
        storeId: currentStore!.id,
        inventoryId: data.inventoryId === "none" ? null : data.inventoryId,
        categoryId: catId
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

  const handleEditClick = (e: ExpenseWithCategory) => {
    setExpenseToEdit(e);
    setIsEditNewCategoryMode(false);
    setEditCustomCategoryName("");
    editForm.reset({
      title: e.title,
      amount: e.amount,
      categoryId: e.categoryId,
      date: e.date,
      notes: e.notes || "",
      inventoryId: e.inventoryId || "none",
    });
    setIsEditExpenseOpen(true);
  };

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
              <Dialog open={isManageCategoriesOpen} onOpenChange={setIsManageCategoriesOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline"><Settings2 className="mr-2 h-4 w-4" /> Categories</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Manage Expense Categories</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="New category name..."
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                      />
                      <Button
                        onClick={() => addCategoryMutation.mutate(newCategoryName)}
                        disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
                      >
                        Add
                      </Button>
                    </div>
                    <div className="space-y-2 mt-4 max-h-64 overflow-y-auto pr-2">
                      {categories.map((c) => (
                        <div key={c.id} className="flex justify-between items-center p-2 rounded-md border">
                          <span className="font-medium flex items-center gap-2">
                            {c.name}
                            {c.isSystem && <Badge variant="secondary" className="text-[10px]">System</Badge>}
                          </span>
                          {!c.isSystem && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setCategoryToDelete(c);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            <Dialog open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" /> Add Expense</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Log New Expense</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((d) => addExpenseMutation.mutate(d))} className="space-y-4 pt-4">
                    <FormField
                      control={form.control}
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
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Amount ({storeCurrency})</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
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
                    {(!selectedInventoryId || selectedInventoryId === "none") && (
                      <FormField
                        control={form.control}
                        name="categoryId"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex justify-between items-center">
                              <FormLabel>{isNewCategoryMode ? "New Category Name" : "Category"}</FormLabel>
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                className="h-auto p-0 text-xs font-semibold text-blue-600 hover:text-blue-700"
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
                      control={form.control}
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
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Additional Notes</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={addExpenseMutation.isPending}>
                      Save Expense
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
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
          <DataTable
            data={filteredExpenses}
            columns={columns}
            searchable
            searchPlaceholder="Search descriptions..."
            searchKeys={["title", "notes"]}
            isLoading={isLoadingExpenses}
            emptyMessage="No expenses recorded for this period."
          />
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

      {/* Edit Expense Dialog */}
      <Dialog open={isEditExpenseOpen} onOpenChange={setIsEditExpenseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => {
              if (expenseToEdit) {
                updateExpenseMutation.mutate({ ...d, id: expenseToEdit.id });
              }
            })} className="space-y-4 pt-4">
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
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
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
              <Button type="submit" className="w-full" disabled={updateExpenseMutation.isPending}>
                {updateExpenseMutation.isPending ? "Updating..." : "Update Expense"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
