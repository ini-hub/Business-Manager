import { useQuery } from "@tanstack/react-query";
import { Receipt, Calendar, User, Package, DollarSign, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { TransactionWithRelations } from "@shared/schema";

export default function Transactions() {
  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions"],
  });

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

  const columns = [
    {
      key: "id",
      header: "Transaction ID",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-xs">{tx.id.slice(0, 8)}...</span>
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="View all sales transactions"
        actions={
          <Button asChild data-testid="button-new-sale">
            <Link href="/sales/new">
              <Receipt className="mr-2 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />

      <DataTable
        data={transactions}
        columns={columns}
        searchable
        searchPlaceholder="Search transactions..."
        searchKeys={["id"]}
        isLoading={isLoading}
        emptyMessage="No transactions found. Complete your first sale to see records here."
      />
    </div>
  );
}
