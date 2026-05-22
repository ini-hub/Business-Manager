import { useState, useMemo } from "react";
import { startOfDay, endOfDay } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Receipt, Calendar, User, Package, Coins, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { type TransactionWithRelations } from "@shared/schema";

export default function Transactions() {
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const params = new URLSearchParams(window.location.search);
    const startDateParam = params.get("startDate");
    const endDateParam = params.get("endDate");
    if (startDateParam && endDateParam) {
      return {
        from: startOfDay(new Date(startDateParam)),
        to: endOfDay(new Date(endDateParam))
      };
    }
    return {
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    };
  });

  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    enabled: !!currentStore?.id,
    refetchInterval: 20000, // Refetch transactions list in background every 20 seconds
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

  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number, currency: string = storeCurrency) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(value);
  };

  const formatDualCurrency = (value: number, isVoided: boolean = false) => {
    const primaryAmount = formatCurrency(value, storeCurrency);
    let usdAmount = null;
    
    if (storeCurrency !== "USD") {
      const usdRate = 1500;
      usdAmount = formatCurrency(value / usdRate, "USD");
    }

    return (
      <div className={`flex flex-col ${isVoided ? "opacity-50 line-through" : ""}`}>
        <span className="font-mono font-medium">{primaryAmount}</span>
        {usdAmount && <span className="text-xs text-muted-foreground font-mono">{usdAmount}</span>}
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

  const totalAmount = filteredTransactions.reduce(
    (sum, tx) => sum + (!tx.checkout?.isVoided ? (tx.checkout?.totalPrice ?? 0) : 0),
    0
  );
  
  const nonVoidedCount = filteredTransactions.filter(tx => !tx.checkout?.isVoided).length;

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
      key: "receiptNumber",
      header: "Receipt No.",
      render: (tx: TransactionWithRelations) => (
        <div className="flex flex-col gap-1 items-start">
          <span className="font-mono text-sm">{tx.checkout?.receiptNumber}</span>
          {tx.checkout?.isVoided && (
             <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">VOID</Badge>
          )}
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
      key: "paymentMethod",
      header: "Payment",
      render: (tx: TransactionWithRelations) => (
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-2">
            <CreditCard className="h-3 w-3 text-muted-foreground" />
            <Badge variant="secondary" className="capitalize">
              {tx.checkout?.paymentMethod ?? "cash"}
            </Badge>
          </div>
          {tx.checkout?.paymentStatus === "pending" && !tx.checkout?.isVoided && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-300 bg-amber-50">
              PENDING
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "checkout",
      header: "Amount",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          {formatDualCurrency(tx.checkout?.totalPrice ?? 0, tx.checkout?.isVoided)}
        </div>
      ),
    },

  ];

  const exportColumns = [
    { key: "checkout.receiptNumber", header: "Transaction No." },
    { key: "transactionDate", header: "Date" },
    { key: "customer.name", header: "Customer Name" },
    { key: "customer.customerNumber", header: "Customer Number" },
    { key: "checkout.staff.name", header: "Billed By" },
    { key: "checkout.staff.staffNumber", header: "Staff ID" },
    { key: "inventory.name", header: "Item Name" },
    { key: "inventory.type", header: "Item Type" },
    { key: "checkout.totalPrice", header: "Amount" },
    { key: "checkout.isVoided", header: "Voided" },
  ];

  const exportData = filteredTransactions.map((tx) => ({
    id: tx.id,
    transactionDate: new Date(tx.transactionDate).toLocaleString(),
    customer: tx.customer,
    inventory: tx.inventory,
    checkout: {
      ...tx.checkout,
      isVoided: tx.checkout?.isVoided ? "Yes" : "No"
    },
  }));

  const tableData = useMemo(() => {
    return filteredTransactions.map((tx) => ({
      ...tx,
      status: tx.checkout?.isVoided ? "Void" : (tx.checkout?.paymentStatus === "pending" ? "Pending" : "Paid"),
      paymentMethod: tx.checkout?.paymentMethod || "cash",
      staffName: tx.checkout?.staff?.name || "Unknown",
      amount: tx.checkout?.totalPrice ?? 0
    }));
  }, [filteredTransactions]);

  const filterConfigs = [
    { key: "status", label: "Status", type: "select" as const },
    { 
      key: "paymentMethod", 
      label: "Payment Method", 
      type: "select" as const,
      valueMapper: (val: any) => {
        if (!val) return "Unknown";
        const str = String(val).toLowerCase();
        if (str === "cash") return "Cash";
        if (str === "transfer" || str === "bank transfer") return "Transfer";
        if (str === "pos" || str === "card") return "POS";
        return String(val).charAt(0).toUpperCase() + String(val).slice(1);
      }
    },
    { key: "staffName", label: "Staff", type: "select" as const },
    { key: "amount", label: "Amount", type: "range" as const, currencySymbol: storeCurrency === "USD" ? "$" : "₦" }
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Transactions"
          description="View all sales transactions"
        />
        <StoreRequiredAlert title="Store Required for Transactions" />
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
          title="Valid Transactions"
          value={nonVoidedCount}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Valid Revenue"
          value={formatCurrency(totalAmount)}
          icon={<Coins className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Avg. Transaction"
          value={formatCurrency(
            nonVoidedCount > 0 ? totalAmount / nonVoidedCount : 0
          )}
          icon={<Coins className="h-4 w-4" />}
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
            data={tableData}
            columns={columns}
            searchable
            searchPlaceholder="Search receipt, customer, item, payment..."
            searchKeys={["checkout.receiptNumber", "customer.name", "inventory.name", "paymentMethod"]}
            isLoading={isLoading}
            emptyMessage="No transactions found. Complete your first sale to see records here."
            onRowClick={(tx) => setLocation("/transactions/" + tx.id)}
            filterConfigs={filterConfigs}
          />
        </CardContent>
      </Card>
    </div>
  );
}
