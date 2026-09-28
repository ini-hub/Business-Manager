import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Calendar, Loader2, Printer, Receipt as ReceiptIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { SubscriptionPayment } from "@shared/schema";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  success: "default",
  pending: "secondary",
  failed: "destructive",
};

const KIND_LABEL: Record<string, string> = {
  initial: "New subscription",
  renewal: "Renewal",
};

function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatMoney(amount: number | string, currency: string) {
  return `${currency} ${Number(amount).toLocaleString()}`;
}

/**
 * A payment's line items as they were priced AT THAT TIME (New-FAC-6 /
 * requirements plan §7) - plans and feature add-ons can reprice later, so
 * this reads planSnapshot/featureBreakdown captured on the row itself, never
 * today's catalog. Older rows from before that snapshot existed fall back to
 * the bare featureKeys list (no historical price available for those).
 */
function PaymentReceiptDialog({ payment, onOpenChange }: { payment: SubscriptionPayment | null; onOpenChange: (open: boolean) => void }) {
  if (!payment) return null;
  const isReceipt = payment.status === "success";
  const lineItems = [
    ...(payment.planSnapshot ? [{ key: "plan", name: payment.planSnapshot.name, price: payment.planSnapshot.price }] : []),
    ...(payment.featureBreakdown && payment.featureBreakdown.length > 0
      ? payment.featureBreakdown
      : (payment.featureKeys ?? []).map((key) => ({ key, name: key, price: null as number | null }))),
  ];

  const printReceipt = () => {
    document.body.classList.add("printing-receipt");
    window.print();
    document.body.classList.remove("printing-receipt");
  };

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <style>{`
          @media print {
            body.printing-receipt > *:not(#receipt-print-area-root) { visibility: hidden; }
            body.printing-receipt #receipt-print-area-root { position: fixed; inset: 0; }
            body.printing-receipt #receipt-print-area-root * { visibility: visible !important; }
          }
        `}</style>
        <div id="receipt-print-area-root">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isReceipt ? "Receipt" : "Payment attempt"}
              <Badge variant={STATUS_VARIANT[payment.status] ?? "secondary"}>{payment.status}</Badge>
            </DialogTitle>
            <DialogDescription>
              {formatDate(payment.createdAt as unknown as string)} · Ref {payment.reference}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 py-2">
            {lineItems.length === 0 && <p className="text-sm text-muted-foreground">No line items recorded for this payment.</p>}
            {lineItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-sm py-1.5 border-b last:border-b-0">
                <span>{item.name}</span>
                <span className="font-mono">{item.price !== null ? formatMoney(item.price, payment.currency) : "—"}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-semibold pt-2">
              <span>Total {isReceipt ? "charged" : "attempted"}</span>
              <span className="font-mono">{formatMoney(payment.amount, payment.currency)}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[payment.kind] ?? payment.kind} · {payment.billingCycle} billing · via {payment.provider}
          </p>
        </div>

        {isReceipt && (
          <Button variant="outline" size="sm" onClick={printReceipt} className="mt-2">
            <Printer className="mr-2 h-4 w-4" />
            Print receipt
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentHistoryPage() {
  const [selectedPayment, setSelectedPayment] = useState<SubscriptionPayment | null>(null);

  const { data: payments = [], isLoading } = useQuery<SubscriptionPayment[]>({
    queryKey: ["/api/billing/payments"],
  });

  const tableData = useMemo(
    () =>
      payments.map((p) => ({
        ...p,
        kindLabel: KIND_LABEL[p.kind] ?? p.kind,
        featureCount: p.featureKeys?.length ?? 0,
      })),
    [payments]
  );

  type Row = (typeof tableData)[number];

  const columns = [
    {
      key: "createdAt",
      header: "Date",
      render: (p: Row) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{formatDate(p.createdAt as unknown as string)}</span>
        </div>
      ),
    },
    {
      key: "kindLabel",
      header: "Type",
      render: (p: Row) => <Badge variant="outline">{p.kindLabel}</Badge>,
    },
    {
      key: "reference",
      header: "Reference",
      render: (p: Row) => <span className="font-mono text-xs">{p.reference}</span>,
    },
    {
      key: "featureCount",
      header: "Features",
      render: (p: Row) => (
        <span className="text-xs text-muted-foreground">
          {p.featureCount > 0 ? `${p.featureCount} feature${p.featureCount === 1 ? "" : "s"}` : "Base plan only"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (p: Row) => <span className="font-mono text-sm font-medium">{formatMoney(p.amount, p.currency)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (p: Row) => <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{p.status}</Badge>,
    },
  ];

  const filterConfigs = [
    { key: "status", label: "Status", type: "select" as const },
    { key: "kindLabel", label: "Type", type: "select" as const },
    { key: "billingCycle", label: "Billing cycle", type: "select" as const },
    { key: "createdAt", label: "Date", type: "date-range" as const },
    { key: "amount", label: "Amount", type: "range" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment History"
        description="Every checkout and renewal attempt for your subscription, with what was actually charged."
        actions={
          <Button variant="outline" asChild data-testid="link-back-to-billing">
            <Link href="/settings/billing">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Billing
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              data={tableData}
              columns={columns}
              searchable
              searchPlaceholder="Search reference..."
              searchKeys={["reference"]}
              emptyTitle="No payments yet"
              emptyMessage="Once you subscribe or renew, every attempt will show up here."
              emptyIcon={<ReceiptIcon className="h-6 w-6" />}
              onRowClick={(p) => setSelectedPayment(p)}
              filterConfigs={filterConfigs}
              urlKey="payments"
            />
          )}
        </CardContent>
      </Card>

      <PaymentReceiptDialog payment={selectedPayment} onOpenChange={(open) => { if (!open) setSelectedPayment(null); }} />
    </div>
  );
}
