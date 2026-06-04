import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, BarChart3, Download } from "lucide-react";
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

  if (!currentStore) return <StoreRequiredAlert />;

  const totalPaid = report.filter(r => r.status === "paid").reduce((s, r) => s + r.totalNetPay, 0);
  const totalStaff = report.reduce((s, r) => s + r.staffCount, 0);

  const exportCSV = () => {
    const rows = [
      ["Period", "Type", "Status", "Staff", "Commission", "Transport", "Deductions", "Net Pay", "Paid At"],
      ...report.map(r => [
        `${r.startDate} to ${r.endDate}`,
        r.periodType,
        r.status,
        r.staffCount,
        r.totalGrossCommission.toFixed(2),
        r.totalTransport.toFixed(2),
        r.totalDeductions.toFixed(2),
        r.totalNetPay.toFixed(2),
        r.paidAt ? format(new Date(r.paidAt), "yyyy-MM-dd") : "",
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-report-${currentStore?.name?.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
            <Button variant="outline" onClick={exportCSV} disabled={report.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
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
