import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShieldAlert,
  UserPlus,
  Shield,
  Loader2,
  AlertCircle,
  KeyRound,
  UserX,
  UserCheck,
  CheckCircle,
  QrCode,
  Copy,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { validateEmail } from "@/lib/validation-utils";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function SuperAdminAccounts() {
  const { admin: currentAdmin } = useAdminAuth();
  const { toast } = useToast();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMfaDetailsDialog, setShowMfaDetailsDialog] = useState(false);
  const [mfaDetails, setMfaDetails] = useState<any>(null);

  // Creation Form States
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("ops_manager");

  // Query admins roster
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/super-admins"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/super-admins");
      return res.json();
    },
  });

  // Create admin mutation
  const createAdminMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/admin/super-admins", payload);
      return res.json();
    },
    onSuccess: (resData) => {
      toast({
        title: "Internal Admin Account Seeding Successful",
        description: `Credentials generated for ${resData.admin.name}. MFA configuration required.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/super-admins"] });
      setShowCreateDialog(false);
      resetForm();

      // Store generated MFA details and show credentials details modal
      setMfaDetails({
        name: resData.admin.name,
        email: resData.admin.email,
        mfaSecret: resData.mfaSecret,
        qrUrl: resData.qrUrl,
      });
      setShowMfaDetailsDialog(true);
    },
    onError: (err: any) => {
      toast({
        title: "Account Creation Failed",
        description: err?.message || "Verify parameters or check network status.",
        variant: "destructive",
      });
    },
  });

  // Reset MFA mutation
  const resetMfaMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/super-admins/${id}/reset-mfa`);
      return res.json();
    },
    onSuccess: (resData) => {
      toast({
        title: "MFA Authentication Reset",
        description: "Old authenticator pairing revoked. New QR secret generated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/super-admins"] });

      // Store generated MFA details and show dialog
      setMfaDetails({
        email: resData.message,
        mfaSecret: resData.mfaSecret,
        qrUrl: resData.qrUrl,
      });
      setShowMfaDetailsDialog(true);
    },
    onError: (err: any) => {
      toast({
        title: "MFA Reset Failed",
        description: err?.message || "Failed to reset security keys.",
        variant: "destructive",
      });
    },
  });

  // Toggle status mutation (soft suspension)
  const toggleStatusMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/super-admins/${id}`);
      return res.json();
    },
    onSuccess: (resData) => {
      toast({
        title: "Security Ledger Updated",
        description: resData.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/super-admins"] });
    },
    onError: (err: any) => {
      toast({
        title: "Status Override Failed",
        description: err?.message || "Failed to complete account override.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("ops_manager");
  };

  const handleCreateSubmit = () => {
    if (!name || !email || !password || !role) {
      toast({ title: "Required Fields", description: "Please specify name, email, password and security clearance role.", variant: "destructive" });
      return;
    }
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) {
      toast({ title: "Invalid Email", description: emailCheck.error, variant: "destructive" });
      return;
    }
    createAdminMutation.mutate({ name, email, password, role });
  };

  const handleCopySecret = () => {
    if (mfaDetails?.mfaSecret) {
      navigator.clipboard.writeText(mfaDetails.mfaSecret);
      toast({
        title: "Copied to Clipboard",
        description: "MFA Secret code copied successfully.",
      });
    }
  };

  const isSuperAdmin = currentAdmin?.role === "super_admin";

  const getRoleBadgeColor = (roleStr: string) => {
    switch (roleStr) {
      case "super_admin":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "ops_manager":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "finance_admin":
        return "bg-emerald-500/10 text-emerald-450 border-emerald-500/20";
      default:
        return "bg-sky-500/10 text-sky-400 border-sky-500/20";
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Super Admin Accounts</h1>
          <p className="text-slate-400 text-sm mt-1">Manage internal operations clearance levels, resets, and MFA configuration keys.</p>
        </div>
        {isSuperAdmin && (
          <Button
            className="rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold self-start sm:self-auto"
            onClick={() => {
              resetForm();
              setShowCreateDialog(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Provision Admin
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        </div>
      ) : error || !data?.admins ? (
        <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Failure querying administrative account directory.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
          {data.admins.map((adm: any) => {
            const isSelf = adm.id === currentAdmin?.id;
            const isActive = adm.status === "active";

            return (
              <Card key={adm.id} className="bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden hover:border-slate-700/80 transition-all duration-300 flex flex-col justify-between shadow-xl">
                <CardHeader className="bg-slate-950/20 p-5 border-b border-slate-800/40 flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-sm font-extrabold text-white truncate font-outfit flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-400 shrink-0" />
                      {adm.name}
                    </CardTitle>
                    <span className="block text-[11px] text-slate-500 truncate">{adm.email}</span>
                  </div>
                  {isSelf && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-none font-bold text-[8px] uppercase">
                      YOU
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="p-5 space-y-4 text-xs font-semibold text-slate-350 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-1.5 border-b border-slate-850">
                      <span className="text-slate-500">Access Role</span>
                      <Badge variant="outline" className={`border ${getRoleBadgeColor(adm.role)} text-[9px] font-bold uppercase`}>
                        {adm.role.replace("_", " ")}
                      </Badge>
                    </div>

                    <div className="flex justify-between items-center py-1.5 border-b border-slate-850">
                      <span className="text-slate-500">MFA Configured</span>
                      <div className="flex items-center gap-1.5">
                        {adm.mfaEnabled ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-450 border-none text-[9px] font-bold">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-none text-[9px] font-bold">
                            Pending pairing
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-slate-500">Account Status</span>
                      <Badge variant="outline" className={`border-none ${isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-450"} text-[9px] font-bold uppercase`}>
                        {adm.status}
                      </Badge>
                    </div>
                  </div>

                  {isSuperAdmin && (
                    <div className="pt-4 border-t border-slate-800/40 flex items-center justify-between gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-800 text-slate-400 hover:text-white rounded-lg px-2 text-[10px] font-bold"
                        onClick={() => resetMfaMutation.mutate(adm.id)}
                        disabled={resetMfaMutation.isPending}
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1" />
                        Reset MFA
                      </Button>
                      {!isSelf && (
                        <Button
                          size="sm"
                          variant="outline"
                          className={`border-slate-800 rounded-lg px-2 text-[10px] font-bold ${
                            isActive ? "text-rose-400 hover:bg-rose-950/40" : "text-emerald-400 hover:bg-emerald-950/40"
                          }`}
                          onClick={() => toggleStatusMutation.mutate(adm.id)}
                          disabled={toggleStatusMutation.isPending}
                        >
                          {isActive ? (
                            <>
                              <UserX className="h-3.5 w-3.5 mr-1" />
                              Suspend
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-3.5 w-3.5 mr-1" />
                              Reactivate
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Account Creation Modal */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-white font-outfit">Provision Internal Admin</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Register a new corporate user within internal company operations databases.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Full Name</Label>
              <Input
                placeholder="e.g. John Doe"
                className="bg-slate-950 border-slate-800 text-white rounded-xl text-xs"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Administrative Email Address</Label>
              <Input
                type="email"
                placeholder="e.g. jdoe@company.com"
                className="bg-slate-950 border-slate-800 text-white rounded-xl text-xs font-mono"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Temporary Password</Label>
              <Input
                type="password"
                placeholder="Make it extremely secure..."
                className="bg-slate-950 border-slate-800 text-white rounded-xl text-xs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Clearance Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-350">
                  <SelectItem value="ops_manager">Operations Manager (ops_manager)</SelectItem>
                  <SelectItem value="super_admin">Platform Director (super_admin)</SelectItem>
                  <SelectItem value="finance_admin">Finance Auditor (finance_admin)</SelectItem>
                  <SelectItem value="support_agent">Support Agent (support_agent)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-slate-800 text-slate-400 hover:bg-slate-800"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
              onClick={handleCreateSubmit}
              disabled={createAdminMutation.isPending}
            >
              Confirm Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MFA Security Credentials Pairing Details Modal */}
      <Dialog open={showMfaDetailsDialog} onOpenChange={setShowMfaDetailsDialog}>
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6 font-sans">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-bold text-white font-outfit flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-450" />
              MFA Configuration Credentials
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Provide these keys to the administrator. They must pair this immediately using Google Authenticator or generic TOTP clients.
            </DialogDescription>
          </DialogHeader>

          {mfaDetails && (
            <div className="space-y-5 my-3 text-xs leading-relaxed text-slate-300 text-center">
              <div className="flex justify-center p-4 bg-white rounded-2xl max-w-[200px] mx-auto shadow-lg border border-slate-100">
                {/* Dynamically render QR Code payload or fallback visually */}
                <div className="flex flex-col items-center justify-center text-slate-950 font-bold space-y-2">
                  <QrCode className="h-28 w-28 text-slate-900" />
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Pairing QR Code</span>
                </div>
              </div>

              <div className="space-y-1.5 text-left bg-slate-950/60 border border-slate-850 p-4 rounded-2xl">
                <span className="block text-[9px] text-slate-500 uppercase tracking-widest font-bold">Verification Secret Code</span>
                <div className="flex items-center justify-between gap-3">
                  <code className="text-indigo-400 font-mono text-[11px] select-all truncate">{mfaDetails.mfaSecret}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:bg-slate-800 text-slate-400 p-1.5 h-8 rounded-lg shrink-0"
                    onClick={handleCopySecret}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-left text-amber-300">
                <span className="font-bold block text-white mb-0.5">⚠️ Security Warning</span>
                This secret is only shown once. Ensure the user records this immediately before closing this inspector dialog.
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl px-5"
              onClick={() => {
                setShowMfaDetailsDialog(false);
                setMfaDetails(null);
              }}
            >
              Done / Securely Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
