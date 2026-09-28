import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Pencil, Ban } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

type Template = {
  id: string;
  metaTemplateName: string;
  category: string;
  language: string;
  bodyText: string;
  variableCount: number;
  status: string;
};

const CATEGORIES = ["marketing", "utility", "authentication"];
const STATUSES = ["pending", "approved", "rejected", "disabled"];

const emptyForm = { metaTemplateName: "", category: "utility", language: "en_US", bodyText: "", status: "pending" };

/**
 * Registers the templates a store's owner/manager already got approved in
 * their Meta Business account (Meta approval happens outside this app -
 * this is just where that result gets mirrored so broadcasts know it
 * exists). variableCount is computed server-side from bodyText, shown here
 * live for the same reason. See server/routes/whatsapp-template.routes.ts.
 */
export function TemplateManagerSection({ storeId }: { storeId: string | undefined }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: templates = [], refetch } = useQuery<Template[]>({
    queryKey: ["/api/stores", storeId, "whatsapp-templates"],
    queryFn: async () => (await fetch(`/api/stores/${storeId}/whatsapp-templates`)).json(),
    enabled: !!storeId,
  });

  const variableCount = (() => {
    const matches = Array.from(form.bodyText.matchAll(/\{\{(\d+)\}\}/g));
    return matches.reduce((max, m) => Math.max(max, Number(m[1])), 0);
  })();

  const save = useMutation({
    mutationFn: async () => {
      const path = editingId ? `/api/stores/${storeId}/whatsapp-templates/${editingId}` : `/api/stores/${storeId}/whatsapp-templates`;
      const res = await apiRequest(editingId ? "PUT" : "POST", path, form);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save template");
      return body;
    },
    onSuccess: () => {
      toast({ title: editingId ? "Template updated" : "Template added" });
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["/api/stores", storeId, "whatsapp-templates"] });
      // Also invalidate the composer's approved-only list (client/src/pages/
      // broadcasts/index.tsx) so a newly approved template shows up there immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates", storeId] });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Couldn't save template", description: err.message, variant: "destructive" }),
  });

  const disable = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/stores/${storeId}/whatsapp-templates/${id}/disable`, {});
      if (!res.ok) throw new Error((await res.json()).error || "Failed to disable template");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", storeId, "whatsapp-templates"] });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Couldn't disable template", description: err.message, variant: "destructive" }),
  });

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setForm({ metaTemplateName: t.metaTemplateName, category: t.category, language: t.language, bodyText: t.bodyText, status: t.status });
    setOpen(true);
  };

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const statusVariant = (status: string) => status === "approved" ? "default" : status === "rejected" || status === "disabled" ? "destructive" : "outline";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> WhatsApp Templates
            </CardTitle>
            <CardDescription>
              Templates you've had approved in Meta Business Manager, registered here so broadcasts can use them.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={startNew}><Plus className="mr-1 h-4 w-4" /> Add Template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Template" : "Add Template"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Meta Template Name</Label>
                  <Input value={form.metaTemplateName} onChange={(e) => setForm((f) => ({ ...f, metaTemplateName: e.target.value }))} placeholder="e.g. booking_reminder" className="font-mono text-sm" />
                  <p className="text-xs text-muted-foreground">Must exactly match the name it was approved under in Meta Business Manager.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Input value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} placeholder="en_US" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Body Text</Label>
                  <Textarea
                    value={form.bodyText}
                    onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
                    placeholder={'Hi {{1}}, your appointment on {{2}} is coming up.'}
                    rows={4}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{{1}}"}, {"{{2}}"}, etc. for placeholders — must match exactly what Meta approved. Detected variables: {variableCount}.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Only "Approved" templates are selectable when sending a broadcast.</p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => save.mutate()}
                  disabled={!form.metaTemplateName || !form.bodyText || save.isPending}
                >
                  {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingId ? "Save Changes" : "Add Template"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates registered yet.</p>}
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
            <div className="min-w-0">
              <p className="font-medium font-mono">{t.metaTemplateName}</p>
              <p className="text-xs text-muted-foreground truncate max-w-md">{t.bodyText}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="capitalize">{t.category}</Badge>
              <Badge variant={statusVariant(t.status)} className="capitalize">{t.status}</Badge>
              <Button size="icon" variant="ghost" onClick={() => startEdit(t)}><Pencil className="h-4 w-4" /></Button>
              {t.status !== "disabled" && (
                <Button size="icon" variant="ghost" onClick={() => disable.mutate(t.id)}><Ban className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
