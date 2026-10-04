import { useMemo, useState } from "react";
import { BackButton } from "@/components/back-button";
import { useQuery } from "@tanstack/react-query";
import { Printer, Receipt as ReceiptIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { ListControls } from "@/components/list-controls";
import { PaymentFiltersSheet, PaymentSortSheet } from "@/components/payment-filter-sheets";
import {
  EMPTY_PAYMENT_FILTERS,
  buildPaymentFilterChips,
  clearPaymentFilterChip,
  countActivePaymentFilters,
  paymentMatchesFilters,
  paymentMatchesSearch,
  paymentSortLabel,
  sortPayments,
  type PaymentFilterChip,
  type PaymentFilterState,
  type PaymentSortState,
} from "@/lib/payment-history-filters";
import { formatCurrency } from "@/lib/currency-utils";
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

const STATUS_LABEL: Record<string, string> = { success: "Paid", pending: "Pending", failed: "Failed" };

const KIND_LABEL: Record<string, string> = {
  initial: "New subscription",
  renewal: "Renewal",
};

function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatMoney(amount: number | string, currency: string) {
  return formatCurrency(Number(amount), currency);
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
              <Badge variant={STATUS_VARIANT[payment.status] ?? "secondary"}>{STATUS_LABEL[payment.status] ?? payment.status}</Badge>
            </DialogTitle>
            <DialogDescription>
              {formatDate(payment.createdAt as unknown as string)} · Ref {payment.reference}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 py-2">
            {lineItems.length === 0 && <p className="text-sm text-muted-foreground">No line items recorded for this payment.</p>}
            {lineItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-sm py-2 border-b last:border-b-0">
                <span>{item.name}</span>
                <span>{item.price !== null ? formatMoney(item.price, payment.currency) : "—"}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm font-semibold pt-2">
              <span>Total {isReceipt ? "charged" : "attempted"}</span>
              <span>{formatMoney(payment.amount, payment.currency)}</span>
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

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PaymentFilterState>(EMPTY_PAYMENT_FILTERS);
  const [sort, setSort] = useState<PaymentSortState | null>(null);

  const cycles = useMemo(() => Array.from(new Set(payments.map((p) => p.billingCycle).filter(Boolean))) as string[], [payments]);
  const searched = useMemo(() => tableData.filter((p) => paymentMatchesSearch(p, search)), [tableData, search]);
  const visible = useMemo(
    () => sortPayments(searched.filter((p) => paymentMatchesFilters(p, filters)), sort),
    [searched, filters, sort]
  );

  const controls = (
    <ListControls
      testIdPrefix="payment"
      placeholder="Search reference"
      search={search}
      onSearchChange={setSearch}
      filterCount={countActivePaymentFilters(filters)}
      filters={(trigger) => (
        <PaymentFiltersSheet
          filters={filters}
          onApply={setFilters}
          cycles={cycles}
          resultCountFor={(draft) => searched.filter((p) => paymentMatchesFilters(p, draft)).length}
          trigger={trigger}
        />
      )}
      sortLabel={paymentSortLabel(sort)}
      sort={(trigger) => <PaymentSortSheet sort={sort} onChange={setSort} trigger={trigger} />}
      chips={buildPaymentFilterChips(filters)}
      onRemoveChip={(key) => setFilters((f) => clearPaymentFilterChip(f, key as PaymentFilterChip["key"]))}
      hasSort={sort !== null}
      onClearAll={() => { setFilters(EMPTY_PAYMENT_FILTERS); setSort(null); }}
      visibleCount={visible.length}
      noun="payment"
    />
  );

  const columns = [
    {
      key: "createdAt",
      header: "Date",
      priority: 1 as const,
      render: (p: Row) => <span className="text-[13px]">{formatDate(p.createdAt as unknown as string)}</span>,
    },
    {
      key: "kindLabel",
      header: "Type",
      priority: 2 as const,
      render: (p: Row) => <Badge variant="outline">{p.kindLabel}</Badge>,
    },
    {
      key: "reference",
      header: "Reference",
      priority: 3 as const,
      render: (p: Row) => <span className="text-xs text-muted-foreground">{p.reference}</span>,
    },
    {
      key: "featureCount",
      header: "Features",
      priority: 3 as const,
      render: (p: Row) => (
        <span className="text-[13px] text-muted-foreground">
          {p.featureCount > 0 ? `${p.featureCount} feature${p.featureCount === 1 ? "" : "s"}` : "Base plan only"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right" as const,
      priority: 1 as const,
      render: (p: Row) => <span className="text-sm font-semibold">{formatMoney(p.amount, p.currency)}</span>,
    },
    {
      key: "status",
      header: "Status",
      priority: 2 as const,
      render: (p: Row) => <Badge variant={STATUS_VARIANT[p.status] ?? "secondary"}>{STATUS_LABEL[p.status] ?? p.status}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="text-lg font-bold">Payment History</span>}
        description="Every checkout and renewal attempt for your subscription, with what was actually charged."
        inlineActions
        hideBreadcrumb
        actions={<BackButton label="Billing" href="/settings/billing" data-testid="link-back-to-billing" />}
      />

      <div className="space-y-3">
        {controls}
        <DataTable
          data={visible}
          columns={columns}
          hideToolbar
          isLoading={isLoading}
          emptyTitle="No payments yet"
          emptyMessage="Once you subscribe or renew, every attempt will show up here."
          emptyIcon={<ReceiptIcon className="h-6 w-6" />}
          onRowClick={(p) => setSelectedPayment(p)}
          showCardChevron
          cardLayout="compact-grid"
          urlKey="payments"
        />
      </div>

      <PaymentReceiptDialog payment={selectedPayment} onOpenChange={(open) => { if (!open) setSelectedPayment(null); }} />
    </div>
  );
}
