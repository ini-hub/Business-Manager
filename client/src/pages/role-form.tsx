import { ALL_PERMISSION_KEYS, expandPermissions } from "@shared/permissions";
import { PermissionPicker } from "@/components/permission-picker";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";

export default function RoleFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "manager";

  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [sourceTemplateId, setSourceTemplateId] = useState<string | undefined>();

  // What the caller may hand out (everything for an owner, only their own pages for a manager) and
  // the templates a super admin published.
  const { data: overview } = useQuery<{ mine: string[]; templates: { id: string; name: string; description: string | null; permissions: string[] }[] }>({
    queryKey: ["/api/roles/overview"],
  });
  const mine = new Set(overview?.mine ?? []);
  const disabledKeys = new Set(ALL_PERMISSION_KEYS.filter((k) => !mine.has(k)));

  // Paid features under each module, with whether this business holds them. Driven by the
  // feature catalog, so a feature added in the admin console appears here with no code change.
  const { data: moduleInfo } = useQuery<{ modules: { module: string; features: { key: string; name: string; granted: boolean }[] }[] }>({
    queryKey: ["/api/permission-modules"],
  });
  const featuresByModule = new Map((moduleInfo?.modules ?? []).map((m) => [m.module, m.features]));

  // Fetch all custom roles to extract the editing one
  const { data: customRoles = [], isLoading: isLoadingRoles } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: !!id,
  });

  useEffect(() => {
    if (id && customRoles.length > 0) {
      const role = customRoles.find((r) => String(r.id) === id);
      if (role) {
        setRoleName(role.name);
        setRoleDesc(role.description || "");
        setSelectedPermissions(Array.from(expandPermissions(role.permissions || [])));
      }
    }
  }, [id, customRoles]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/custom-roles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Custom role created successfully." });
      setLocation("/settings/roles");
    },
    onError: (err: any) => {
      toast({
        title: "Failed to create role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/custom-roles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Custom role updated successfully." });
      setLocation("/settings/roles");
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName) return;

    const data = {
      name: roleName,
      description: roleDesc,
      permissions: selectedPermissions,
      ...(sourceTemplateId ? { sourceTemplateId } : {}),
    };

    if (id) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  if (id && isLoadingRoles) {
    return <div className="flex items-center justify-center min-h-[400px]">Loading...</div>;
  }

  if (!canManage) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Role Configuration" description="Only owners and managers can manage custom roles." compact />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/settings/roles")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      <div className="flex items-center gap-4">
        <IconButton label="Back to roles" variant="ghost" onClick={() => setLocation("/settings/roles")}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <PageHeader
          title={id ? "Edit Custom Role" : "Create Custom Role"}
          description={id ? "Modify existing custom modular permissions" : "Establish a new access profile with custom features access"}
          compact
        />
      </div>

      <div className="max-w-xl mx-auto">
        <Card className="border border-muted/80 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Role Details
            </CardTitle>
            <CardDescription>
              Assign dynamic system privileges and modular options for your store staff.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="role-name">Role Name</Label>
                <Input
                  id="role-name"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g. Frontdesk"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role-desc">Description</Label>
                <Textarea
                  id="role-desc"
                  value={roleDesc}
                  onChange={(e) => setRoleDesc(e.target.value)}
                  placeholder="e.g. Handles appointments and client registration"
                />
              </div>

              {!id && (overview?.templates.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="role-template">Start from a template</Label>
                  <select
                    id="role-template"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={sourceTemplateId ?? ""}
                    onChange={(e) => {
                      const t = overview!.templates.find((x) => x.id === e.target.value);
                      setSourceTemplateId(t?.id);
                      if (t) {
                        setRoleName((n) => n || t.name);
                        setRoleDesc((d) => d || t.description || "");
                        // Only the pages this person may give; the rest stay unticked.
                        setSelectedPermissions(Array.from(expandPermissions(t.permissions)).filter((k) => mine.has(k)));
                      }
                    }}
                  >
                    <option value="">No template</option>
                    {overview!.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-foreground uppercase tracking-wider block">Access</Label>
                <p className="text-xs text-muted-foreground">
                  Choose the pages this role can open; they also appear in its sidebar. A role can only use a paid feature if your business has it in its plan.
                  {user?.role === "manager" && " You can only give access you have yourself."}
                </p>
                <PermissionPicker
                  value={selectedPermissions}
                  onChange={setSelectedPermissions}
                  disabledKeys={disabledKeys}
                  featuresByModule={featuresByModule}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setLocation("/settings/roles")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="min-w-[120px]">
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : id ? "Save Changes" : "Create Role"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
