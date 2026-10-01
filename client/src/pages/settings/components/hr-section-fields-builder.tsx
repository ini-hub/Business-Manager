import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, ArrowLeft, GripVertical } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "boolean", "email", "phone"] as const;
const SECTION_TITLES: Record<"personal" | "job_current", string> = {
  personal: "Personal Information Fields",
  job_current: "Job Information Fields",
};

interface HrFieldValidation { minLength?: number; maxLength?: number; min?: number; max?: number; integerOnly?: boolean; pattern?: string; patternErrorMessage?: string }
interface FieldDefinition { id: string; fieldKey: string; label: string; fieldType: string; validation: HrFieldValidation | null; isRequired: boolean; isEnabled: boolean; isSystemField: boolean }

const EMPTY_VALIDATION: HrFieldValidation = {};
const VALIDATION_SUPPORT: Record<string, Array<"length" | "range" | "pattern">> = {
  text: ["length", "pattern"],
  textarea: ["length", "pattern"],
  phone: ["length"],
  number: ["range"],
};

export function HrSectionFieldsBuilder({ section, onBack }: { section: "personal" | "job_current"; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = `/api/hr/fields/${section}`;
  const [open, setOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderingFields, setReorderingFields] = useState<FieldDefinition[]>([]);
  const [form, setForm] = useState({ fieldKey: "", label: "", fieldType: "text" as typeof FIELD_TYPES[number], isRequired: false, validation: EMPTY_VALIDATION as HrFieldValidation });

  const { data: fields = [], isLoading } = useQuery<FieldDefinition[]>({
    queryKey: [url],
    queryFn: async () => (await apiRequest("GET", url)).json(),
  });

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

  const reorderFields = useMutation({
    mutationFn: async (orderedIds: string[]) => apiRequest("POST", `${url}/reorder`, { orderedIds }),
    onSuccess: () => {
      toast({ title: "Field order saved" });
      queryClient.invalidateQueries({ queryKey: [url] });
      setReorderMode(false);
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not reorder fields", description: getUserFriendlyError(error) }),
  });

  const moveField = (index: number, direction: "up" | "down") => {
    const newFields = [...reorderingFields];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newFields.length) {
      [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
      setReorderingFields(newFields);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={SECTION_TITLES[section]}
        description={`Manage custom fields for ${section === "personal" ? "personal information" : "job information"} during staff onboarding.`}
        actions={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Settings
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Fields</CardTitle>
          <div className="flex gap-2">
            {reorderMode && (
              <Button
                size="sm"
                variant="default"
                onClick={() => reorderFields.mutate(reorderingFields.map((f) => f.id))}
                disabled={reorderFields.isPending}
              >
                {reorderFields.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Order
              </Button>
            )}
            {reorderMode && (
              <Button size="sm" variant="outline" onClick={() => setReorderMode(false)}>
                Cancel
              </Button>
            )}
            {!reorderMode && (
              <Button size="sm" variant="outline" onClick={() => { setReorderingFields([...fields]); setReorderMode(true); }}>
                <GripVertical className="h-4 w-4 mr-1" />Reorder
              </Button>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline" disabled={reorderMode}><Plus className="h-4 w-4 mr-1" />Add field</Button></DialogTrigger>
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
          </div>
        </CardHeader>
        <CardContent className="divide-y">
          {reorderMode ? (
            reorderingFields.map((f, idx) => (
              <div key={f.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{f.label} <span className="text-xs text-muted-foreground">({f.fieldType})</span></p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveField(idx, "up")} disabled={idx === 0}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => moveField(idx, "down")} disabled={idx === reorderingFields.length - 1}>
                    ↓
                  </Button>
                </div>
              </div>
            ))
          ) : isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : fields.map((f) => (
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
    </div>
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
