import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useLocation } from "wouter";
import { ExportToolbar } from "@/components/export-toolbar";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";

const STATUS_CONFIG = {
  pending:  { label: "Pending",  color: "text-amber-700 bg-amber-50 border-amber-200" },
  approved: { label: "Approved", color: "text-blue-700 bg-blue-50 border-blue-200" },
  paid:     { label: "Paid",     color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
};

export default function PayrollReportPage() {
  const { currentStore } = useStore();
  const [, setLocation] = useLocation();
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);

  const { data: report = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll/report", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/report?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const [visibleReport, setVisibleReport] = useState<any[]>([]);

  if (!currentStore) return <StoreRequiredAlert />;

  const totalPaid = report.filter(r => r.status === "paid").reduce((s, r) => s + r.totalNetPay, 0);
  const totalStaff = report.reduce((s, r) => s + r.staffCount, 0);
  const visibleTotalPaid = visibleReport.filter((r) => r.status === "paid").reduce((s, r) => s + r.totalNetPay, 0);
  const visibleTotalStaff = visibleReport.reduce((s, r) => s + r.staffCount, 0);

  const exportColumns = [
    { key: "periodType", header: "Type" },
    { key: "startDate", header: "Start Date" },
    { key: "endDate", header: "End Date" },
    { key: "status", header: "Status" },
    { key: "staffCount", header: "Staff" },
    { key: "totalGrossCommission", header: "Commission" },
    { key: "totalTransport", header: "Transport" },
    { key: "totalDeductions", header: "Deductions" },
    { key: "totalNetPay", header: "Net Pay" },
    { key: "paidAt", header: "Paid At" },
  ];

  const filterConfigs: TableFilterConfig[] = [
    { key: "periodType", label: "Period Type", type: "select" },
    { key: "status", label: "Status", type: "select" },
  ];

  const columns = [
    {
      key: "period",
      header: "Period",
      render: (r: any) => (
        <div>
          <p className="text-xs font-medium capitalize">{r.periodType}</p>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(r.startDate), "MMM d")} – {format(parseISO(r.endDate), "MMM d, yyyy")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => {
        const cfg = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
        return <Badge variant="outline" className={`text-xs ${cfg.color} border`}>{cfg.label}</Badge>;
      },
    },
    { key: "staffCount", header: "Staff", render: (r: any) => <span className="text-sm">{r.staffCount}</span> },
    {
      key: "totalGrossCommission",
      header: "Commission",
      render: (r: any) => <span className="font-mono text-sm">{fmt(r.totalGrossCommission)}</span>,
    },
    {
      key: "totalTransport",
      header: "Transport",
      render: (r: any) => <span className="font-mono text-sm">{fmt(r.totalTransport)}</span>,
    },
    {
      key: "totalDeductions",
      header: "Deductions",
      render: (r: any) => r.totalDeductions > 0
        ? <span className="font-mono text-sm text-destructive">-{fmt(r.totalDeductions)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      key: "totalNetPay",
      header: "Net Pay",
      render: (r: any) => <span className="font-mono font-bold text-sm text-primary">{fmt(r.totalNetPay)}</span>,
    },
    {
      key: "paidAt",
      header: "Paid At",
      render: (r: any) => r.paidAt
        ? <span className="text-xs text-muted-foreground">{format(new Date(r.paidAt), "MMM d, yyyy")}</span>
        : <span className="text-muted-foreground text-xs">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Report"
        description={`All payroll periods for ${currentStore?.name}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocation("/payroll")}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <ExportToolbar
              data={report as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              filename={`payroll-report-${currentStore?.name?.replace(/\s+/g, "-").toLowerCase()}`}
              title="Payroll Report"
              disabled={report.length === 0}
              pdfReport={{
                businessName: currentStore?.name ?? "Business",
                storeName: currentStore?.name ?? "Store",
                kpis: [
                  { label: "Total Periods", value: String(report.length) },
                  { label: "Total Staff-Periods", value: String(totalStaff) },
                  { label: "Total Paid Out", value: fmt(totalPaid) },
                ],
                columns: [
                  { key: "periodType", header: "Type" },
                  { key: "status", header: "Status" },
                  { key: "totalNetPay", header: "Net Pay", align: "right" as const, format: (r: Record<string, unknown>) => fmt(r.totalNetPay as number) },
                ],
                rows: report as unknown as Record<string, unknown>[],
                amountKey: "totalNetPay",
                formatAmount: fmt,
                statusKey: "status",
                unitLabel: "periods",
              }}
              visibleData={visibleReport as unknown as Record<string, unknown>[]}
              visiblePdfReport={{
                businessName: currentStore?.name ?? "Business",
                storeName: currentStore?.name ?? "Store",
                kpis: [
                  { label: "Total Periods", value: String(visibleReport.length) },
                  { label: "Total Staff-Periods", value: String(visibleTotalStaff) },
                  { label: "Total Paid Out", value: fmt(visibleTotalPaid) },
                ],
                columns: [
                  { key: "periodType", header: "Type" },
                  { key: "status", header: "Status" },
                  { key: "totalNetPay", header: "Net Pay", align: "right" as const, format: (r: Record<string, unknown>) => fmt(r.totalNetPay as number) },
                ],
                rows: visibleReport as unknown as Record<string, unknown>[],
                amountKey: "totalNetPay",
                formatAmount: fmt,
                statusKey: "status",
                unitLabel: "periods",
              }}
            />
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total Periods", value: report.length },
          { label: "Total Staff-Periods", value: totalStaff },
          { label: "Total Paid Out", value: fmt(totalPaid) },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{c.label}</p>
              <p className="text-xl font-bold font-mono text-primary mt-1">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            All Payroll Periods
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={report}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No payroll periods found."
            searchable={false}
            filterConfigs={filterConfigs}
            onVisibleDataChange={setVisibleReport}
          />
        </CardContent>
        {report.length > 0 && (
          <>
            <Separator />
            <CardFooter className="justify-between pt-4">
              <span className="font-semibold text-sm">Total Disbursed (Paid Periods)</span>
              <span className="text-xl font-bold font-mono text-primary">{fmt(totalPaid)}</span>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
