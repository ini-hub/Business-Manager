import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ToggleLeft,
  Plus,
  Edit2,
  Trash2,
  HelpCircle,
  Loader2,
  AlertCircle,
  Save,
  CheckCircle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function FeatureFlags() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<any>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("off");
  const [scopedOrgIdsStr, setScopedOrgIdsStr] = useState("");
  const [subscriptionTier, setSubscriptionTier] = useState("none");

  // Query feature flags
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/feature-flags");
      return res.json();
    },
  });

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async (flag: any) => {
      const res = await apiRequest("POST", "/api/admin/feature-flags", flag);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Feature Flag Created",
        description: "The new beta feature flag is active in system routers.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      setShowCreateDialog(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Registration Failed",
        description: err?.message || "Failed to create flag.",
        variant: "destructive",
      });
    },
  });

  // Edit Mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, flag }: { id: string; flag: any }) => {
      const res = await apiRequest("PUT", `/api/admin/feature-flags/${id}`, flag);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Feature Flag Updated",
        description: "The flag attributes have been rewritten successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      setShowEditDialog(false);
      setSelectedFlag(null);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Update Failed",
        description: err?.message || "Failed to update flag.",
        variant: "destructive",
      });
    },
  });

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/feature-flags/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Feature Flag Purged",
        description: "The feature flag has been permanently deleted from routing schemas.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
    },
    onError: (err: any) => {
      toast({
        title: "Purge Failed",
        description: err?.message || "Failed to delete flag.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setStatus("off");
    setScopedOrgIdsStr("");
    setSubscriptionTier("none");
  };

  const handleOpenEdit = (flag: any) => {
    setSelectedFlag(flag);
    setName(flag.name);
    setDescription(flag.description);
    setStatus(flag.status);
    setScopedOrgIdsStr(flag.scopedOrgIds ? JSON.stringify(flag.scopedOrgIds) : "");
    setSubscriptionTier(flag.subscriptionTier || "none");
    setShowEditDialog(true);
  };

  const handleCreateSubmit = () => {
    if (!name || !description) {
      toast({
        title: "Missing fields",
        description: "Name and description are required.",
        variant: "destructive",
      });
      return;
    }

    let scopedOrgIds = null;
    if (status === "scoped" && scopedOrgIdsStr) {
      try {
        scopedOrgIds = JSON.parse(scopedOrgIdsStr);
        if (!Array.isArray(scopedOrgIds)) throw new Error();
      } catch (e) {
        toast({
          title: "JSON parsing error",
          description: "Scoped Organization IDs must be a valid JSON array of strings, e.g. [\"id1\", \"id2\"]",
          variant: "destructive",
        });
        return;
      }
    }

    createMutation.mutate({
      name,
      description,
      status,
      scopedOrgIds,
      subscriptionTier: subscriptionTier === "none" ? null : subscriptionTier,
    });
  };

  const handleEditSubmit = () => {
    if (!selectedFlag) return;

    let scopedOrgIds = null;
    if (status === "scoped" && scopedOrgIdsStr) {
      try {
        scopedOrgIds = JSON.parse(scopedOrgIdsStr);
        if (!Array.isArray(scopedOrgIds)) throw new Error();
      } catch (e) {
        toast({
          title: "JSON parsing error",
          description: "Scoped Organization IDs must be a valid JSON array of strings.",
          variant: "destructive",
        });
        return;
      }
    }

    editMutation.mutate({
      id: selectedFlag.id,
      flag: {
        description,
        status,
        scopedOrgIds,
        subscriptionTier: subscriptionTier === "none" ? null : subscriptionTier,
      },
    });
  };

  const isSuperAdmin = admin?.role === "super_admin";

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit">Feature Flags</h1>
          <p className="text-muted-foreground text-sm mt-1">Configure global beta channels, scope experimental modules, or unlock pricing-tier features.</p>
        </div>
        {isSuperAdmin && (
          <Button
            className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold self-start sm:self-auto"
            onClick={() => {
              resetForm();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Feature Flag
          </Button>
        )}
      </div>

      {/* Main flags display grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error || !data?.flags ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Error compiling platform feature flags list.</span>
        </div>
      ) : data.flags.length === 0 ? (
        <div className="text-center py-16 bg-card/20 border border-border/80 rounded-3xl">
          <ToggleLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground text-base">No Feature Flags Declared</h3>
          <p className="text-xs text-muted-foreground mt-1">Initialize dynamic beta channels by declaring your first feature flag.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
          {data.flags.map((flag: any) => {
            let statusBadgeColor = "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400";
            if (flag.status === "on") statusBadgeColor = "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400";
            else if (flag.status === "scoped") statusBadgeColor = "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-400";
            else if (flag.status === "by_plan") statusBadgeColor = "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400";

            return (
              <Card key={flag.id} className="bg-card/40 border-border/80 rounded-3xl overflow-hidden hover:border-border/80 transition-all duration-300 flex flex-col justify-between shadow-xl">
                <CardHeader className="bg-background/20 p-4 border-b border-border/40 flex flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ToggleLeft className="h-5 w-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <CardTitle className="text-sm font-extrabold text-foreground truncate font-mono">{flag.name}</CardTitle>
                  </div>
                  <Badge variant="outline" className={`border-none text-[9px] font-bold uppercase shrink-0 ${statusBadgeColor}`}>
                    {flag.status}
                  </Badge>
                </CardHeader>
                <CardContent className="p-5 space-y-4 text-xs font-semibold text-muted-foreground flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted-foreground leading-relaxed font-medium">
                      {flag.description}
                    </p>

                    {flag.status === "scoped" && flag.scopedOrgIds && (
                      <div className="p-2.5 bg-background/60 border border-border rounded-xl space-y-1">
                        <span className="block text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Scoped Tenant Tenants:</span>
                        <code className="block text-[9px] font-mono text-indigo-600 dark:text-indigo-400 break-all overflow-x-auto whitespace-pre">
                          {JSON.stringify(flag.scopedOrgIds)}
                        </code>
                      </div>
                    )}

                    {flag.status === "by_plan" && flag.subscriptionTier && (
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-muted-foreground">Subscription Tier:</span>
                        <Badge variant="outline" className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border-none font-bold uppercase text-[9px]">
                          {flag.subscriptionTier}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-border/40 flex items-center justify-between gap-4">
                    <span className="text-[9px] text-muted-foreground font-mono">Updated by: {flag.updatedBy || "system"}</span>
                    {isSuperAdmin && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border text-muted-foreground hover:text-foreground rounded-lg p-2"
                          onClick={() => handleOpenEdit(flag)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg p-2"
                          onClick={() => deleteMutation.mutate(flag.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Feature Flag Creation Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border border-border text-muted-foreground max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-foreground">Create Feature Flag</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Declare a new conditional flag. It will default to disabled ('off') globally.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Flag Router Key (Unique)</Label>
              <Input
                placeholder="e.g. bookings_v2"
                className="bg-background border-border text-foreground rounded-xl"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</Label>
              <Textarea
                placeholder="Provide detailed context for this modular feature channel..."
                className="bg-background border-border text-foreground rounded-xl min-h-[70px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Routing Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-muted-foreground">
                  <SelectItem value="off">Off (Globally Disabled)</SelectItem>
                  <SelectItem value="on">On (Globally Enabled)</SelectItem>
                  <SelectItem value="scoped">Scoped (Enabled only for specific Organisation IDs)</SelectItem>
                  <SelectItem value="by_plan">By Plan (Enabled for selected subscription tier)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status === "scoped" && (
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Scoped Organisation IDs (JSON Array)
                  <span title='e.g. ["uuid-1", "uuid-2"]'><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></span>
                </Label>
                <Input
                  placeholder='e.g. ["847c234a-...", "9823f982-..."]'
                  className="bg-background border-border text-foreground rounded-xl font-mono text-xs"
                  value={scopedOrgIdsStr}
                  onChange={(e) => setScopedOrgIdsStr(e.target.value)}
                />
              </div>
            )}

            {status === "by_plan" && (
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Minimum Subscription Plan</Label>
                <Select value={subscriptionTier} onValueChange={setSubscriptionTier}>
                  <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-muted-foreground">
                    <SelectItem value="none">Standard Free Tier</SelectItem>
                    <SelectItem value="pro">Pro Plan</SelectItem>
                    <SelectItem value="premium">Enterprise Premium Plan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={handleCreateSubmit}
              disabled={createMutation.isPending}
            >
              Confirm Creation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feature Flag Modification Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-card border border-border text-muted-foreground max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-foreground">Modify Feature Flag</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Overwrite flag parameters. Router changes take effect globally within 15 seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Flag Key (Immutable)</Label>
              <Input
                className="bg-background/60 border-border text-muted-foreground rounded-xl font-mono text-xs"
                value={name}
                disabled
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</Label>
              <Textarea
                className="bg-background border-border text-foreground rounded-xl min-h-[70px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Routing Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-muted-foreground">
                  <SelectItem value="off">Off (Globally Disabled)</SelectItem>
                  <SelectItem value="on">On (Globally Enabled)</SelectItem>
                  <SelectItem value="scoped">Scoped (Enabled only for specific Organisation IDs)</SelectItem>
                  <SelectItem value="by_plan">By Plan (Enabled for selected subscription tier)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status === "scoped" && (
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Scoped Organisation IDs (JSON Array)</Label>
                <Input
                  className="bg-background border-border text-foreground rounded-xl font-mono text-xs"
                  value={scopedOrgIdsStr}
                  onChange={(e) => setScopedOrgIdsStr(e.target.value)}
                />
              </div>
            )}

            {status === "by_plan" && (
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Minimum Subscription Plan</Label>
                <Select value={subscriptionTier} onValueChange={setSubscriptionTier}>
                  <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-muted-foreground">
                    <SelectItem value="none">Standard Free Tier</SelectItem>
                    <SelectItem value="pro">Pro Plan</SelectItem>
                    <SelectItem value="premium">Enterprise Premium Plan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-muted"
              onClick={() => setShowEditDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={handleEditSubmit}
              disabled={editMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
