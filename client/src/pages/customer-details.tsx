import { useState, useMemo } from "react";
import { buildSlug, isUUID } from "@/lib/slug";
import { useReturnTo, appendReturnTo } from "@/lib/return-to";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation, useSearch } from "wouter";
import { ArrowLeft, User, Phone, MapPin, Hash, Calendar, Package, Coins, CreditCard, Receipt, AlertCircle, BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { Link } from "wouter";
import type { Customer, TransactionWithRelations } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function CustomerDetails() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { backHref } = useReturnTo("/customers");
  const [match, params] = useRoute("/customers/:id");
  const { currentStore } = useStore();
  const customerId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Duplicate and Merge States
  const [isMergeWizardOpen, setIsMergeWizardOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null);
  const [mergeDuplicate, setMergeDuplicate] = useState<Customer | null>(null);
  const [mergeNameChoice, setMergeNameChoice] = useState<string>("");
  const [mergeAddressChoice, setMergeAddressChoice] = useState<string>("");

  const dismissMutation = useMutation({
    mutationFn: async ({ targetId, duplicateId }: { targetId: string; duplicateId: string }) => {
      const res = await apiRequest("POST", "/api/customers/dismiss-duplicate", { targetId, duplicateId });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      toast({ title: "Duplicates dismissed successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Dismiss Failed", description: err.message || "An error occurred", variant: "destructive" });
    }
  });

  const mergeMutation = useMutation({
    mutationFn: async (payload: { targetId: string; duplicateId: string; customFields: any }) => {
      const res = await apiRequest("POST", "/api/customers/merge", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Profiles merged successfully!" });
      setIsMergeWizardOpen(false);
      setLocation(`/customers/${buildSlug(data.name, data.id)}`);
    },
    onError: (err: any) => {
      toast({ title: "Merge Failed", description: err.message || "An error occurred", variant: "destructive" });
    }
  });

  const handleDismissDuplicate = (targetId: string, duplicateId: string) => {
    dismissMutation.mutate({ targetId, duplicateId });
  };

  // Fetch the full customer list — used for slug resolution, duplicate lookups, and sub-queries
  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  // Resolve slug (e.g. "excellent-bolujo-2fb89fa9") or plain UUID to a Customer from the list.
  // Slug format: "{name-parts}-{first-8-chars-of-uuid}"
  const customer = useMemo(() => {
    if (!customerId) return undefined;
    if (isUUID(customerId)) return customers.find(c => c.id === customerId);
    const prefix = customerId.match(/-([0-9a-f]{8})$/i)?.[1]?.toLowerCase() ?? "";
    return prefix ? customers.find(c => c.id.toLowerCase().startsWith(prefix)) : undefined;
  }, [customerId, customers]);

  // True UUID used for sub-queries that take customerId as a query param (not path param)
  const resolvedCustomerId = customer?.id;

  // Show loading skeleton while the customers list is still fetching
  const customerLoading = customersLoading && !customer;

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/customers", resolvedCustomerId, "transactions"],
    enabled: !!resolvedCustomerId,
  });

  const { data: creditEntries = [], isLoading: creditLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", resolvedCustomerId, "credit-ledger"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/ledger?storeId=${currentStore?.id}&customerId=${resolvedCustomerId}`);
      return res.json();
    },
    enabled: !!resolvedCustomerId && !!currentStore?.id,
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", resolvedCustomerId, "bookings"],
    queryFn: async () => {
      const res = await fetch(`/api/bookings?storeId=${currentStore?.id}&customerId=${resolvedCustomerId}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    },
    enabled: !!resolvedCustomerId && !!currentStore?.id,
  });

  const formatCurrency = (value: number, currency: string = "NGN") => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(value);
  };

  const formatDualCurrency = (value: number) => {
    const storeCurrency = currentStore?.currency || "NGN";
    const primaryAmount = formatCurrency(value, storeCurrency);
    if (storeCurrency === "USD") {
      return primaryAmount;
    }
    const usdRate = 1500;
    const usdAmount = formatCurrency(value / usdRate, "USD");
    return (
      <div className="flex flex-col">
        <span className="font-mono font-medium">{primaryAmount}</span>
        <span className="text-xs text-muted-foreground font-mono">{usdAmount}</span>
      </div>
    );
  };

  const formatDate = (date: string | Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const totalSpent = transactions.reduce(
    (sum, tx) => sum + (tx.checkout?.totalPrice ?? 0),
    0
  );

  const columns = [
    {
      key: "transactionDate",
      header: "Date",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{formatDate(tx.transactionDate)}</span>
        </div>
      ),
    },
    {
      key: "inventory",
      header: "Item",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Package className="h-3 w-3 text-muted-foreground" />
          <div>
            {tx.inventory?.id ? (
              <EntityLink href={`/inventory/${buildSlug(tx.inventory.name, tx.inventory.id)}`}>
                <p className="font-medium text-sm">{tx.inventory.name}</p>
              </EntityLink>
            ) : (
              <p className="font-medium text-sm">{tx.inventory?.name ?? "Unknown"}</p>
            )}
            <Badge variant="outline" className={`text-xs capitalize mt-1 ${
              tx.inventory?.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
              : tx.inventory?.type === "product" ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"
              : tx.inventory?.type === "mixed" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800"
              : ""}`}>
              {tx.inventory?.type ?? "unknown"}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "paymentMethod",
      header: "Payment",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <CreditCard className="h-3 w-3 text-muted-foreground" />
          <Badge variant="secondary" className="capitalize">
            {tx.checkout?.paymentMethod ?? "cash"}
          </Badge>
        </div>
      ),
    },
    {
      key: "checkout",
      header: "Amount",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Coins className="h-3 w-3 text-muted-foreground" />
          {formatDualCurrency(tx.checkout?.totalPrice ?? 0)}
        </div>
      ),
    },
  ];

  if (!match) {
    return null;
  }

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer Details"
          description="View customer information and transactions"
        />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (customerLoading) {
    return (
      <div className="space-y-4 p-6">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer Details"
          description="View customer information and transactions"
          actions={
            <Button variant="outline" onClick={() => setLocation(backHref)} data-testid="button-back">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Customers
            </Button>
          }
        />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Customer not found. They may have been deleted.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const detailTabItems: TabItem[] = [
    {
      value: "transactions",
      label: `Transaction History (${transactions.length})`,
      icon: <Receipt className="h-3.5 w-3.5" />,
    },
    {
      value: "credit",
      label: `Credit Sales Ledger (${creditEntries.length})`,
      icon: <BookOpen className="h-3.5 w-3.5 text-amber-500" />,
    },
    {
      value: "bookings",
      label: `Bookings (${bookings.length})`,
      icon: <Calendar className="h-3.5 w-3.5 text-blue-500" />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Customer details and transaction history`}
        actions={
          <Button variant="outline" onClick={() => setLocation(backHref)} data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Customers
          </Button>
        }
      />

      {customer.duplicateOfId && (
        <Alert className="border-amber-500/35 bg-amber-500/5 text-amber-500 rounded-2xl flex items-center justify-between gap-4 p-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 animate-bounce" />
            <AlertDescription className="text-sm font-medium text-amber-200">
              Possible Duplicate: This profile shares a mobile number with{" "}
              <EntityLink href={`/customers/${customer.duplicateOfId}`} className="underline font-bold hover:text-white">
                {customers.find(c => c.id === customer.duplicateOfId)?.name || "another profile"}
              </EntityLink>.
            </AlertDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/30 hover:bg-amber-500/10 text-amber-500 hover:text-amber-400 font-bold text-xs h-8 px-3 rounded-full"
              onClick={() => {
                const dup = customers.find(c => c.id === customer.duplicateOfId);
                if (dup) {
                  setMergeTarget(customer);
                  setMergeDuplicate(dup);
                  setMergeNameChoice(customer.name);
                  setMergeAddressChoice(customer.address || "");
                  setIsMergeWizardOpen(true);
                }
              }}
            >
              Review & Merge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-500 hover:text-amber-400 font-medium text-xs h-8 px-3 rounded-full"
              onClick={() => handleDismissDuplicate(customer.id, customer.duplicateOfId!)}
              disabled={dismissMutation.isPending}
            >
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Hash className="h-3 w-3" />
                Customer ID
              </p>
              <p className="font-mono text-sm font-medium" data-testid="text-customer-number">
                {customer.customerNumber}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                Phone
              </p>
              <p className="text-sm" data-testid="text-customer-phone">
                {formatPhoneDisplay(customer.mobileNumber || "", customer.countryCode || "")}
              </p>
            </div>
            {customer.address && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Address
                </p>
                <p className="text-sm" data-testid="text-customer-address">
                  {customer.address}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Last Updated
              </p>
              <p className="text-sm" data-testid="text-customer-updated-at">
                {formatDate(customer.updatedAt)}
              </p>
            </div>
            <div className="pt-2">
              <Badge variant={customer.isArchived ? "secondary" : "default"}>
                {customer.isArchived ? "Archived" : "Active"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <MetricGrid>
            <MetricCard
              title="Total Transactions"
              value={transactions.length}
              icon={<Receipt className="h-4 w-4" />}
            />
            <MetricCard
              title="Total Spent"
              value={formatCurrency(totalSpent, currentStore?.currency || "NGN")}
              compactValue={formatCurrencyCompact(totalSpent, currentStore?.currency || "NGN")}
              icon={<Coins className="h-4 w-4" />}
            />
          </MetricGrid>

          <Card className="glassmorphism border border-border/80">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                <Receipt className="h-4 w-4 text-primary" />
                Customer Logs & Activities
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <Tabs defaultValue="transactions" className="w-full">
                <PolymorphicTabsList tabs={detailTabItems} variant="default" className="mb-6" />

                <TabsContent value="transactions" className="space-y-4">
                  {transactionsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : transactions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center bg-background/50 rounded-lg border border-dashed border-border p-6">
                      <Receipt className="h-10 w-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No transactions found for this customer
                      </p>
                    </div>
                  ) : (
                    <DataTable
                      columns={columns}
                      data={transactions}
                      onRowClick={(tx) => setLocation(appendReturnTo(`/transactions/${tx.id}`, location, search))}
                    />
                  )}
                </TabsContent>

                <TabsContent value="credit" className="space-y-4">
                  {creditLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : creditEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center bg-background/50 rounded-lg border border-dashed border-border p-6">
                      <BookOpen className="h-10 w-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No active or past credit records found in Credit Sales.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-background overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table className="min-w-[800px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Receipt / Date</TableHead>
                              <TableHead className="text-right">Owed</TableHead>
                              <TableHead className="text-right">Paid Back</TableHead>
                              <TableHead className="text-right">Outstanding</TableHead>
                              <TableHead>Due Date</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {creditEntries.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span
                                      className={`font-semibold text-xs text-primary ${entry.transactionId ? "cursor-pointer hover:underline" : ""}`}
                                      onClick={() => {
                                        if (!entry.transactionId) return;
                                        setLocation(appendReturnTo(`/transactions/${entry.transactionId}`, location, search));
                                      }}
                                    >
                                      {entry.receiptNumber ? `#${entry.receiptNumber}` : "Standalone"}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {new Date(entry.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium text-xs">
                                  ₦{entry.amountOwed.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-medium text-xs text-emerald-600">
                                  ₦{(entry.amountPaidUpfront + (entry.totalRepayments || 0)).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right font-bold text-xs text-amber-500">
                                  ₦{entry.outstandingBalance.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {entry.dueDate ? (
                                    <span>{new Date(entry.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span>
                                  ) : (
                                    <span className="text-muted-foreground">None</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      entry.status === "settled" ? "outline" :
                                      entry.status === "overdue" ? "destructive" :
                                      entry.status === "written_off" ? "secondary" : "default"
                                    }
                                    className={`text-[10px] py-0 px-1.5 font-semibold ${
                                      entry.status === "settled" ? "border-emerald-500 text-emerald-500 bg-emerald-500/5" :
                                      entry.status === "owing" ? "border-amber-500 text-amber-500 bg-amber-500/5" :
                                      entry.status === "partial" ? "border-blue-500 text-blue-500 bg-blue-500/5" :
                                      entry.status === "written_off" ? "border-rose-500 text-rose-500 bg-rose-500/5" : ""
                                    }`}
                                  >
                                    {
                                      entry.status === "written_off" ? "Written Off" :
                                      entry.status === "owing" ? "Owing" :
                                      entry.status === "partial" ? "Partial" :
                                      entry.status === "overdue" ? "Overdue" :
                                      entry.status === "settled" ? "Settled" : entry.status
                                    }
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="bookings" className="space-y-4">
                  {bookingsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : bookings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center bg-background/50 rounded-lg border border-dashed border-border p-6">
                      <Calendar className="h-10 w-10 text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No bookings found for this customer.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-background overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table className="min-w-[800px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Reference</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Date & Time</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bookings.map((booking: any) => (
                              <TableRow key={booking.id}>
                                <TableCell className="font-medium text-primary">
                                  {booking.bookingRef}
                                </TableCell>
                                <TableCell className="capitalize">{booking.type}</TableCell>
                                <TableCell>
                                  {new Intl.DateTimeFormat("en-US", {
                                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                                  }).format(new Date(booking.scheduledAt))}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary" className="capitalize">
                                    {booking.status.replace("_", " ")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link href={appendReturnTo(`/bookings/${booking.id}`, location, search)}>View</Link>
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isMergeWizardOpen} onOpenChange={setIsMergeWizardOpen}>
        <DialogContent className="max-w-2xl bg-slate-900 border border-slate-800 text-white rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
              Merge Customer Profiles
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Combine transactions, bookings, credit ledgers, and loyalty points. This action is permanent.
            </DialogDescription>
          </DialogHeader>

          {mergeTarget && mergeDuplicate && (
            <div className="space-y-6 pt-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <table className="w-full text-xs text-slate-300">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase tracking-widest text-[10px]">
                      <th className="text-left pb-2 w-1/3">Field</th>
                      <th className="text-left pb-2 w-1/3">Surviving Profile (Target)</th>
                      <th className="text-left pb-2 w-1/3">Duplicate Profile (Retired)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900 font-medium">
                    <tr className="h-10">
                      <td className="text-slate-400">Name</td>
                      <td className={cn(mergeNameChoice === mergeTarget.name ? "text-primary font-bold" : "")}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="mergeName"
                            checked={mergeNameChoice === mergeTarget.name}
                            onChange={() => setMergeNameChoice(mergeTarget.name)}
                            className="accent-primary text-primary"
                          />
                          {mergeTarget.name}
                        </label>
                      </td>
                      <td className={cn(mergeNameChoice === mergeDuplicate.name ? "text-primary font-bold" : "")}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="mergeName"
                            checked={mergeNameChoice === mergeDuplicate.name}
                            onChange={() => setMergeNameChoice(mergeDuplicate.name)}
                            className="accent-primary text-primary"
                          />
                          {mergeDuplicate.name}
                        </label>
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="text-slate-400">Phone</td>
                      <td>{mergeTarget.mobileNumber || "—"}</td>
                      <td>{mergeDuplicate.mobileNumber || "—"}</td>
                    </tr>
                    <tr className="h-10">
                      <td className="text-slate-400">Address</td>
                      <td className={cn(mergeAddressChoice === mergeTarget.address ? "text-primary font-bold" : "")}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="mergeAddress"
                            checked={mergeAddressChoice === mergeTarget.address}
                            onChange={() => setMergeAddressChoice(mergeTarget.address || "")}
                            className="accent-primary text-primary"
                          />
                          <span className="truncate max-w-[150px] inline-block align-middle" title={mergeTarget.address}>{mergeTarget.address || "—"}</span>
                        </label>
                      </td>
                      <td className={cn(mergeAddressChoice === mergeDuplicate.address ? "text-primary font-bold" : "")}>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="mergeAddress"
                            checked={mergeAddressChoice === mergeDuplicate.address}
                            onChange={() => setMergeAddressChoice(mergeDuplicate.address || "")}
                            className="accent-primary text-primary"
                          />
                          <span className="truncate max-w-[150px] inline-block align-middle" title={mergeDuplicate.address}>{mergeDuplicate.address || "—"}</span>
                        </label>
                      </td>
                    </tr>
                    <tr className="h-10">
                      <td className="text-slate-400">Loyalty Points</td>
                      <td className="text-emerald-500 font-bold">{mergeTarget.loyaltyPoints} pts</td>
                      <td className="text-emerald-500 font-bold">{mergeDuplicate.loyaltyPoints} pts</td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-emerald-400 font-bold flex justify-between">
                  <span>Points Consolidated Result:</span>
                  <span>{Number(mergeTarget.loyaltyPoints || 0) + Number(mergeDuplicate.loyaltyPoints || 0)} pts</span>
                </div>
              </div>

              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 space-y-2">
                <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">⚠️ Important Merge Implications:</p>
                <ul className="text-xs text-slate-200 list-disc pl-4 space-y-1">
                  <li>All appointment/order bookings will be transferred to the Surviving Profile.</li>
                  <li>All POS sales ledgers and transaction history will be consolidated.</li>
                  <li>Any active Credit Sales outstanding debt ledger records will be unified.</li>
                  <li>The Duplicate Profile will be archived/retired and cannot be logged into.</li>
                </ul>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  className="rounded-full text-slate-400 hover:text-white"
                  onClick={() => setIsMergeWizardOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="rounded-full font-bold shadow-md"
                  onClick={() => {
                    mergeMutation.mutate({
                      targetId: mergeTarget.id,
                      duplicateId: mergeDuplicate.id,
                      customFields: {
                        name: mergeNameChoice,
                        address: mergeAddressChoice,
                      }
                    });
                  }}
                  disabled={mergeMutation.isPending}
                >
                  {mergeMutation.isPending ? "Merging..." : "Confirm & Merge"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
