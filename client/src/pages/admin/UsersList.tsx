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
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit">Users Directory</h1>
        <p className="text-muted-foreground text-sm mt-1">Audit merchant team structures, override forgotten credentials, and check anomalous login indicators.</p>
      </div>

      <Tabs defaultValue="directory" className="space-y-6">
        <TabsList className="bg-muted border border-border rounded-2xl p-1 gap-1">
          <TabsTrigger value="directory" className="rounded-xl text-xs font-bold data-[state=active]:bg-background data-[state=active]:text-foreground">Active Roster</TabsTrigger>
          <TabsTrigger value="flagged" className="rounded-xl text-xs font-bold data-[state=active]:bg-background data-[state=active]:text-foreground flex items-center gap-1.5">
            Flagged Inspector
            {flaggedData?.flagged && flaggedData.flagged.length > 0 && (
              <Badge className="bg-destructive text-destructive-foreground border-none h-4 w-4 rounded-full flex items-center justify-center p-0 text-[9px] font-bold">
                {flaggedData.flagged.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Directory Tab */}
        <TabsContent value="directory" className="space-y-6 animate-in fade-in duration-300">
          {/* Query Filters */}
          <div className="bg-card backdrop-blur border border-card-border rounded-3xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search Name/Email/Company</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Filter users..."
                  className="pl-9 rounded-xl"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Merchant Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Account Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-xl h-11"
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
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : usersError || !usersData ? (
            <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 rounded-2xl text-rose-700 dark:text-rose-400 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Error compiling user roster. Please verify connection.</span>
            </div>
          ) : usersData.users.length === 0 ? (
            <div className="text-center py-16 bg-muted/40 border border-border rounded-3xl">
              <User className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-foreground text-base">No Users Found</h3>
              <p className="text-xs text-muted-foreground mt-1">Adjust search parameters or check administrative sync filters.</p>
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-3xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="px-6 py-4">Full Name / Details</th>
                      <th className="px-6 py-4">Security Role</th>
                      <th className="px-6 py-4">Linked Business</th>
                      <th className="px-6 py-4 font-mono">Registered Date</th>
                      <th className="px-6 py-4 font-mono">Last Active</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-center">Overrides</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-xs font-semibold text-muted-foreground">
                    {usersData.users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-muted border border-border rounded-lg flex items-center justify-center shrink-0 font-bold text-primary">
                              {u.name[0]}
                            </div>
                            <div>
                              <span className="block font-bold text-foreground text-sm">{u.name}</span>
                              <span className="block text-[10px] text-muted-foreground font-mono select-all">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline" className="border-none font-bold uppercase text-[9px] bg-muted text-muted-foreground">
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className="block text-foreground text-sm truncate max-w-[150px]">{u.business}</span>
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-muted-foreground">
                          {formatDate(u.registered)}
                        </td>
                        <td className="px-6 py-4 font-mono text-[10px] text-muted-foreground">
                          {formatDate(u.lastLogin)}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="outline"
                            className={`border-none font-bold uppercase text-[9px] ${
                              u.status === "active"
                                ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400"
                                : u.status === "locked"
                                ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400"
                                : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400"
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
                              className="border-border text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg text-xs"
                              onClick={() => handleOpenPassword(u.id, u.email)}
                              title="Reset Password"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>

                            {u.status !== "deactivated" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-border text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg text-xs"
                                onClick={() => handleOpenSuspend(u.id)}
                                title="Lock Account"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-border text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded-lg text-xs"
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
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !flaggedData?.flagged || flaggedData.flagged.length === 0 ? (
            <div className="text-center py-16 bg-muted/40 border border-border rounded-3xl">
              <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-foreground text-base">No Flagged Accounts Scanned</h3>
              <p className="text-xs text-muted-foreground mt-1">Excellent! No account logins meet security audit alarm triggers.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {flaggedData.flagged.map((f: any, idx: number) => (
                <Card key={idx} className="rounded-3xl overflow-hidden hover:border-rose-500/30 transition-all duration-300 shadow-xl flex flex-col justify-between">
                  <CardHeader className="bg-muted/40 p-4 border-b border-border flex flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle className="h-4 w-4 text-rose-500 dark:text-rose-400 shrink-0" />
                      <CardTitle className="text-sm font-extrabold text-foreground truncate">{f.name}</CardTitle>
                    </div>
                    <Badge variant="outline" className="bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border-none text-[9px] font-bold uppercase shrink-0">
                      {f.flag}
                    </Badge>
                  </CardHeader>
                  <CardContent className="p-5 space-y-4 text-xs font-semibold text-muted-foreground flex-1 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="p-3 bg-muted border border-border rounded-2xl text-[11px] text-muted-foreground leading-relaxed font-medium">
                        <span className="font-bold text-foreground block mb-0.5">Anomaly Trigger:</span>
                        "{f.trigger}"
                      </div>
                      <div className="flex items-center gap-2.5 text-[10px]">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground truncate select-all font-mono">{f.email}</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-border text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-xl"
                        onClick={() => handleOpenSuspend(f.id)}
                      >
                        Lock Account
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-border text-muted-foreground hover:text-foreground rounded-xl"
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
        <DialogContent className="max-w-sm rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-muted border border-border rounded-2xl flex items-center justify-center">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              Password Override
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground">
              Directly rewrite the password hash in the database. Enter a new password for account: <strong className="text-foreground block mt-1 break-all">{selectedUserEmail}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">New Password (Min 8 characters)</Label>
            <Input
              type="password"
              placeholder="••••••••"
              className="rounded-xl"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setShowPasswordDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
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
        <DialogContent className="max-w-sm rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <div className="mx-auto w-12 h-12 bg-rose-100 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/30 rounded-2xl flex items-center justify-center">
              <Ban className="h-6 w-6 text-rose-500 dark:text-rose-400" />
            </div>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              Suspend User Account
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground">
              This will lock standard dashboard access for this individual user without suspending the entire business organization.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-1">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Audit Suspension Reason</Label>
            <Input
              type="text"
              placeholder="e.g. Suspected credential sharing"
              className="rounded-xl"
              value={suspensionReason}
              onChange={(e) => setSuspensionReason(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setShowSuspendDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground font-bold"
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
