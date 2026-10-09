import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, EyeOff, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/loader";
import {
  NAV_ITEMS,
  NAV_ROLES,
  getNavItem,
  type NavRole,
  type SidebarLayout,
  type SidebarSection,
} from "@shared/sidebarLayout";

const QUERY_KEY = ["/api/admin/platform-config/sidebar-layout"];
const ROLE_LABELS: Record<NavRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

type LayoutResponse = { customised: boolean; layout: SidebarLayout };

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const newSectionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Super-admin editor for the app sidebar: per role, named sections holding pages in
 * a chosen order, plus pages hidden for that role. Saved as one platform setting;
 * "Reset" returns to the built-in layout (shared/sidebarLayout.ts). Showing a page
 * here only adds a link - the page itself still enforces who may use it.
 */
export default function NavigationLayout() {
  const { toast } = useToast();
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";

  const { data, isLoading } = useQuery<LayoutResponse>({ queryKey: QUERY_KEY });
  const [draft, setDraft] = useState<SidebarLayout | null>(null);
  const [role, setRole] = useState<NavRole>("owner");

  useEffect(() => {
    if (data) setDraft(structuredClone(data.layout));
  }, [data]);

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.layout) !== JSON.stringify(draft), [data, draft]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/sidebar-layout", { layout: draft });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save the sidebar layout");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Sidebar saved", description: "Businesses see the new layout the next time their app refreshes." });
    },
    onError: (err: Error) => toast({ title: "Couldn't save the sidebar", description: err.message, variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/platform-config/sidebar-layout");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to reset the sidebar layout");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Sidebar reset", description: "Everyone is back on the built-in layout." });
    },
    onError: (err: Error) => toast({ title: "Couldn't reset the sidebar", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !draft) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const current = draft[role];
  const edit = (fn: (sections: SidebarSection[], hidden: string[]) => { sections: SidebarSection[]; hidden: string[] }) =>
    setDraft((d) => (d ? { ...d, [role]: fn(d[role].sections, d[role].hidden) } : d));

  const renameSection = (id: string, label: string) =>
    edit((sections, hidden) => ({ sections: sections.map((s) => (s.id === id ? { ...s, label } : s)), hidden }));

  const addSection = () =>
    edit((sections, hidden) => ({ sections: [...sections, { id: newSectionId(), label: "New section", items: [] }], hidden }));

  // Deleting a section hides its pages so they can be placed again, rather than losing them.
  const deleteSection = (id: string) =>
    edit((sections, hidden) => {
      const gone = sections.find((s) => s.id === id);
      return { sections: sections.filter((s) => s.id !== id), hidden: [...hidden, ...(gone?.items ?? [])] };
    });

  const moveSection = (index: number, to: number) =>
    edit((sections, hidden) => ({ sections: move(sections, index, to), hidden }));

  const moveItem = (sectionId: string, index: number, to: number) =>
    edit((sections, hidden) => ({
      sections: sections.map((s) => (s.id === sectionId ? { ...s, items: move(s.items, index, to) } : s)),
      hidden,
    }));

  const sendItem = (url: string, fromId: string, toId: string) =>
    edit((sections, hidden) => ({
      sections: sections.map((s) => {
        if (s.id === fromId) return { ...s, items: s.items.filter((u) => u !== url) };
        if (s.id === toId) return { ...s, items: [...s.items, url] };
        return s;
      }),
      hidden,
    }));

  const hideItem = (url: string, sectionId: string) =>
    edit((sections, hidden) => ({
      sections: sections.map((s) => (s.id === sectionId ? { ...s, items: s.items.filter((u) => u !== url) } : s)),
      hidden: [...hidden, url],
    }));

  const showItem = (url: string, sectionId: string) =>
    edit((sections, hidden) => ({
      sections: sections.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, url] } : s)),
      hidden: hidden.filter((u) => u !== url),
    }));

  // Copy a page's placement to every other role, in the section with the same id when it exists.
  const showForAllRoles = (url: string, fromSectionId: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      for (const other of NAV_ROLES) {
        if (other === role) continue;
        const layout = next[other];
        if (layout.sections.some((s) => s.items.includes(url))) continue;
        const target = layout.sections.find((s) => s.id === fromSectionId) ?? layout.sections[0];
        if (!target) continue;
        target.items.push(url);
        layout.hidden = layout.hidden.filter((u) => u !== url);
      }
      return next;
    });

  const sectionNames = current.sections.map((s) => ({ id: s.id, label: s.label || "Untitled" }));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Navigation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which pages each role's sidebar shows, how they are grouped and in what order. This applies to every business.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.customised && <Badge variant="secondary">Customised</Badge>}
          {dirty && <Badge variant="outline">Unsaved changes</Badge>}
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || !data?.customised || reset.isPending}
            onClick={() => {
              if (window.confirm("Reset the sidebar to the built-in layout for every role?")) reset.mutate();
            }}
            data-testid="button-reset-sidebar"
          >
            <RotateCcw className="h-4 w-4 mr-2" /> Reset to default
          </Button>
          <Button size="sm" disabled={!canEdit || !dirty || save.isPending} onClick={() => save.mutate()} data-testid="button-save-sidebar">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {!canEdit && <p className="text-sm text-muted-foreground">Only a super admin can change the sidebar.</p>}

      <Tabs value={role} onValueChange={(v) => setRole(v as NavRole)}>
        <TabsList>
          {NAV_ROLES.map((r) => (
            <TabsTrigger key={r} value={r} data-testid={`tab-role-${r}`}>
              {ROLE_LABELS[r]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        A link in the sidebar does not grant access. Businesses still need the feature, and the page and its data still check the person's role, so adding a page
        for a role that is not allowed to use it shows a link that leads to a "not allowed" screen.
      </p>

      <div className="space-y-4">
        {current.sections.map((section, si) => (
          <Card key={section.id} data-testid={`section-${section.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Input
                  value={section.label}
                  maxLength={40}
                  disabled={!canEdit}
                  onChange={(e) => renameSection(section.id, e.target.value)}
                  className="max-w-xs font-medium"
                  aria-label="Section name"
                />
                <Button variant="ghost" size="icon" disabled={!canEdit || si === 0} onClick={() => moveSection(si, si - 1)} aria-label="Move section up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canEdit || si === current.sections.length - 1}
                  onClick={() => moveSection(si, si + 1)}
                  aria-label="Move section down"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => deleteSection(section.id)} aria-label="Delete section">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {section.items.length === 0 && <CardDescription>Empty sections are not shown in the sidebar.</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-1">
              {section.items.map((url, ii) => {
                const item = getNavItem(url);
                if (!item) return null;
                return (
                  <div key={url} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" data-testid={`item-${url}`}>
                    <span className="flex-1 min-w-[8rem] text-sm">{item.title}</span>
                    <Select value={section.id} disabled={!canEdit} onValueChange={(to) => sendItem(url, section.id, to)}>
                      <SelectTrigger className="h-8 w-44" aria-label={`Section for ${item.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sectionNames.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" disabled={!canEdit || ii === 0} onClick={() => moveItem(section.id, ii, ii - 1)} aria-label={`Move ${item.title} up`}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!canEdit || ii === section.items.length - 1}
                      onClick={() => moveItem(section.id, ii, ii + 1)}
                      aria-label={`Move ${item.title} down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => showForAllRoles(url, section.id)} aria-label={`Show ${item.title} for all roles`} title="Show for all roles">
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => hideItem(url, section.id)} aria-label={`Hide ${item.title}`} title="Hide for this role">
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
        <Button variant="outline" size="sm" disabled={!canEdit || current.sections.length >= 20} onClick={addSection} data-testid="button-add-section">
          <Plus className="h-4 w-4 mr-2" /> Add section
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Hidden for {ROLE_LABELS[role].toLowerCase()}s</CardTitle>
          <CardDescription>Pages not shown in this role's sidebar. Add one to a section to show it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {NAV_ITEMS.filter((i) => current.hidden.includes(i.url)).map((item) => (
            <div key={item.url} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2" data-testid={`hidden-${item.url}`}>
              <span className="flex-1 min-w-[8rem] text-sm text-muted-foreground">{item.title}</span>
              <Select disabled={!canEdit || current.sections.length === 0} onValueChange={(to) => showItem(item.url, to)}>
                <SelectTrigger className="h-8 w-44" aria-label={`Add ${item.title} to a section`}>
                  <SelectValue placeholder="Add to section…" />
                </SelectTrigger>
                <SelectContent>
                  {sectionNames.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {current.hidden.length === 0 && <p className="text-sm text-muted-foreground">Nothing is hidden.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
