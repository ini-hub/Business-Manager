import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search,
  User,
  Building,
  KeyRound,
  Ban,
  RotateCcw,
  AlertTriangle,
  Mail,
  Shield,
  Loader2,
  AlertCircle,
  Clock,
  Eye,
  SlidersHorizontal,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function UsersList() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  // Overrides State
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserEmail, setSelectedUserEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [suspensionReason, setSuspensionReason] = useState("");

  // Query all users
  const { data: usersData, isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ["/api/admin/users", { role: role === "all" ? "" : role, status: status === "all" ? "" : status, search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (role && role !== "all") params.append("role", role);
      if (status && status !== "all") params.append("status", status);
      if (search) params.append("search", search);
      const res = await apiRequest("GET", `/api/admin/users?${params.toString()}`);
      return res.json();
    },
  });

  // Query flagged anomaly accounts
  const { data: flaggedData, isLoading: flaggedLoading } = useQuery({
    queryKey: ["/api/admin/users/flagged"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/users/flagged");
      return res.json();
    },
  });

  // Password Reset Mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, pw }: { id: string; pw: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/reset-password`, { password: pw });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Credentials Overridden",
        description: "Standard account password has been successfully reset.",
      });
      setShowPasswordDialog(false);
      setSelectedUserId(null);
      setNewPassword("");
    },
    onError: (err: any) => {
      toast({
        title: "Override Failed",
        description: err?.message || "Failed to update password.",
        variant: "destructive",
      });
    },
  });

  // Toggle user suspension state mutation
  const toggleSuspendMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${id}/suspend`, { reason });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Account Status Updated",
        description: data.message || "User account access successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/flagged"] });
      setShowSuspendDialog(false);
      setSelectedUserId(null);
      setSuspensionReason("");
    },
    onError: (err: any) => {
      toast({
        title: "Update Failed",
        description: err?.message || "Failed to update account suspension.",
        variant: "destructive",
      });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  const handleOpenPassword = (id: string, email: string) => {
    setSelectedUserId(id);
    setSelectedUserEmail(email);
    setShowPasswordDialog(true);
  };

  const handleOpenSuspend = (id: string) => {
    setSelectedUserId(id);
    setShowSuspendDialog(true);
  };

  const handleConfirmPassword = () => {
    if (!selectedUserId || newPassword.length < 8) {
      toast({
        title: "Invalid Password",
        description: "Password must contain at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    resetPasswordMutation.mutate({ id: selectedUserId, pw: newPassword });
  };

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Users Directory</h1>
        <p className="text-slate-400 text-sm mt-1">Audit merchant team structures, override forgotten credentials, and check anomalous login indicators.</p>
      </div>

      <Tabs defaultValue="directory" className="space-y-6">
        <TabsList className="bg-slate-900 border border-slate-800 rounded-2xl p-1 gap-1">
          <TabsTrigger value="directory" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white">Active Roster</TabsTrigger>
          <TabsTrigger value="flagged" className="rounded-xl text-xs font-bold data-[state=active]:bg-slate-800 data-[state=active]:text-white flex items-center gap-1.5">
            Flagged Inspector
            {flaggedData?.flagged && flaggedData.flagged.length > 0 && (
              <Badge className="bg-rose-500 text-white border-none h-4 w-4 rounded-full flex items-center justify-center p-0 text-[9px] font-bold">
                {flaggedData.flagged.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Directory Tab */}
        <TabsContent value="directory" className="space-y-6 animate-in fade-in duration-300">
          {/* Query Filters */}
          <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Search Name/Email/Company</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  type="text"
                  placeholder="Filter users..."
                  className="bg-slate-950/60 border-slate-800 text-white pl-9 rounded-xl focus:border-emerald-500/80"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Merchant Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="bg-slate-950/60 border-slate-800 text-white rounded-xl focus:border-emerald-500/80">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Account Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-slate-950/60 border-slate-800 text-white rounded-xl focus:border-emerald-500/80">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl h-11"
              onClick={() => {
                setSearch("");
                setRole("all");
                setStatus("all");
              }}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Reset Filters
            </Button>
          </div>

          {/* Table */}
          {usersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : usersError || !usersData ? (
            <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Error compiling user roster. Please verify connection.</span>
            </div>
          ) : usersData.users.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
              <User className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <h3 className="font-bold text-white text-base">No Users Found</h3>
              <p className="text-xs text-slate-500 mt-1">Adjust search parameters or check administrative sync filters.</p>
            </div>
          ) : (
            <div className="bg-slate-900/40 backdrop-blur border border-slate-800/80 rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-6 py-4">Full Name / Details</th>
                      <th className="px-6 py-4">Security Role</th>
                      <th className="px-6 py-4">Linked Business</th>
                      <th className="px-6 py-4 font-mono">Registered Date</th>
                      <th className="px-6 py-4 font-mono">Last Active</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-center">Overrides</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-xs font-semibold text-slate-300">
                    {usersData.users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-slate-900/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-850 border border-slate-700 rounded-lg flex items-center justify-center shrink-0 font-bold text-emerald-400">
                              {u.name[0]}
                            </div>
                            <div>
                              <span className="block font-bold text-white text-sm">{u.name}</span>
                              <span className="block text-[10px] text-slate-500 font-mono select-all">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="border-none font-bold uppercase text-[9px] bg-slate-800 text-slate-300">
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className="block text-slate-200 text-sm truncate max-w-[150px]">{u.business}</span>
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                          {formatDate(u.registered)}
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                          {formatDate(u.lastLogin)}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={`border-none font-bold uppercase text-[9px] ${
                              u.status === "active"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : u.status === "locked"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {u.status || "active"}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-xs"
                              onClick={() => handleOpenPassword(u.id, u.email)}
                              title="Reset Password"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>

                            {u.status !== "deactivated" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-slate-800 text-rose-400 hover:text-white hover:bg-rose-950/40 rounded-lg text-xs"
                                onClick={() => handleOpenSuspend(u.id)}
                                title="Lock Account"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-slate-800 text-emerald-400 hover:text-white hover:bg-emerald-950/40 rounded-lg text-xs"
                                onClick={() => toggleSuspendMutation.mutate({ id: u.id, reason: "" })}
                                title="Unlock Account"
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
          )}
        </TabsContent>

        {/* Flagged Accounts Tab */}
        <TabsContent value="flagged" className="space-y-6 animate-in fade-in duration-300">
          {flaggedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          ) : !flaggedData?.flagged || flaggedData.flagged.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
              <Shield className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <h3 className="font-bold text-white text-base">No Flagged Accounts Scanned</h3>
              <p className="text-xs text-slate-500 mt-1">Excellent! No account logins meet security audit alarm triggers.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {flaggedData.flagged.map((f: any, idx: number) => (
                <Card key={idx} className="bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden hover:border-rose-500/20 transition-all duration-300 shadow-xl flex flex-col justify-between">
                  <CardHeader className="bg-slate-950/20 p-4 border-b border-slate-800/40 flex flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                      <CardTitle className="text-sm font-extrabold text-white truncate">{f.name}</CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-none text-[9px] font-bold uppercase shrink-0">
                      {f.flag}
                    </Badge>
                  </CardHeader>
                  <CardContent className="p-5 space-y-4 text-xs font-semibold text-slate-300 flex-1 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="p-3 bg-slate-950/60 border border-slate-850 rounded-2xl text-[11px] text-slate-400 leading-relaxed font-medium">
                        <span className="font-bold text-white block mb-0.5">Anomaly Trigger:</span>
                        "{f.trigger}"
                      </div>
                      <div className="flex items-center gap-2.5 text-[10px]">
                        <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-slate-400 truncate select-all font-mono">{f.email}</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800/40 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-slate-800 text-rose-400 hover:bg-rose-950/40 rounded-xl"
                        onClick={() => handleOpenSuspend(f.id)}
                      >
                        Lock Account
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-slate-800 text-slate-400 hover:text-white rounded-xl"
                        onClick={() => handleOpenPassword(f.id, f.email)}
                      >
                        Override PW
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Password Reset Override Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-sm rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-center">
              <KeyRound className="h-6 w-6 text-emerald-400" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-white">
              Password Override
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              Directly rewrite the password hash in the database. Enter a new password for account: <strong className="text-slate-200 block mt-1 break-all">{selectedUserEmail}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New Password (Min 8 characters)</Label>
            <Input
              type="password"
              placeholder="••••••••"
              className="bg-slate-950 border-slate-800 text-white rounded-xl focus:border-emerald-500/80"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={() => setShowPasswordDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold"
              onClick={handleConfirmPassword}
              disabled={resetPasswordMutation.isPending}
            >
              {resetPasswordMutation.isPending ? "Overriding..." : "Confirm Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Specific User Dialog */}
      <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-sm rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center">
              <Ban className="h-6 w-6 text-rose-400" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-white">
              Suspend User Account
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-slate-400">
              This will lock standard dashboard access for this individual user without suspending the entire business organization.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Audit Suspension Reason</Label>
            <Input
              type="text"
              placeholder="e.g. Suspected credential sharing"
              className="bg-slate-950 border-slate-800 text-white rounded-xl focus:border-rose-500/80"
              value={suspensionReason}
              onChange={(e) => setSuspensionReason(e.target.value)}
            />
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
              onClick={() => toggleSuspendMutation.mutate({ id: selectedUserId!, reason: suspensionReason })}
              disabled={toggleSuspendMutation.isPending}
            >
              {toggleSuspendMutation.isPending ? "Locking..." : "Confirm Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
