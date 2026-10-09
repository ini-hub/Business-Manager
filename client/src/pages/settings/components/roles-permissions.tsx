import { PERMISSIONS_BY_MODULE } from "@shared/permissions";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Lock, Pencil, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { IconButton } from "@/components/icon-button";
import { getUserFriendlyError } from "@/lib/error-utils";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Plain-language area names.
const area = (m: string) => m.replace(/ & /g, " and ");

type RoleOverview = {
  builtIn: { key: string; name: string; pages: string[] }[];
  custom: { id: string; name: string; description: string | null; pages: string[] }[];
};

/** How much of an area a role can use: every page, some of them, or none. Always-on pages don't count. */
function coverage(pages: readonly string[], module: (typeof PERMISSIONS_BY_MODULE)[number]) {
  const choices = module.permissions.filter((p) => !p.selfService);
  const held = choices.filter((p) => pages.includes(p.key)).length;
  return { held, total: choices.length, state: held === 0 ? "none" : held === choices.length ? "all" : "some" } as const;
}

const heldAreas = (pages: readonly string[]) =>
  PERMISSIONS_BY_MODULE.map((m) => ({ m, c: coverage(pages, m) })).filter(({ c }) => c.state !== "none");

function BuiltInTag() {
  return <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Built in</span>;
}

function Cell({ held, total, state }: ReturnType<typeof coverage>) {
  if (state === "none") return <span className="text-muted-foreground/50" aria-label="No access">·</span>;
  if (state === "all") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary" aria-label="Can use">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground" aria-label={`Can use ${held} of ${total}`}>{held} of {total}</span>;
}

function AreaList({ pages }: { pages: readonly string[] }) {
  const areas = heldAreas(pages);
  if (areas.length === 0) return <p className="text-sm text-muted-foreground">Nothing assigned yet.</p>;
  return (
    <p className="text-sm">
      {areas.map(({ m, c }) => `${area(m.module)}${c.state === "some" ? ` (${c.held} of ${c.total})` : ""}`).join(", ")}
    </p>
  );
}

export function RolesPermissionsSection() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { business } = useStore();

  // Built-in roles come from the platform's settings (a super admin can change them), not from this file.
  const { data } = useQuery<RoleOverview>({ queryKey: ["/api/roles/overview"], enabled: !!business });
  const builtIn = data?.builtIn ?? [];
  const customRoles = data?.custom ?? [];

  const deleteCustomRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/custom-roles/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete role.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/roles/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
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
        {builtIn.map((r) => (
          <div key={r.key} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{r.name}</h3>
              <BuiltInTag />
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">Can use</p>
            <AreaList pages={r.pages} />
          </div>
        ))}
      </div>

      {/* Desktop: every role against every area at a glance. */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-center">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Area</th>
              {builtIn.map((r) => (
                <th key={r.key} className="px-3 py-3 font-semibold">
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
            {PERMISSIONS_BY_MODULE.map((m) => (
              <tr key={m.module} className="border-b last:border-0">
                <td className="px-5 py-3">{area(m.module)}</td>
                {[...builtIn, ...customRoles].map((r) => (
                  <td key={"key" in r ? r.key : r.id} className="px-3 py-3 text-center">
                    <Cell {...coverage(r.pages, m)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          Built-in roles are set by the platform. To give someone different access, create a custom role.
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
              <AreaList pages={role.pages} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
