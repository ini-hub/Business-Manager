import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Settings2, Trash2, Wallet, Receipt, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter } from "@/components/date-range-filter";
import { endOfDay, startOfMonth, format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import type { ExpenseWithCategory, ExpenseCategory } from "@shared/schema";

const expenseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  amount: z.coerce.number().min(0, "Amount must be positive"),
  categoryId: z.string().min(1, "Category is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

export default function ExpensesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";
  
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date())
  });

  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);

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

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      title: "",
      amount: 0,
      categoryId: "",
      date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
    },
  });

  const [newCategoryName, setNewCategoryName] = useState("");

  const addExpenseMutation = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      await apiRequest("POST", "/api/expenses", { ...data, storeId: currentStore!.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss/summary"] });
      setIsAddExpenseOpen(false);
      form.reset();
      toast({ title: "Success", description: "Expense added successfully." });
    },
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("POST", "/api/expense-categories", { name, storeId: currentStore!.id });
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

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

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
          <p className="text-xs text-muted-foreground truncate max-w-[200px]">{e.notes}</p>
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
      render: (e: ExpenseWithCategory) => (
        user?.role === "owner" && !e.isAutoGenerated ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm("Are you sure you want to delete this expense?")) {
                deleteExpenseMutation.mutate(e.id);
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        ) : (
          e.isAutoGenerated && <Badge variant="secondary" className="text-[10px]">Auto</Badge>
        )
      ),
    },
  ];

  if (!currentStore) {
    return <div className="p-8 text-center text-muted-foreground">Select a store first</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track operational costs and overhead"
        actions={
          <div className="flex gap-2 items-center">
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
                                if (confirm("Delete this category?")) {
                                  deleteCategoryMutation.mutate(c.id);
                                }
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
                    <FormField
                      control={form.control}
                      name="categoryId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          value={expenses.length}
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
            data={expenses}
            columns={columns}
            searchable
            searchPlaceholder="Search descriptions..."
            searchKeys={["title", "notes"]}
            isLoading={isLoadingExpenses}
            emptyMessage="No expenses recorded for this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}
