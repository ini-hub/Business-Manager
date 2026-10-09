import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/loader";
import { PermissionPicker } from "@/components/permission-picker";
import { expandPermissions } from "@shared/permissions";

const QUERY_KEY = ["/api/admin/roles"];

type SystemRole = { key: "manager" | "staff"; name: string; customised: boolean; permissions: string[] };
type Template = { id: string; name: string; description: string | null; permissions: string[] };
type RolesResponse = { system: SystemRole[]; templates: Template[] };

// The picker works on page keys; stored permissions may also name whole modules (older roles).
const toPages = (stored: string[]) => Array.from(expandPermissions(stored));

async function call(method: string, url: string, body?: unknown) {
  const res = await apiRequest(method, url, body);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

/**
 * Super-admin editor for what the built-in Manager and Staff roles can use in every business, and
 * for role templates businesses can start from. Owners always have everything. This sets what each
 * role sees in the sidebar and which screens it can open; the sidebar sections and order are set
 * under Navigation.
 */
export default function Roles() {
  const { toast } = useToast();
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const { data, isLoading } = useQuery<RolesResponse>({ queryKey: QUERY_KEY });

  const [tab, setTab] = useState<"manager" | "staff" | "templates">("manager");
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<{ id: string | null; name: string; description: string; pages: string[] } | null>(null);

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.system.map((r) => [r.key, toPages(r.permissions)])));
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (title: string) => (err: Error) => toast({ title, description: err.message, variant: "destructive" });

  const saveSystem = useMutation({
    mutationFn: (key: string) => call("PUT", `/api/admin/roles/system/${key}`, { permissions: draft[key] }),
    onSuccess: () => {
      refresh();
      toast({ title: "Role saved", description: "Applies to every business." });
    },
    onError: fail("Couldn't save the role"),
  });
  const resetSystem = useMutation({
    mutationFn: (key: string) => call("DELETE", `/api/admin/roles/system/${key}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Role reset to its default" });
    },
    onError: fail("Couldn't reset the role"),
  });
  const saveTemplate = useMutation({
    mutationFn: () =>
      editing!.id
        ? call("PUT", `/api/admin/role-templates/${editing!.id}`, { name: editing!.name, description: editing!.description, permissions: editing!.pages })
        : call("POST", "/api/admin/role-templates", { name: editing!.name, description: editing!.description, permissions: editing!.pages }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast({ title: "Template saved" });
    },
    onError: fail("Couldn't save the template"),
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => call("DELETE", `/api/admin/role-templates/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: "Template deleted", description: "Roles businesses already created from it are unchanged." });
    },
    onError: fail("Couldn't delete the template"),
  });

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const system = data.system.find((r) => r.key === tab);
  const dirty = system ? JSON.stringify([...(draft[system.key] ?? [])].sort()) !== JSON.stringify(toPages(system.permissions).sort()) : false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Roles</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose what the built-in roles can use in every business, and publish role templates. Owners always have full access. Businesses build their own
          roles on top of these, and can only give a role access they hold themselves (managers) or any access (owners).
        </p>
      </div>
      {!canEdit && <p className="text-sm text-muted-foreground">Only a super admin can change roles.</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="manager" data-testid="tab-role-manager">Manager</TabsTrigger>
          <TabsTrigger value="staff" data-testid="tab-role-staff">Staff</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-role-templates">Templates</TabsTrigger>
        </TabsList>
      </Tabs>

      {system && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {system.name} {system.customised && <Badge variant="secondary">Customised</Badge>}
              </CardTitle>
              <CardDescription>Pages this role can open. Removing a page also removes it from their sidebar.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canEdit || !system.customised || resetSystem.isPending}
                onClick={() => window.confirm(`Reset ${system.name} to its default access for every business?`) && resetSystem.mutate(system.key)}
              >
                <RotateCcw className="h-4 w-4 mr-2" /> Reset to default
              </Button>
              <Button size="sm" disabled={!canEdit || !dirty || saveSystem.isPending} onClick={() => saveSystem.mutate(system.key)} data-testid="button-save-role">
                {saveSystem.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <PermissionPicker value={draft[system.key] ?? []} onChange={(next) => setDraft((d) => ({ ...d, [system.key]: next }))} readOnly={!canEdit} />
          </CardContent>
        </Card>
      )}

      {tab === "templates" && (
        <div className="space-y-4">
          {!editing && (
            <Button size="sm" disabled={!canEdit} onClick={() => setEditing({ id: null, name: "", description: "", pages: [] })} data-testid="button-new-template">
              <Plus className="h-4 w-4 mr-2" /> New template
            </Button>
          )}
          {editing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{editing.id ? "Edit template" : "New template"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input value={editing.name} maxLength={60} placeholder="e.g. Cashier" onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Template name" />
                <Textarea value={editing.description} maxLength={300} placeholder="What this role is for" onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                <PermissionPicker value={editing.pages} onChange={(pages) => setEditing({ ...editing, pages })} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button disabled={!editing.name.trim() || saveTemplate.isPending} onClick={() => saveTemplate.mutate()} data-testid="button-save-template">
                    {saveTemplate.isPending ? "Saving…" : "Save template"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {data.templates.length === 0 && !editing && <p className="text-sm text-muted-foreground">No templates yet.</p>}
          {data.templates.map((t) => (
            <Card key={t.id} data-testid={`template-${t.id}`}>
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">{t.name}</p>
                  {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{toPages(t.permissions).length} pages</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? "", pages: toPages(t.permissions) })}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => window.confirm(`Delete the "${t.name}" template?`) && deleteTemplate.mutate(t.id)} aria-label={`Delete ${t.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
