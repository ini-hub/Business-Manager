import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Search,
  Eye,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";

const ACTION_GROUPS: Record<string, string[]> = {
  "Sales & Payments": ["CHECKOUT", "PAYMENT", "TRANSACTION_VOID", "PAYMENT_UPDATE", "TRANSACTION_ADDENDUM"],
  "Inventory": ["INVENTORY_UPDATE", "INVENTORY_ARCHIVE", "INVENTORY_DELETE", "INVENTORY_BULK_IMPORT", "INVENTORY_BULK_UPDATE", "INVENTORY_BUNDLE_UPDATE", "INVENTORY_BATCH_CREATE", "CREATE", "CREATE_RESTOCK"],
  "Payroll": ["PAYROLL_PERIOD_CREATE", "PAYROLL_PERIOD_CALCULATE", "PAYROLL_PERIOD_APPROVE", "PAYROLL_PERIOD_MARK_PAID", "PAYROLL_PERIOD_DELETE", "PAYROLL_DEDUCTION_CREATE", "PAYROLL_DEDUCTION_DELETE", "PAYROLL_DISBURSEMENT_CREATE", "SALARY_ADVANCE_CREATE", "SALARY_ADVANCE_RECOVER", "SALARY_ADVANCE_DELETE", "PAYSLIP_REGISTER"],
  "Expenses": ["EXPENSE_CREATE", "EXPENSE_UPDATE", "EXPENSE_DELETE", "EXPENSE_CATEGORY_CREATE", "EXPENSE_CATEGORY_UPDATE", "EXPENSE_CATEGORY_DELETE"],
  "Cash Register": ["CASH_REGISTER_OPEN", "CASH_DROP", "CASH_REGISTER_CLOSE"],
  "Vendors & Procurement": ["VENDOR_CREATE", "VENDOR_UPDATE", "VENDOR_ARCHIVE", "VENDOR_RESTORE", "VENDOR_DELETE", "VENDOR_BILL_CREATE", "VENDOR_BILL_UPDATE", "VENDOR_BILL_DELETE", "PURCHASE_ORDER_CREATE", "PURCHASE_ORDER_STATUS_UPDATE", "PURCHASE_ORDER_RECEIVE", "PURCHASE_ORDER_DELETE", "STOCK_AUDIT_CREATE", "STOCK_AUDIT_APPROVE", "STOCK_TRANSFER_CREATE", "STOCK_TRANSFER_STATUS_UPDATE", "STOCK_TRANSFER_DELETE", "QUOTE_CREATE", "QUOTE_STATUS_UPDATE", "QUOTE_DELETE", "TAX_RATE_CREATE", "TAX_RATE_UPDATE", "TAX_RATE_DELETE"],
  "Auth": ["AUTH_ATTEMPT", "LOGIN", "SIGNUP", "PASSWORD_RESET"],
  "Settings": ["SETTINGS_UPDATE"],
  "Staff & Customers": ["CREATE", "UPDATE", "DELETE"],
};

const RESOURCE_OPTIONS = [
  "checkout", "inventory", "payroll_period", "payroll_deduction", "payroll_disbursement",
  "salary_advance", "payslip", "expense", "expense_category", "cash_register",
  "vendor", "vendor_bill", "purchase_order", "stock_audit", "stock_transfer",
  "quote", "tax_rate", "settings", "customer", "staff", "promotions", "custom_roles",
];

function actionBadgeStyle(action: string) {
  if (action.includes("DELETE") || action.includes("VOID") || action.includes("ARCHIVE")) {
    return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  }
  if (action.includes("CREATE") || action.includes("OPEN") || action.includes("REGISTER")) {
    return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800";
  }
  if (action.includes("UPDATE") || action.includes("APPROVE") || action.includes("MARK_PAID") || action.includes("RECOVER")) {
    return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  }
  return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
}

function formatAction(action: string) {
  return action.replace(/_/g, " ");
}

function formatResource(resource: string) {
  return resource.replace(/_/g, " ");
}

