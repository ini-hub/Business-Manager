import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, GripVertical } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const SECTIONS = [
  { key: "personal", label: "Personal Information", editable: true },
  { key: "job", label: "Job Information", editable: true },
  { key: "time_off", label: "Time Off", editable: false },
  { key: "emergency", label: "Emergency Contacts", editable: false },
  { key: "documents", label: "Documents", editable: false },
  { key: "benefits", label: "Benefits", editable: false },
  { key: "disciplinary", label: "Disciplinary Records", editable: false },
  { key: "guarantor", label: "Guarantor Form", editable: false },
] as const;

interface SectionConfig { section: string; isEnabled: boolean; isRequiredForOnboarding: boolean }

export function HrProfileSettingsSection({ onSelectSection }: { onSelectSection?: (section: "personal" | "job_current") => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sectionsUrl = `/api/hr/sections`;

  const { data: sections = [], isLoading } = useQuery<SectionConfig[]>({
    queryKey: [sectionsUrl],
    queryFn: async () => (await apiRequest("GET", sectionsUrl)).json(),
  });

  const updateSection = useMutation({
    mutationFn: async ({ section, ...body }: { section: string; isEnabled?: boolean; isRequiredForOnboarding?: boolean }) =>
      apiRequest("PUT", `${sectionsUrl}/${section}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [sectionsUrl] });
      toast({ title: "Setting saved" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not update section", description: getUserFriendlyError(error) }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Staff Profile Sections</CardTitle>
        <CardDescription>Control which profile sections new staff members must complete before getting full access. Click a section to customize its fields.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {SECTIONS.map(({ key, label, editable }) => {
          const cfg = sections.find((s) => s.section === key);
          const mappedKey = key === "job" ? "job_current" : (key as "personal" | "job_current");
          return (
            <div key={key} className="flex items-center justify-between py-3 group">
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => editable && onSelectSection?.(mappedKey)}
                  className={`text-left w-full ${editable ? "hover:underline cursor-pointer" : ""}`}
                >
                  <p className={`text-sm font-medium ${editable ? "text-primary" : ""}`}>{label}</p>
                  {cfg?.isRequiredForOnboarding && <Badge variant="secondary" className="mt-1">Required for onboarding</Badge>}
                  {editable && <p className="text-xs text-muted-foreground mt-1">Click to manage fields →</p>}
                </button>
              </div>
              <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                  Required
                  <Switch
                    checked={cfg?.isRequiredForOnboarding ?? false}
                    onCheckedChange={(checked) => updateSection.mutate({ section: key, isRequiredForOnboarding: checked })}
                    disabled={updateSection.isPending}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                  Enabled
                  <Switch
                    checked={cfg?.isEnabled ?? true}
                    onCheckedChange={(checked) => updateSection.mutate({ section: key, isEnabled: checked })}
                    disabled={updateSection.isPending}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function HrFieldsSettingsSection() {
  return <DocumentFoldersSection />;
}

interface DocumentFolder { id: string; key: string; label: string }

function DocumentFoldersSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = `/api/hr/document-folders`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: "", label: "" });

  const { data: folders = [], isLoading } = useQuery<DocumentFolder[]>({
    queryKey: [url],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

  const createFolder = useMutation({
    mutationFn: async () => apiRequest("POST", url, form),
    onSuccess: () => {
      toast({ title: "Document folder created" });
      queryClient.invalidateQueries({ queryKey: [url] });
      setOpen(false);
      setForm({ key: "", label: "" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not create folder", description: getUserFriendlyError(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Document Organization</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Add folder</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create document folder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Folder key (machine name)</Label>
                <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. licenses" />
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and underscores only</p>
              </div>
              <div className="space-y-1.5">
                <Label>Folder label</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Professional Licenses" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createFolder.mutate()} disabled={!form.key || !form.label || createFolder.isPending}>
                {createFolder.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No document folders yet. Create one to organize staff documents.</p>
        ) : (
          <div className="divide-y">
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-3">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{f.label}</p>
                  <p className="text-xs text-muted-foreground">{f.key}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
