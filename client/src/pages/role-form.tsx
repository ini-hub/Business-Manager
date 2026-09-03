import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
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
  const isOwner = user?.role === "owner";

  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

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
        setSelectedPermissions(role.permissions || []);
      }
    }
  }, [id, customRoles]);

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/custom-roles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
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

  if (!isOwner) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Role Configuration" description="Only owners can manage custom roles." />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/settings/roles")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
      </div>
    );
  }

  const permissionsList = [
    "Dashboard",
    "Sales & Checkout",
    "Customers",
    "Staff & Payroll",
    "Inventory & Catalog",
    "Expenses & Reports",
    "Settings",
  ];

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings/roles")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader 
          title={id ? "Edit Custom Role" : "Create Custom Role"} 
          description={id ? "Modify existing custom modular permissions" : "Establish a new access profile with custom features access"}
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

              <div className="space-y-3">
                <Label className="text-sm font-semibold text-foreground uppercase tracking-wider block">Modular Permissions</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 border p-4 rounded-lg bg-muted/10">
                  {permissionsList.map((perm) => {
                    const isChecked = selectedPermissions.includes(perm);
                    return (
                      <label 
                        key={perm} 
                        className={`flex items-center gap-2.5 text-xs font-semibold cursor-pointer p-2.5 rounded-lg border transition-all duration-150 ${
                          isChecked 
                            ? "bg-primary/5 border-primary/30 text-primary shadow-xs" 
                            : "bg-background border-muted/50 text-muted-foreground hover:bg-muted/10 hover:border-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="rounded border-muted text-primary focus:ring-primary h-4 w-4"
                          checked={isChecked}
                          onChange={() => togglePermission(perm)}
                        />
                        {perm}
                      </label>
                    );
                  })}
                </div>
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
