import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Plus, Lock, Check, Settings2, Pencil, Trash2 } from "lucide-react";
import { getUserFriendlyError } from "@/lib/error-utils";
import { apiRequest } from "@/lib/queryClient";

export function RolesPermissionsSection() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { business } = useStore();

  const { data: customRoles = [], refetch: refetchCustomRoles } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: !!business,
  });

  const openAddRole = () => {
    setLocation("/settings/roles/new");
  };

  const openEditRole = (role: any) => {
    setLocation(`/settings/roles/${role.id}/edit`);
  };

  const deleteCustomRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/custom-roles/${id}`);
      return res.json();
    },
    onSuccess: () => {
      refetchCustomRoles();
      toast({ title: "Custom role deleted successfully." });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to delete role",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    }
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Roles & Permissions
          </CardTitle>
          <CardDescription>
            Define system roles, edit checkboxes for permissions, and add custom roles.
          </CardDescription>
        </div>
        <Button onClick={openAddRole} data-testid="button-create-role">
          <Plus className="h-4 w-4 mr-2" />
          Create Custom Role
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* System Roles */}
          <Card className="border border-muted/60 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Owner / Admin <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Full administrative controls and financial dashboard visibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
              <div className="flex flex-wrap gap-1.5">
                {["Dashboard", "Sales & Checkout", "Customers", "Staff & Payroll", "Inventory & Catalog", "Expenses & Reports", "Settings"].map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                    <Check className="h-3 w-3 text-green-500" /> {p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-muted/60 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Store Manager <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Store operations, sales execution, inventory and staff control.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
              <div className="flex flex-wrap gap-1.5">
                {["Dashboard", "Sales & Checkout", "Customers", "Staff & Payroll", "Inventory & Catalog", "Expenses & Reports"].map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                    <Check className="h-3 w-3 text-green-500" /> {p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-muted/60 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Staff <Badge variant="secondary" className="ml-auto text-[10px]">System</Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Perform checkouts, record sales, and update inventory counters.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Permissions Snapshot:</p>
              <div className="flex flex-wrap gap-1.5">
                {["Sales & Checkout", "Customers", "Inventory & Catalog"].map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-green-50/20 text-green-700 border-green-200/50">
                    <Check className="h-3 w-3 text-green-500" /> {p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Custom Roles */}
          {customRoles.map((role) => (
            <Card key={role.id} className="border border-muted/60 shadow-xs relative group animate-in zoom-in-95 duration-150">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                    {role.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => openEditRole(role)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteCustomRoleMutation.mutate(role.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription className="text-xs">
                  {role.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Active Permissions:</p>
                <div className="flex flex-wrap gap-1.5">
                  {role.permissions && role.permissions.length > 0 ? (
                    role.permissions.map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[10px] py-0.5 px-1.5 flex items-center gap-1 bg-primary/5 text-primary border-primary/20">
                        <Check className="h-3 w-3 text-primary" /> {p}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No modular permissions assigned yet.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
