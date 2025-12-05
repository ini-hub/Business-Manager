import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, Calendar, User, Package, DollarSign, Hash, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import type { TransactionWithRelations } from "@shared/schema";

export default function Transactions() {
  const { currentStore } = useStore();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });

  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const filteredTransactions = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return transactions;

    return transactions.filter((tx) => {
      const txDate = new Date(tx.transactionDate);
      if (dateRange.from && txDate < dateRange.from) return false;
      if (dateRange.to && txDate > dateRange.to) return false;
      return true;
    });
  }, [transactions, dateRange]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
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

  const totalAmount = filteredTransactions.reduce(
    (sum, tx) => sum + (tx.checkout?.totalPrice ?? 0),
    0
  );

  const columns = [
    {
      key: "id",
      header: "Transaction ID",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-xs" data-testid={`text-tx-id-${tx.id.slice(0, 8)}`}>
            {tx.id.slice(0, 8)}...
          </span>
        </div>
      ),
    },
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
      key: "customer",
      header: "Customer",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <User className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">{tx.customer?.name ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground">{tx.customer?.customerNumber}</p>
          </div>
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
      key: "checkout",
      header: "Amount",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono font-medium">
            {formatCurrency(tx.checkout?.totalPrice ?? 0)}
          </span>
        </div>
      ),
    },
  ];

  const exportColumns = [
    { key: "id", header: "Transaction ID" },
    { key: "transactionDate", header: "Date" },
    { key: "customer.name", header: "Customer Name" },
    { key: "customer.customerNumber", header: "Customer Number" },
    { key: "inventory.name", header: "Item Name" },
    { key: "inventory.type", header: "Item Type" },
    { key: "checkout.totalPrice", header: "Amount" },
  ];

  const exportData = filteredTransactions.map((tx) => ({
    id: tx.id,
    transactionDate: new Date(tx.transactionDate).toLocaleString(),
    customer: tx.customer,
    inventory: tx.inventory,
    checkout: tx.checkout,
  }));

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Transactions"
          description="View all sales transactions"
        />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to view transactions.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description={`Sales transactions for ${currentStore.name}`}
        actions={
          <Button asChild data-testid="button-new-sale">
            <Link href="/sales/new">
              <Receipt className="mr-2 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Total Transactions"
          value={filteredTransactions.length}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalAmount)}
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Avg. Transaction"
          value={formatCurrency(
            filteredTransactions.length > 0 ? totalAmount / filteredTransactions.length : 0
          )}
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle className="text-base font-medium">Transaction History</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <ExportToolbar
              data={exportData as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              filename="transactions"
              title="Transaction Report"
              disabled={isLoading}
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={filteredTransactions}
            columns={columns}
            searchable
            searchPlaceholder="Search transactions..."
            searchKeys={["id"]}
            isLoading={isLoading}
            emptyMessage="No transactions found. Complete your first sale to see records here."
          />
        </CardContent>
      </Card>
    </div>
  );
}
