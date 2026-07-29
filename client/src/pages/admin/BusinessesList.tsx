import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search,
  Building,
  User,
  CreditCard,
  Calendar,
  Eye,
  Ban,
  RotateCcw,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function BusinessesList() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [minGMV, setMinGMV] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  // Suspension Modal State
  const [suspensionOrgId, setSuspensionOrgId] = useState<string | null>(null);
  const [suspensionReason, setSuspensionReason] = useState("policy_violation");
  const [suspensionNote, setSuspensionNote] = useState("");
  const [showSuspensionDialog, setShowSuspensionDialog] = useState(false);

  // Fetch businesses
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/businesses", { search, status: status === "all" ? "" : status, minGMV, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (status && status !== "all") params.append("status", status);
      if (minGMV) params.append("minGMV", minGMV);
      params.append("page", String(page));
      params.append("limit", String(limit));

      const res = await apiRequest("GET", `/api/admin/businesses?${params.toString()}`);
      return res.json();
    },
    placeholderData: (previousData) => previousData,
  });

  // Suspend Mutation
  const suspendMutation = useMutation({
    mutationFn: async ({ id, reason, note }: { id: string; reason: string; note: string }) => {
      const res = await apiRequest("POST", `/api/admin/businesses/${id}/suspend`, {
        reason,
        note,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Business Suspended",
        description: "The business account has been suspended and sessions invalidated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
      setShowSuspensionDialog(false);
      setSuspensionOrgId(null);
      setSuspensionNote("");
    },
    onError: (err: any) => {
      toast({
        title: "Suspension Failed",
        description: err?.message || "Failed to suspend the organization.",
        variant: "destructive",
      });
    },
  });

  // Reactivate Mutation
  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/businesses/${id}/reactivate`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Business Reactivated",
        description: "The business account is now active again.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
    },
    onError: (err: any) => {
      toast({
        title: "Reactivation Failed",
        description: err?.message || "Failed to reactivate the organization.",
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateStr));
  };

  const handleOpenSuspend = (id: string) => {
    setSuspensionOrgId(id);
    setShowSuspensionDialog(true);
  };

  const handleConfirmSuspend = () => {
    if (!suspensionOrgId) return;
    suspendMutation.mutate({
      id: suspensionOrgId,
      reason: suspensionReason,
      note: suspensionNote,
    });
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Businesses Directory</h1>
          <p className="text-slate-400 text-sm mt-1">Audit platform accounts, check gross sales volume, and configure access.</p>
        </div>
      </div>

      {/* Query Filters */}
      <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Search Company Name</Label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <Input
              type="text"
              placeholder="Filter company..."
              className="bg-slate-950/60 border-slate-800 text-white pl-9 rounded-xl focus:border-emerald-500/80 focus:ring-emerald-500/20"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Administrative Status</Label>
          <Select
            value={status}
            onValueChange={(val) => {
              setStatus(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="bg-slate-950/60 border-slate-800 text-white rounded-xl focus:border-emerald-500/80">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Min Sales (GMV threshold)</Label>
          <Input
            type="number"
            placeholder="e.g. 100000"
            className="bg-slate-950/60 border-slate-800 text-white rounded-xl focus:border-emerald-500/80 focus:ring-emerald-500/20"
            value={minGMV}
            onChange={(e) => {
              setMinGMV(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <Button
          variant="outline"
          className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl h-11"
          onClick={() => {
            setSearch("");
            setStatus("all");
            setMinGMV("");
            setPage(1);
          }}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Reset Filters
        </Button>
      </div>

      {/* Main Directory Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
        </div>
      ) : error || !data ? (
        <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Error compiling business directories. Please refresh dashboard.</span>
        </div>
      ) : data.businesses.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
          <Building className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <h3 className="font-bold text-white text-base">No Businesses Found</h3>
          <p className="text-xs text-slate-500 mt-1">Adjust search parameters or verify registration timeline.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-6 py-4">Company Name</th>
                    <th className="px-6 py-4">Account Owner</th>
                    <th className="px-6 py-4">Created Date</th>
                    <th className="px-6 py-4">Usage Profile</th>
                    <th className="px-6 py-4 text-right">Gross GMV</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs font-semibold text-slate-300">
                  {data.businesses.map((org: any) => (
                    <tr key={org.id} className="hover:bg-slate-900/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center shrink-0 border border-slate-700 text-indigo-400">
                            <Building className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block font-bold text-white text-sm">{org.name}</span>
                            <span className="block text-[10px] text-slate-500 font-mono">slug: {org.slug}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-slate-500" />
                          <div>
                            <span className="block text-slate-200">{org.owner?.name}</span>
                            <span className="block text-[10px] text-slate-500">{org.owner?.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-[11px] text-slate-400">
                        {formatDate(org.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="block text-slate-300 font-mono">{org.staffCount} Staff Members</span>
                        <span className="block text-[10px] text-slate-500 font-mono">{org.transactionsCount} Checkouts</span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                        {formatCurrency(org.gmv)}
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant="outline"
                          className={`border-none font-bold uppercase tracking-wider text-[10px] ${
                            org.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : org.status === "trialing"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {org.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <Link href={`/super-admin/businesses/${org.id}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-xs"
                              title="Audit Profile"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>

                          {org.status === "active" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-800 text-rose-400 hover:text-white hover:bg-rose-950/40 rounded-lg text-xs"
                              onClick={() => handleOpenSuspend(org.id)}
                              title="Suspend Operation"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-800 text-emerald-400 hover:text-white hover:bg-emerald-950/40 rounded-lg text-xs"
                              onClick={() => reactivateMutation.mutate(org.id)}
                              title="Reactivate Operation"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table Pagination */}
          {data.pagination && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-2 text-xs text-slate-400 select-none">
              <span>
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} total companies)
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-800 text-slate-300 hover:bg-slate-900 rounded-xl"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-800 text-slate-300 hover:bg-slate-900 rounded-xl"
                  onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                  disabled={page === data.pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suspension Reasons Dialog */}
      <Dialog open={showSuspensionDialog} onOpenChange={setShowSuspensionDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center">
              <Ban className="h-6 w-6 text-rose-400 animate-pulse" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-white">
              Suspend Business Account
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              Suspension immediately invalidates all active user sessions for the organization and blocks standard API access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Suspension Reason Code</Label>
              <Select value={suspensionReason} onValueChange={setSuspensionReason}>
                <SelectTrigger className="bg-slate-950/60 border-slate-800 text-white rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                  <SelectItem value="policy_violation">Policy Violation (Terms of Service)</SelectItem>
                  <SelectItem value="non_payment">Non Payment of Subscription Fees</SelectItem>
                  <SelectItem value="fraudulent_activity">Fraudulent / Suspicious Activity</SelectItem>
                  <SelectItem value="owner_request">Owner Request (Close Account)</SelectItem>
                  <SelectItem value="inactivity">Long-term Account Inactivity</SelectItem>
                  <SelectItem value="other">Other Reason</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Compliance & Audit Notes</Label>
              <Textarea
                placeholder="Provide detailed context for this administrative override..."
                className="bg-slate-950/60 border-slate-800 text-white rounded-xl min-h-[90px] focus:border-rose-500/80 focus:ring-rose-500/20"
                value={suspensionNote}
                onChange={(e) => setSuspensionNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={() => setShowSuspensionDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold"
              onClick={handleConfirmSuspend}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? "Suspending..." : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
