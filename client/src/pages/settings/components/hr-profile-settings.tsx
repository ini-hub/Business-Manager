import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, GripVertical } from "lucide-react";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const SECTIONS = [
  { key: "personal", label: "Personal Information" },
  { key: "job", label: "Job Information" },
  { key: "time_off", label: "Time Off" },
  { key: "emergency", label: "Emergency Contacts" },
  { key: "documents", label: "Documents" },
  { key: "benefits", label: "Benefits" },
  { key: "disciplinary", label: "Disciplinary Records" },
  { key: "guarantor", label: "Guarantor Form" },
] as const;

interface SectionConfig { section: string; isEnabled: boolean; isRequiredForOnboarding: boolean }

export function HrProfileSettingsSection() {
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
        <CardDescription>Control which profile sections new staff members must complete before getting full access.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {SECTIONS.map(({ key, label }) => {
          const cfg = sections.find((s) => s.section === key);
          return (
            <div key={key} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                {cfg?.isRequiredForOnboarding && <Badge variant="secondary" className="mt-1">Required for onboarding</Badge>}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Required
                  <Switch
                    checked={cfg?.isRequiredForOnboarding ?? false}
                    onCheckedChange={(checked) => updateSection.mutate({ section: key, isRequiredForOnboarding: checked })}
                    disabled={updateSection.isPending}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
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

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "boolean", "email", "phone"] as const;

interface HrFieldValidation { minLength?: number; maxLength?: number; min?: number; max?: number; integerOnly?: boolean; pattern?: string; patternErrorMessage?: string }
interface FieldDefinition { id: string; fieldKey: string; label: string; fieldType: string; validation: HrFieldValidation | null; isRequired: boolean; isEnabled: boolean; isSystemField: boolean }

const EMPTY_VALIDATION: HrFieldValidation = {};
const VALIDATION_SUPPORT: Record<string, Array<"length" | "range" | "pattern">> = {
  text: ["length", "pattern"],
  textarea: ["length", "pattern"],
  phone: ["length"],
  number: ["range"],
};

function FieldBuilder({ section, title }: { section: "personal" | "job_current"; title: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = `/api/hr/fields/${section}`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fieldKey: "", label: "", fieldType: "text" as typeof FIELD_TYPES[number], isRequired: false, validation: EMPTY_VALIDATION as HrFieldValidation });

  const { data: fields = [], isLoading } = useQuery<FieldDefinition[]>({ queryKey: [url], queryFn: async () => (await apiRequest("GET", url)).json() });

  const createField = useMutation({
    mutationFn: async () => {
      const applicable = VALIDATION_SUPPORT[form.fieldType] ?? [];
      const validation = sanitizeValidation(form.validation, applicable);
      return apiRequest("POST", url, { ...form, validation: Object.keys(validation).length > 0 ? validation : undefined });
    },
    onSuccess: () => {
      toast({ title: "Field added" });
      queryClient.invalidateQueries({ queryKey: [url] });
      setOpen(false);
      setForm({ fieldKey: "", label: "", fieldType: "text", isRequired: false, validation: EMPTY_VALIDATION });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not add field", description: getUserFriendlyError(error) }),
  });

  const toggleField = useMutation({
    mutationFn: async ({ fieldId, ...body }: { fieldId: string; isEnabled?: boolean; isRequired?: boolean }) =>
      apiRequest("PATCH", `/api/hr/fields/${fieldId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [url] }),
  });

  const deleteField = useMutation({
    mutationFn: async (fieldId: string) => apiRequest("DELETE", `/api/hr/fields/${fieldId}`),
    onSuccess: () => { toast({ title: "Field removed" }); queryClient.invalidateQueries({ queryKey: [url] }); },
    onError: (error) => toast({ variant: "destructive", title: "Could not remove field", description: getUserFriendlyError(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Add field</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add custom field</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Field key (machine name)</Label><Input value={form.fieldKey} onChange={(e) => setForm({ ...form, fieldKey: e.target.value })} placeholder="e.g. passport_number" /></div>
              <div className="space-y-1.5"><Label>Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Passport Number" /></div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.fieldType} onValueChange={(v) => setForm({ ...form, fieldType: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.isRequired} onCheckedChange={(v) => setForm({ ...form, isRequired: v })} />Required for onboarding</label>
            </div>
            <DialogFooter>
              <Button onClick={() => createField.mutate()} disabled={!form.fieldKey || !form.label || createField.isPending}>
                {createField.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="divide-y">
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-sm font-medium">{f.label} <span className="text-xs text-muted-foreground">({f.fieldType})</span></p>
              <div className="flex flex-wrap gap-1 mt-1">
                {f.isSystemField && <Badge variant="outline" className="text-xs">Default field</Badge>}
                {f.isRequired && <Badge variant="secondary" className="text-xs">Required</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Required <Switch checked={f.isRequired} onCheckedChange={(v) => toggleField.mutate({ fieldId: f.id, isRequired: v })} /></label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Enabled <Switch checked={f.isEnabled} onCheckedChange={(v) => toggleField.mutate({ fieldId: f.id, isEnabled: v })} /></label>
              {!f.isSystemField && (
                <Button size="icon" variant="ghost" onClick={() => deleteField.mutate(f.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {fields.length === 0 && !isLoading && <p className="text-sm text-muted-foreground py-2">No custom fields yet. Add one to get started.</p>}
      </CardContent>
    </Card>
  );
}

function sanitizeValidation(validation: HrFieldValidation, applicable: Array<"length" | "range" | "pattern">): HrFieldValidation {
  const out: HrFieldValidation = {};
  if (applicable.includes("length")) {
    if (validation.minLength !== undefined) out.minLength = validation.minLength;
    if (validation.maxLength !== undefined) out.maxLength = validation.maxLength;
  }
  if (applicable.includes("range")) {
    if (validation.min !== undefined) out.min = validation.min;
    if (validation.max !== undefined) out.max = validation.max;
    if (validation.integerOnly) out.integerOnly = true;
  }
  if (applicable.includes("pattern") && validation.pattern) {
    out.pattern = validation.pattern;
    if (validation.patternErrorMessage) out.patternErrorMessage = validation.patternErrorMessage;
  }
  return out;
}

export function HrFieldsSettingsSection() {
  return (
    <div className="space-y-6">
      <FieldBuilder section="personal" title="Personal Information Fields" />
      <FieldBuilder section="job_current" title="Job Information Fields" />
      <DocumentFoldersSection />
    </div>
  );
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
