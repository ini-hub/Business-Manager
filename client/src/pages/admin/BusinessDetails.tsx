import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building,
  User,
  Phone,
  Mail,
  Calendar,
  Activity,
  CreditCard,
  Users,
  Receipt,
  FileCheck,
  Ban,
  RotateCcw,
  Trash2,
  Loader2,
  AlertCircle,
  Clock,
  Briefcase,
  AlertTriangle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function BusinessDetails() {
  const { id } = useParams<{ id: string }>();
  const { admin } = useAdminAuth();
  const { toast } = useToast();

  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [suspensionReason, setSuspensionReason] = useState("policy_violation");
  const [suspensionNote, setSuspensionNote] = useState("");

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");

  // Fetch business details
  const { data, isLoading, error } = useQuery({
    queryKey: [`/api/admin/businesses/${id}`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/businesses/${id}`);
      return res.json();
    },
  });

  // Suspend Mutation
  const suspendMutation = useMutation({
    mutationFn: async ({ reason, note }: { reason: string; note: string }) => {
      const res = await apiRequest("POST", `/api/admin/businesses/${id}/suspend`, { reason, note });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Business Suspended",
        description: "The business account has been suspended and sessions invalidated.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/businesses/${id}`] });
      setShowSuspendDialog(false);
      setSuspensionNote("");
    },
    onError: (err: any) => {
      toast({
        title: "Suspension Failed",
        description: err?.message || "Failed to execute administrative suspension.",
        variant: "destructive",
      });
    },
  });

  // Reactivate Mutation
  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/businesses/${id}/reactivate`, {
        note: "Administrative restoration of services.",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Business Reactivated",
        description: "The business has been restored to active status.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/businesses/${id}`] });
    },
    onError: (err: any) => {
      toast({
        title: "Reactivation Failed",
        description: err?.message || "Failed to restore business account.",
        variant: "destructive",
      });
    },
  });

  // Soft Delete Mutation (Super Admin Only)
  const softDeleteMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest("DELETE", `/api/admin/businesses/${id}`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Soft Delete Initialized",
        description: "The business is flagged for deletion. A 30-day grace period is active.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
      window.location.href = "/super-admin/businesses";
    },
    onError: (err: any) => {
      toast({
        title: "Soft Delete Failed",
        description: err?.message || "Failed to soft-delete the business.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 bg-rose-500/10 border border-rose-500/20 rounded-3xl text-rose-300 max-w-xl mx-auto flex gap-4">
        <AlertCircle className="h-8 w-8 shrink-0" />
        <div>
          <h3 className="font-bold text-white">Business Audit Failed</h3>
          <p className="text-sm mt-1">Failed to query business details. Verify the UUID or database server logs.</p>
          <Link href="/super-admin/businesses" className="mt-4 inline-block text-xs font-bold underline">
            Return to Directory
          </Link>
        </div>
      </div>
    );
  }

  const { profile, usageSummary, users: usersList, transactions, activityLogs } = data;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateStr));
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Back button & Action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Link href="/super-admin/businesses">
          <button className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
            Back to Directory
          </button>
        </Link>

        {/* Administration Overrides Controls */}
        <div className="flex flex-wrap gap-2">
          {profile.status === "active" ? (
            <Button
              variant="outline"
              className="border-slate-800 text-rose-400 hover:bg-rose-950/40 rounded-xl"
              onClick={() => setShowSuspendDialog(true)}
            >
              <Ban className="mr-2 h-4 w-4" />
              Suspend Business
            </Button>
          ) : (
            <Button
              variant="outline"
              className="border-slate-800 text-emerald-400 hover:bg-emerald-950/40 rounded-xl"
              onClick={() => reactivateMutation.mutate()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reactivate Account
            </Button>
          )}

          {admin?.role === "super_admin" && (
            <Button
              variant="destructive"
              className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Business
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Info card left, Tabs center */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info Card Left */}
        <div className="space-y-6">
          <Card className="bg-slate-900/40 backdrop-blur border-slate-800/80 rounded-3xl overflow-hidden shadow-xl">
            <CardHeader className="bg-slate-950/20 px-6 py-5 border-b border-slate-800/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-center text-indigo-400 shrink-0">
                  <Building className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-lg font-black text-white truncate">{profile.name}</CardTitle>
                  <span className="text-[10px] text-slate-500 font-mono">ID: {profile.id.substring(0, 8)}...</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="flex justify-between items-center pb-3 border-b border-slate-800/40">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Status</span>
                <Badge
                  variant="outline"
                  className={`border-none font-bold uppercase tracking-wider text-[10px] ${
                    profile.status === "active"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-rose-500/10 text-rose-400"
                  }`}
                >
                  {profile.status}
                </Badge>
              </div>

              {profile.status === "suspended" && (
                <div className="p-4 bg-rose-500/5 border border-rose-500/20 rounded-2xl space-y-1.5 text-xs text-rose-300">
                  <span className="block font-bold">Suspension Log:</span>
                  <span className="block font-medium">Reason: {profile.suspensionReason}</span>
                  {profile.suspensionNote && <span className="block text-[10px] leading-relaxed italic">"{profile.suspensionNote}"</span>}
                  <span className="block text-[10px] text-slate-500 font-mono">At: {formatDate(profile.suspendedAt)}</span>
                </div>
              )}

              <div className="space-y-4 pt-1">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Account Owner</h4>
                {profile.owner ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5 text-xs">
                      <User className="h-4 w-4 text-slate-500 shrink-0" />
                      <span className="font-semibold text-slate-300 truncate">{profile.owner.name}</span>
                    </div>
                    {profile.owner.email && (
                      <div className="flex items-center gap-2.5 text-xs">
                        <Mail className="h-4 w-4 text-slate-500 shrink-0" />
                        <span className="text-slate-400 truncate select-all">{profile.owner.email}</span>
                      </div>
                    )}
                    {profile.owner.phone && (
                      <div className="flex items-center gap-2.5 text-xs">
                        <Phone className="h-4 w-4 text-slate-500 shrink-0" />
                        <span className="text-slate-400 truncate font-mono">{profile.owner.phone}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 italic block">No owner account linked.</span>
                )}
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-800/40 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Slug Key</span>
                  <span className="font-mono text-slate-300">{profile.slug}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Prefix</span>
                  <span className="font-mono text-slate-300">{profile.receiptPrefix || "None"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Address</span>
                  <span className="text-slate-300 text-right truncate max-w-[150px]">{profile.address || "Nigeria"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Registered</span>
                  <span className="font-mono text-slate-400 text-[10px]">{formatDate(profile.createdAt).substring(0, 12)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabbed Viewport Right */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="bg-slate-900 border border-slate-800 rounded-2xl p-1 gap-1">
              <TabsTrigger value="overview" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Overview</TabsTrigger>
              <TabsTrigger value="users" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Roster</TabsTrigger>
              <TabsTrigger value="transactions" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Transactions</TabsTrigger>
              <TabsTrigger value="logs" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Audit trail</TabsTrigger>
            </TabsList>

            {/* Overview Tab Content */}
            <TabsContent value="overview" className="space-y-6 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card className="bg-slate-900/40 border-slate-800/80 rounded-2xl hover:border-slate-700/80 transition-colors">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Gross Sales</span>
                    <CreditCard className="h-4 w-4 text-emerald-400" />
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <span className="text-2xl font-black text-white font-mono">{formatCurrency(usageSummary.allTime.gmv)}</span>
                    <p className="text-[10px] text-slate-500">All-time sales GMV</p>
                  </CardContent>
                </Card>

                <Card className="bg-slate-900/40 border-slate-800/80 rounded-2xl hover:border-slate-700/80 transition-colors">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Outstanding Credit</span>
                    <Clock className="h-4 w-4 text-amber-500" />
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <span className="text-2xl font-black text-white font-mono">{formatCurrency(usageSummary.allTime.outstandingCredit)}</span>
                    <p className="text-[10px] text-slate-500">Outstanding ledger balance</p>
                  </CardContent>
                </Card>

                <Card className="bg-slate-900/40 border-slate-800/80 rounded-2xl hover:border-slate-700/80 transition-colors">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Checkouts</span>
                    <Receipt className="h-4 w-4 text-indigo-400" />
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <span className="text-2xl font-black text-white font-mono">{usageSummary.allTime.transactions}</span>
                    <p className="text-[10px] text-slate-500">Total checkout receipts</p>
                  </CardContent>
                </Card>
              </div>

              {/* Metrics Detail Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden">
                  <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-4">
                    <CardTitle className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-emerald-400" />
                      Platform Footprint Summary (All-Time)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4 text-xs font-semibold text-slate-300">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="text-slate-500">Registered Staff</span>
                      <span className="font-mono text-white">{usageSummary.allTime.staff}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="text-slate-500">Database Customers</span>
                      <span className="font-mono text-white">{usageSummary.allTime.customers}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="text-slate-500">Inventory Items</span>
                      <span className="font-mono text-white">{usageSummary.allTime.inventoryItems}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">Calendar Bookings</span>
                      <span className="font-mono text-white">{usageSummary.allTime.bookings}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden">
                  <CardHeader className="border-b border-slate-800/80 bg-slate-950/20 px-6 py-4">
                    <CardTitle className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Activity className="h-4 w-4 text-indigo-400" />
                      Trading Activity (Last 30 Days)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4 text-xs font-semibold text-slate-300">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="text-slate-500">Gross Sales Value</span>
                      <span className="font-mono text-emerald-400">{formatCurrency(usageSummary.last30Days.gmv)}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                      <span className="text-slate-500">Transactions Count</span>
                      <span className="font-mono text-white">{usageSummary.last30Days.transactions}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500">New Customer Signups</span>
                      <span className="font-mono text-white">{usageSummary.last30Days.newCustomers}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Roster Tab Content */}
            <TabsContent value="users" className="bg-slate-900/40 border border-slate-800/80 rounded-3xl overflow-hidden animate-in fade-in duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-6 py-4">User Details</th>
                      <th className="px-6 py-4">Security Role</th>
                      <th className="px-6 py-4">Account Status</th>
                      <th className="px-6 py-4">Last Activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs font-semibold text-slate-300">
                    {usersList.map((user: any) => (
                      <tr key={user.id} className="hover:bg-slate-900/10">
                        <td className="px-6 py-4">
                          <span className="block font-bold text-white text-sm">{user.name}</span>
                          <span className="block text-[10px] text-slate-500 font-mono select-all">{user.email}</span>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="border-none font-bold uppercase text-[9px] bg-slate-800 text-slate-300">
                            {user.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={`border-none font-bold uppercase text-[9px] ${
                              user.status === "active"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {user.status || "active"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                          {formatDate(user.lastLogin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* Transactions Tab Content */}
            <TabsContent value="transactions" className="bg-slate-900/40 border border-slate-800/80 rounded-3xl overflow-hidden animate-in fade-in duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-6 py-4">Receipt ID</th>
                      <th className="px-6 py-4">Checkout Timing</th>
                      <th className="px-6 py-4 text-right">Receipt Total</th>
                      <th className="px-6 py-4">Payment Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs font-semibold text-slate-300">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-500 italic">No checkout records compiled for this trading session.</td>
                      </tr>
                    ) : (
                      transactions.map((tx: any) => (
                        <tr key={tx.id} className="hover:bg-slate-900/10">
                          <td className="px-6 py-4 font-mono font-bold text-white">
                            {tx.receiptNumber}
                          </td>
                          <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                            {formatDate(tx.createdAt)}
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
                            {formatCurrency(tx.totalPrice || tx.totalCharged)}
                          </td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className="border-none font-bold uppercase text-[9px] bg-slate-800 text-slate-400">
                              {tx.paymentMethod}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* Operations Audit Logs Tab Content */}
            <TabsContent value="logs" className="bg-slate-900/40 border border-slate-800/80 rounded-3xl overflow-hidden animate-in fade-in duration-300">
              <div className="divide-y divide-slate-800">
                {activityLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 italic text-sm">No administrative audit trails synced to this business.</div>
                ) : (
                  activityLogs.map((log: any) => (
                    <div key={log.id} className="px-6 py-4 space-y-1 hover:bg-slate-900/10">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <FileCheck className="h-4 w-4 text-indigo-400 shrink-0" />
                          {log.action.replace("_", " ")}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">{formatDate(log.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Executed by: <span className="font-bold text-slate-300">{log.adminEmail}</span> ({log.adminRole})
                      </p>
                      {log.details && (
                        <code className="block p-2 bg-slate-950 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-400 overflow-x-auto whitespace-pre">
                          {JSON.stringify(log.details)}
                        </code>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Suspension Reasons Dialog */}
      <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center">
              <Ban className="h-6 w-6 text-rose-400 animate-pulse" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-white">
              Suspend Business Account
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              Administrative suspension immediately blocks standard API logins and customer-facing dashboard screens.
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
                placeholder="Provide detailed compliance context for this administrative override..."
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
              onClick={() => setShowSuspendDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold"
              onClick={() => suspendMutation.mutate({ reason: suspensionReason, note: suspensionNote })}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? "Suspending..." : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destruction Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-rose-400 animate-bounce" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-white">
              Initialize Deletion Grace Period
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              <span className="block text-rose-400 font-bold mb-2">WARNING: DESTRUCTIVE ACTION</span>
              This will soft-delete the business. A strict **30-day recovery grace period** starts. If not restored, all databases, inventory structures, and checkout logs will be permanently deleted automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 my-4">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reason for Account Purge</Label>
            <Textarea
              placeholder="Provide exact reasons for platform exclusion..."
              className="bg-slate-950/60 border-slate-800 text-white rounded-xl min-h-[90px]"
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-slate-800 text-slate-400 hover:bg-slate-800"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold"
              onClick={() => softDeleteMutation.mutate(deletionReason)}
              disabled={softDeleteMutation.isPending || !deletionReason}
            >
              {softDeleteMutation.isPending ? "Purging..." : "Initialize 30d Deletion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
