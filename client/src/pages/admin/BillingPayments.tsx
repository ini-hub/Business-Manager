import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Eye, Loader2, AlertCircle, Clock, Filter } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BillingPayment = {
  id: string;
  organisationId: string;
  organisationName: string | null;
  planName: string | null;
  provider: string;
  kind: "initial" | "renewal";
  reference: string;
  amount: string | number;
  currency: string;
  billingCycle: string;
  status: "pending" | "success" | "failed";
  providerResponse: unknown;
  createdAt: string;
  verifiedAt: string | null;
};

const PAGE_SIZE = 25;

function statusBadgeColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "failed":
      return "bg-rose-500/10 text-rose-450 border-rose-500/20";
    default:
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
}

export default function BillingPayments() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedPayment, setSelectedPayment] = useState<BillingPayment | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/billing/payments", status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (status !== "all") params.set("status", status);
      const res = await apiRequest("GET", `/api/admin/billing/payments?${params.toString()}`);
      return res.json();
    },
  });

  const payments: BillingPayment[] = data?.payments ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Billing Payments</h1>
        <p className="text-slate-400 text-sm mt-1">
          Every subscription payment attempt across all businesses - initial checkouts and automatic renewals.
        </p>
      </div>

      <Card className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <Filter className="h-4 w-4 text-slate-500 shrink-0" />
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl min-w-[200px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-350">
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-500 ml-auto">{total} total payment{total === 1 ? "" : "s"}</span>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Failed to load billing payments.</span>
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
          <CreditCard className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <h3 className="font-bold text-white text-base">No payments yet</h3>
          <p className="text-xs text-slate-500 mt-1">Payments will show up here as businesses check out.</p>
        </div>
      ) : (
        <Card className="bg-slate-900/40 border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold">
              <thead className="bg-slate-950/40 text-slate-450 uppercase text-[9px] tracking-wider border-b border-slate-850">
                <tr>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Business</th>
                  <th className="px-6 py-4">Plan</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Provider</th>
                  <th className="px-6 py-4">Kind</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-slate-900/30 transition-colors">
                    <td className="px-6 py-4 text-slate-450 font-mono text-[10px] flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      {new Date(payment.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-slate-200">{payment.organisationName || "—"}</td>
                    <td className="px-6 py-4 text-slate-300">{payment.planName || "—"}</td>
                    <td className="px-6 py-4 text-slate-200 font-mono">
                      {payment.currency} {Number(payment.amount).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-slate-350 uppercase text-[10px]">{payment.provider}</td>
                    <td className="px-6 py-4 text-slate-350 capitalize">{payment.kind}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className={`border ${statusBadgeColor(payment.status)} text-[10px] py-0.5 px-2 rounded-md font-extrabold uppercase`}>
                        {payment.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="hover:bg-slate-850 text-indigo-400 hover:text-white rounded-lg h-8"
                        onClick={() => {
                          setSelectedPayment(payment);
                          setShowDetailDialog(true);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-850">
            <span className="text-[10px] text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-slate-800 text-slate-300"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-800 text-slate-300"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-lg rounded-3xl p-6 font-sans">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-bold text-white font-outfit flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-indigo-400" />
              Payment Detail
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Reference {selectedPayment?.reference}
            </DialogDescription>
          </DialogHeader>

          {selectedPayment && (
            <div className="space-y-4 my-3 text-xs leading-relaxed">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/60 rounded-2xl border border-slate-850 text-slate-350">
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Business</span>
                  <span className="font-semibold text-slate-200">{selectedPayment.organisationName || "—"}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Plan</span>
                  <span className="font-semibold text-slate-200">{selectedPayment.planName || "—"} · {selectedPayment.billingCycle}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Amount</span>
                  <span>{selectedPayment.currency} {Number(selectedPayment.amount).toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Verified At</span>
                  <span>{selectedPayment.verifiedAt ? new Date(selectedPayment.verifiedAt).toLocaleString() : "Not yet"}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Provider Response (JSON)</span>
                <pre className="bg-slate-950 border border-slate-850 rounded-2xl p-4 overflow-auto max-h-[280px] font-mono text-[10px] text-indigo-400 leading-relaxed shadow-inner">
                  {JSON.stringify(selectedPayment.providerResponse ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              className="bg-indigo-500 hover:bg-indigo-650 text-white font-bold rounded-xl px-5"
              onClick={() => setShowDetailDialog(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
