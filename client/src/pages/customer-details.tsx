import { useState, useMemo } from "react";
import { buildSlug, isUUID } from "@/lib/slug";
import { useReturnTo, appendReturnTo } from "@/lib/return-to";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation, useSearch } from "wouter";
import { ArrowLeft, Phone, MapPin, Calendar, Coins, Receipt, AlertCircle, BookOpen, MoreVertical, Edit, Archive, RotateCcw, PhoneCall, MessageCircle, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { normalizePhoneForStorage } from "@shared/phone-utils";
import { getCustomerInitials, formatRelativeDate, groupByDay, deriveTransactionStatus } from "@/lib/customer-detail-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { Link } from "wouter";
import type { Customer, TransactionWithRelations } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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

  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Customer archived successfully" });
      setIsArchiveConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Archive Customer", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/customers/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Customer restored successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Restore Customer", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

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

  if (!match) {
    return null;
  }

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer Details"
          description="View customer information and transactions"
          compact
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
          compact
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
      label: "Transactions",
      icon: <Receipt className="h-3.5 w-3.5" />,
      badge: transactions.length > 0 ? transactions.length : undefined,
    },
    {
      value: "credit",
      label: "Credit",
      icon: <BookOpen className="h-3.5 w-3.5 text-amber-500" />,
      badge: creditEntries.length > 0 ? creditEntries.length : undefined,
    },
    {
      value: "bookings",
      label: "Bookings",
      icon: <Calendar className="h-3.5 w-3.5 text-blue-500" />,
      badge: bookings.length > 0 ? bookings.length : undefined,
    },
  ];

  const lastVisitDate = transactions.reduce<Date | null>((latest, tx) => {
    const d = new Date(tx.transactionDate);
    return !latest || d > latest ? d : latest;
  }, null);

  const rawPhone = customer.mobileNumber
    ? normalizePhoneForStorage(customer.mobileNumber, customer.countryCode || "+234")
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setLocation(backHref)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Customers
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-customer-menu">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setLocation(`/customers/${buildSlug(customer.name, customer.id)}/edit`)}
              data-testid="menu-edit-customer"
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            {customer.isArchived ? (
              <DropdownMenuItem onClick={() => restoreMutation.mutate(customer.id)} data-testid="menu-restore-customer">
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setIsArchiveConfirmOpen(true)}
                className="text-destructive focus:text-destructive"
                data-testid="menu-archive-customer"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-base font-semibold">
              {getCustomerInitials(customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate">{customer.name}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {customer.customerNumber} · Customer since{" "}
              {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date(customer.createdAt))}
            </p>
          </div>
        </div>
        <Badge
          variant={customer.isArchived ? "secondary" : "default"}
          className={cn("shrink-0", !customer.isArchived && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300")}
        >
          {customer.isArchived ? "Archived" : "Active"}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {rawPhone && (
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-full shrink-0" asChild data-testid="button-call">
            <a href={`tel:${rawPhone}`} aria-label="Call customer">
              <PhoneCall className="h-4 w-4" />
            </a>
          </Button>
        )}
        {rawPhone && (
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-full shrink-0" asChild data-testid="button-whatsapp">
            <a href={`https://wa.me/${rawPhone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" aria-label="Message on WhatsApp">
              <MessageCircle className="h-4 w-4" />
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full shrink-0"
          onClick={() => setLocation(`/customers/${buildSlug(customer.name, customer.id)}/edit`)}
          aria-label="Edit customer"
          data-testid="button-quick-edit"
        >
          <Edit className="h-4 w-4" />
        </Button>
        <Button
          className="flex-1"
          onClick={() => setLocation(`/new-sale?customerId=${customer.id}`)}
          data-testid="button-new-sale"
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          New sale
        </Button>
      </div>

      {(customer.mobileNumber || customer.address) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {customer.mobileNumber && (
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              {formatPhoneDisplay(customer.mobileNumber, customer.countryCode || "")}
            </span>
          )}
          {customer.address && (
            <span className="flex items-center gap-1.5 min-w-0">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{customer.address}</span>
            </span>
          )}
        </div>
      )}

      <MetricGrid>
        <MetricCard
          title="Total spent"
          value={formatCurrency(totalSpent, currentStore?.currency || "NGN")}
          compactValue={formatCurrencyCompact(totalSpent, currentStore?.currency || "NGN")}
          icon={<Coins className="h-4 w-4" />}
        />
        <MetricCard
          title="Visits"
          value={transactions.length}
          icon={<Receipt className="h-4 w-4" />}
        />
        <MetricCard
          title="Last visit"
          value={lastVisitDate ? formatRelativeDate(lastVisitDate) ?? "-" : "-"}
          icon={<Calendar className="h-4 w-4" />}
        />
      </MetricGrid>

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

      <div className="space-y-6">
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
                    <div className="space-y-5">
                      {groupByDay(transactions, (tx) => tx.transactionDate).map((group) => (
                        <div key={group.label} className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
                          <div className="divide-y rounded-md border">
                            {group.items.map((tx) => {
                              const status = deriveTransactionStatus(tx.id, tx.checkout?.paymentStatus, creditEntries);
                              const itemCount = (tx.checkout as any)?.basketItemCount ?? 1;
                              return (
                                <div
                                  key={tx.id}
                                  className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer hover-elevate"
                                  onClick={() => setLocation(appendReturnTo(`/transactions/${tx.id}`, location, search))}
                                  data-testid={`row-transaction-${tx.id}`}
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {tx.inventory?.name ?? "Unknown"}
                                      {itemCount > 1 && (
                                        <span className="text-muted-foreground font-normal"> +{itemCount - 1} items</span>
                                      )}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(tx.transactionDate))}
                                      {" · "}
                                      <span className="capitalize">{tx.checkout?.paymentMethod ?? "cash"}</span>
                                      {tx.checkout?.receiptNumber && <> · #{tx.checkout.receiptNumber}</>}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-mono font-medium">
                                      {formatCurrency(tx.checkout?.totalPrice ?? 0, currentStore?.currency || "NGN")}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-[10px] px-1.5 py-0 h-4 mt-0.5",
                                        status.tone === "success" && "border-emerald-500 text-emerald-600 bg-emerald-500/5 dark:text-emerald-400",
                                        status.tone === "warning" && "border-amber-500 text-amber-600 bg-amber-500/5 dark:text-amber-400",
                                        status.tone === "destructive" && "border-rose-500 text-rose-600 bg-rose-500/5 dark:text-rose-400",
                                        status.tone === "muted" && "border-muted-foreground/30 text-muted-foreground"
                                      )}
                                    >
                                      {status.label}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="credit" className="space-y-4">
                  {customer?.staffId && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 px-3 py-2.5">
                      <p className="text-xs text-amber-900 dark:text-amber-200">
                        <span className="font-semibold">Staff account.</span>{" "}
                        Outstanding balances here are proposed automatically as salary deductions on
                        this person's next payroll period, capped so their take-home never goes below
                        zero. Anything not recovered stays owing and carries to the following period.
                      </p>
                    </div>
                  )}
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

      <ConfirmDialog
        open={isArchiveConfirmOpen}
        onOpenChange={setIsArchiveConfirmOpen}
        title="Archive Customer"
        description={`Are you sure you want to archive "${customer.name}"? You can restore them later from the Archived tab.`}
        confirmText="Archive"
        onConfirm={() => archiveMutation.mutate(customer.id)}
        isDestructive
        isLoading={archiveMutation.isPending}
      />

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
