import { PERMISSION_MODULES, type PermissionModule } from "@shared/permissionModules";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Lock, Pencil, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { IconButton } from "@/components/icon-button";
import { getUserFriendlyError } from "@/lib/error-utils";
import { apiRequest } from "@/lib/queryClient";

// Plain-language area names; the stored permission strings keep the "&".
const area = (m: string) => m.replace(/ & /g, " and ");

type BuiltIn = { name: string; blurb: string; modules: readonly PermissionModule[] };

const BUILT_IN: BuiltIn[] = [
  { name: "Owner / Admin", blurb: "Everything, including money and settings.", modules: PERMISSION_MODULES },
  { name: "Store Manager", blurb: "Runs the store. No settings.", modules: PERMISSION_MODULES.filter((m) => m !== "Settings") },
  { name: "Staff", blurb: "Checkout, customers and stock counts.", modules: ["Sales & Checkout", "Customers", "Inventory & Catalog"] },
];

function BuiltInTag() {
  return <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Built in</span>;
}

function RoleCard({ role }: { role: BuiltIn }) {
  const denied = PERMISSION_MODULES.filter((m) => !role.modules.includes(m));
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{role.name}</h3>
        <BuiltInTag />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{role.blurb}</p>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Can use</p>
      <p className="text-sm">{role.modules.map(area).join(", ")}</p>
      {denied.length > 0 && (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">No access</p>
          <p className="text-sm text-muted-foreground">{denied.map(area).join(", ")}</p>
        </>
      )}
    </div>
  );
}

export function RolesPermissionsSection() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { business } = useStore();

  const { data: customRoles = [], refetch: refetchCustomRoles } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: !!business,
  });

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
      toast({ title: "Failed to delete role", description: getUserFriendlyError(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {/* Phone: one card per role. */}
      <div className="space-y-3 md:hidden">
        {BUILT_IN.map((r) => (
          <RoleCard key={r.name} role={r} />
        ))}
      </div>

      {/* Desktop: every role against every area at a glance. */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-center">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Area</th>
              {BUILT_IN.map((r) => (
                <th key={r.name} className="px-3 py-3 font-semibold">
                  <div>{r.name}</div>
                  <div className="mt-1"><BuiltInTag /></div>
                </th>
              ))}
              {customRoles.map((r) => (
                <th key={r.id} className="px-3 py-3 font-semibold">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((m) => (
              <tr key={m} className="border-b last:border-0">
                <td className="px-5 py-3">{area(m)}</td>
                {[...BUILT_IN.map((r) => r.modules.includes(m)), ...customRoles.map((r) => !!r.permissions?.includes(m))].map(
                  (on, i) => (
                    <td key={i} className="px-3 py-3 text-center">
                      {on ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary" aria-label="Can use">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50" aria-label="No access">·</span>
                      )}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          Built-in roles can't be changed. To give someone different access, create a custom role.
        </p>
      </div>

      {customRoles.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Custom roles</h2>
          {customRoles.map((role) => (
            <div key={role.id} className="rounded-xl border bg-card p-4" data-testid={`custom-role-${role.id}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{role.name}</h3>
                <div className="flex items-center gap-1">
                  <IconButton label="Edit role" variant="ghost" className="h-8 w-8" onClick={() => setLocation(`/settings/roles/${role.id}/edit`)}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton label="Delete role" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteCustomRoleMutation.mutate(role.id)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
              {role.description && <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>}
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Can use</p>
              <p className="text-sm">
                {role.permissions?.length ? role.permissions.map(area).join(", ") : "Nothing assigned yet."}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
