import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, User, Phone, MapPin, Hash, Calendar, Package, Coins, CreditCard, Receipt, AlertCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import { Link } from "wouter";
import type { Customer, TransactionWithRelations } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CustomerDetails() {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/customers/:id");
  const { currentStore } = useStore();
  const customerId = params?.id;

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const customer = customers.find(c => c.id === customerId);

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/customers", customerId, "transactions"],
    enabled: !!customerId,
  });

  const { data: creditEntries = [], isLoading: creditLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", customerId, "credit-ledger"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/ledger?storeId=${currentStore?.id}&customerId=${customerId}`);
      return res.json();
    },
    enabled: !!customerId && !!currentStore?.id,
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
            <p className="font-medium text-sm">{tx.inventory?.name ?? "Unknown"}</p>
            <Badge variant="outline" className="text-xs capitalize mt-1">
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

  if (!customer) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer Details"
          description="View customer information and transactions"
          actions={
            <Button variant="outline" onClick={() => setLocation("/customers")} data-testid="button-back">
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`Customer details and transaction history`}
        actions={
          <Button variant="outline" onClick={() => setLocation("/customers")} data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Customers
          </Button>
        }
      />

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
            <div className="pt-2">
              <Badge variant={customer.isArchived ? "secondary" : "default"}>
                {customer.isArchived ? "Archived" : "Active"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              title="Total Transactions"
              value={transactions.length}
              icon={<Receipt className="h-4 w-4" />}
            />
            <MetricCard
              title="Total Spent"
              value={formatCurrency(totalSpent, currentStore?.currency || "NGN")}
              icon={<Coins className="h-4 w-4" />}
            />
          </div>

          <Card className="glassmorphism border border-border/80">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                <Receipt className="h-4 w-4 text-primary" />
                Customer Logs & Activities
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <Tabs defaultValue="transactions" className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1 mb-6">
                  <TabsTrigger value="transactions" className="text-xs font-semibold py-2">
                    <Receipt className="h-3.5 w-3.5 mr-2" />
                    Transaction History ({transactions.length})
                  </TabsTrigger>
                  <TabsTrigger value="credit" className="text-xs font-semibold py-2">
                    <BookOpen className="h-3.5 w-3.5 mr-2 text-amber-500" />
                    Borrow Book Ledger ({creditEntries.length})
                  </TabsTrigger>
                </TabsList>

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
                        No active or past credit records found in Borrow Book.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-background overflow-hidden">
                      <Table>
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
                                  <span className="font-semibold text-xs text-primary">
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
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