export default function AuditLogsPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (actionFilter !== "all") p.action = actionFilter;
    if (resourceFilter !== "all") p.resource = resourceFilter;
    if (startDate) p.startDate = startDate;
    if (endDate) p.endDate = endDate;
    return p;
  }, [actionFilter, resourceFilter, startDate, endDate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/audit-logs", queryParams],
    queryFn: async () => {
      const params = new URLSearchParams(queryParams);
      const res = await apiRequest("GET", `/api/audit-logs?${params}`);
      return res.json();
    },
  });

  const logs = useMemo(() => {
    const all: any[] = data?.logs || [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (l) =>
        l.action?.toLowerCase().includes(q) ||
        l.resource?.toLowerCase().includes(q) ||
        l.userEmail?.toLowerCase().includes(q) ||
        l.userName?.toLowerCase().includes(q) ||
        l.resourceId?.toLowerCase().includes(q) ||
        l.ip?.toLowerCase().includes(q),
    );
  }, [data?.logs, search]);

  const clearFilters = () => {
    setActionFilter("all");
    setResourceFilter("all");
    setStartDate("");
    setEndDate("");
    setSearch("");
  };

  const hasActiveFilters =
    actionFilter !== "all" || resourceFilter !== "all" || startDate || endDate || search;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Activity Log"
        description="A full audit trail of every change made in your business."
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by user, action, resource ID..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Action filter */}
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">All actions</SelectItem>
                  {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {actions.map((a) => (
                        <SelectItem key={a} value={a}>
                          {formatAction(a)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>

              {/* Resource filter */}
              <Select value={resourceFilter} onValueChange={setResourceFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Filter by resource" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">All resources</SelectItem>
                  {RESOURCE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatResource(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-center">
              {/* Date range */}
              <div className="flex gap-2 items-center flex-1">
                <Input
                  type="date"
                  className="w-full sm:w-auto"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="text-muted-foreground text-sm shrink-0">to</span>
                <Input
                  type="date"
                  className="w-full sm:w-auto"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
                  <X className="h-4 w-4 mr-1" />
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log count */}
      {!isLoading && !error && (
        <p className="text-sm text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{logs.length}</span> entries
          {data?.logs?.length !== logs.length && (
            <> (filtered from {data?.logs?.length})</>
          )}
        </p>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          Failed to load audit logs. Please try again.
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldCheck className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="font-semibold text-foreground">No matching entries</p>
          <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters.</p>
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Resource</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium leading-tight">{log.userName || "—"}</span>
                        {log.userEmail && (
                          <span className="text-xs text-muted-foreground">{log.userEmail}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-bold uppercase tracking-wide ${actionBadgeStyle(log.action)}`}
                      >
                        {formatAction(log.action)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="capitalize">{formatResource(log.resource)}</span>
                      {log.resourceId && (
                        <span className="block font-mono text-[10px] opacity-60 truncate max-w-[120px]">
                          {log.resourceId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {log.status === "success" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                          <XCircle className="h-3.5 w-3.5" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {log.details || log.errorMessage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedLog(log)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Log Entry Detail
            </DialogTitle>
            <DialogDescription>
              {selectedLog && new Date(selectedLog.timestamp).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg border text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">User</p>
                  <p className="font-medium">{selectedLog.userName || "—"}</p>
                  {selectedLog.userEmail && <p className="text-muted-foreground">{selectedLog.userEmail}</p>}
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Action</p>
                  <p className="font-medium uppercase">{formatAction(selectedLog.action)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Resource</p>
                  <p className="font-medium capitalize">{formatResource(selectedLog.resource)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">IP Address</p>
                  <p className="font-mono">{selectedLog.ip || "—"}</p>
                </div>
                {selectedLog.resourceId && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Resource ID</p>
                    <p className="font-mono break-all">{selectedLog.resourceId}</p>
                  </div>
                )}
                {selectedLog.errorMessage && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px] mb-0.5">Error</p>
                    <p className="text-red-600 dark:text-red-400">{selectedLog.errorMessage}</p>
                  </div>
                )}
              </div>

              {selectedLog.details && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">Payload</p>
                  <pre className="bg-muted p-3 rounded-lg overflow-auto max-h-56 font-mono text-xs leading-relaxed">
                    {JSON.stringify(
                      typeof selectedLog.details === "string"
                        ? JSON.parse(selectedLog.details)
                        : selectedLog.details,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
