import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const SECTIONS = [
  { key: "personal", label: "Personal" },
  { key: "job", label: "Job" },
  { key: "time_off", label: "Time Off" },
  { key: "emergency", label: "Emergency Contacts" },
  { key: "documents", label: "Documents" },
  { key: "benefits", label: "Benefits" },
  { key: "disciplinary", label: "Disciplinary Records" },
  { key: "guarantor", label: "Guarantor Form" },
] as const;

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "boolean", "email", "phone"] as const;

// Which fieldTypes have configurable "response validation" (Google-Forms
// style) beyond isRequired, and which rule inputs apply to each - see
// shared/hr-field-validation.ts for how these are enforced.
const VALIDATION_SUPPORT: Record<string, Array<"length" | "range" | "pattern">> = {
  text: ["length", "pattern"],
  textarea: ["length", "pattern"],
  phone: ["length"],
  number: ["range"],
};

interface HrFieldValidation { minLength?: number; maxLength?: number; min?: number; max?: number; integerOnly?: boolean; pattern?: string; patternErrorMessage?: string }
interface SectionConfig { section: string; isEnabled: boolean; isRequiredForOnboarding: boolean }
interface FieldDefinition { id: string; fieldKey: string; label: string; fieldType: string; validation: HrFieldValidation | null; isRequired: boolean; isEnabled: boolean; isSystemField: boolean }

const EMPTY_VALIDATION: HrFieldValidation = {};

/**
 * Super-admin config screen for the HR profile module, scoped to one
 * business: section enable/require toggles (hr_section_config) plus the
 * dynamic field builder for Personal and Job-current (hr_field_definitions).
 * Reached from a tab on client/src/pages/admin/BusinessDetails.tsx. Mirrors
 * PlatformSettings.tsx's list/toggle UX, business-scoped instead of global.
 */
export function HrProfileConfig({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sectionsUrl = `/api/admin/businesses/${businessId}/hr/sections`;

  const { data: sections = [], isLoading } = useQuery<SectionConfig[]>({
    queryKey: [sectionsUrl],
    queryFn: async () => (await apiRequest("GET", sectionsUrl)).json(),
  });

  const updateSection = useMutation({
    mutationFn: async ({ section, ...body }: { section: string; isEnabled?: boolean; isRequiredForOnboarding?: boolean }) =>
      apiRequest("PUT", `${sectionsUrl}/${section}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [sectionsUrl] }),
    onError: (error) => toast({ variant: "destructive", title: "Could not update section", description: getUserFriendlyError(error) }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">HR Profile Sections</CardTitle><CardDescription>Enable sections and mark which ones a new staff member must complete before getting full access.</CardDescription></CardHeader>
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
                      data-testid={`switch-required-${key}`}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Enabled
                    <Switch
                      checked={cfg?.isEnabled ?? true}
                      onCheckedChange={(checked) => updateSection.mutate({ section: key, isEnabled: checked })}
                      data-testid={`switch-enabled-${key}`}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <FieldBuilder businessId={businessId} section="personal" title="Personal Fields" />
      <FieldBuilder businessId={businessId} section="job_current" title="Job (Current) Fields" />
    </div>
  );
}

function FieldBuilder({ businessId, section, title }: { businessId: string; section: "personal" | "job_current"; title: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = `/api/admin/businesses/${businessId}/hr/fields/${section}`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fieldKey: "", label: "", fieldType: "text" as typeof FIELD_TYPES[number], isRequired: false, validation: EMPTY_VALIDATION as HrFieldValidation });

  const { data: fields = [], isLoading } = useQuery<FieldDefinition[]>({ queryKey: [url], queryFn: async () => (await apiRequest("GET", url)).json() });

  const createField = useMutation({
    mutationFn: async () => {
      // Drop the empty-object placeholder and any keys not applicable to
      // this fieldType, so switching type then submitting never leaks a
      // stale rule from a previously selected type (e.g. `pattern` left
      // over after switching text -> number).
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
      apiRequest("PATCH", `/api/admin/businesses/${businessId}/hr/fields/${fieldId}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [url] }),
  });

  const deleteField = useMutation({
    mutationFn: async (fieldId: string) => apiRequest("DELETE", `/api/admin/businesses/${businessId}/hr/fields/${fieldId}`),
    onSuccess: () => { toast({ title: "Field removed" }); queryClient.invalidateQueries({ queryKey: [url] }); },
    onError: (error) => toast({ variant: "destructive", title: "Could not remove field", description: getUserFriendlyError(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" data-testid={`button-add-field-${section}`}><Plus className="h-4 w-4 mr-1" />Add field</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add custom field</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Field key (machine name)</Label><Input value={form.fieldKey} onChange={(e) => setForm({ ...form, fieldKey: e.target.value })} placeholder="e.g. passport_number" /></div>
              <div className="space-y-2"><Label>Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.fieldType} onValueChange={(v) => setForm({ ...form, fieldType: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.isRequired} onCheckedChange={(v) => setForm({ ...form, isRequired: v })} />Required for onboarding</label>
              <ValidationFields fieldType={form.fieldType} validation={form.validation} onChange={(validation) => setForm({ ...form, validation })} />
            </div>
            <DialogFooter>
              <Button onClick={() => createField.mutate()} disabled={!form.fieldKey || !form.label || createField.isPending} data-testid={`button-save-field-${section}`}>
                {createField.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="divide-y">
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">{f.label} <span className="text-xs text-muted-foreground">({f.fieldType})</span></p>
              <div className="flex flex-wrap gap-1 mt-1">
                {f.isSystemField && <Badge variant="outline" className="text-xs">Default field</Badge>}
                {describeValidation(f.validation).map((rule) => <Badge key={rule} variant="secondary" className="text-xs">{rule}</Badge>)}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">Required <Switch checked={f.isRequired} onCheckedChange={(v) => toggleField.mutate({ fieldId: f.id, isRequired: v })} /></label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">Enabled <Switch checked={f.isEnabled} onCheckedChange={(v) => toggleField.mutate({ fieldId: f.id, isEnabled: v })} /></label>
              {!f.isSystemField && (
                <Button size="icon" variant="ghost" onClick={() => deleteField.mutate(f.id)} data-testid={`button-delete-field-${f.id}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {fields.length === 0 && !isLoading && <p className="text-sm text-muted-foreground py-2">No fields yet.</p>}
      </CardContent>
    </Card>
  );
}

/** Drops any rule not applicable to the chosen fieldType and any empty input. */
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

function describeValidation(validation: HrFieldValidation | null): string[] {
  if (!validation) return [];
  const parts: string[] = [];
  if (validation.minLength !== undefined || validation.maxLength !== undefined) {
    parts.push(`${validation.minLength ?? 0}-${validation.maxLength ?? "∞"} chars`);
  }
  if (validation.min !== undefined || validation.max !== undefined) {
    parts.push(`${validation.min ?? "−∞"}-${validation.max ?? "∞"}`);
  }
  if (validation.integerOnly) parts.push("whole number");
  if (validation.pattern) parts.push("pattern");
  return parts;
}

/** Number input that stores `undefined` (not 0/NaN) when cleared, so an unset rule doesn't get submitted as a real constraint. */
function NumberField({ label, value, onChange, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </div>
  );
}

/** Response-validation config, conditioned on fieldType - the admin-facing equivalent of Google Forms' per-question "Response validation" dropdown. */
function ValidationFields({ fieldType, validation, onChange }: { fieldType: string; validation: HrFieldValidation; onChange: (v: HrFieldValidation) => void }) {
  const applicable = VALIDATION_SUPPORT[fieldType] ?? [];
  if (applicable.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">Response validation</p>
      {applicable.includes("length") && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={fieldType === "phone" ? "Min digits" : "Min length"} value={validation.minLength} onChange={(v) => onChange({ ...validation, minLength: v })} />
          <NumberField label={fieldType === "phone" ? "Max digits" : "Max length"} value={validation.maxLength} onChange={(v) => onChange({ ...validation, maxLength: v })} />
        </div>
      )}
      {applicable.includes("range") && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Minimum value" value={validation.min} onChange={(v) => onChange({ ...validation, min: v })} />
            <NumberField label="Maximum value" value={validation.max} onChange={(v) => onChange({ ...validation, max: v })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={!!validation.integerOnly} onCheckedChange={(v) => onChange({ ...validation, integerOnly: v })} />
            Whole numbers only
          </label>
        </>
      )}
      {applicable.includes("pattern") && (
        <div className="space-y-2">
          <div className="space-y-2">
            <Label className="text-xs">Regular expression (optional)</Label>
            <Input
              value={validation.pattern ?? ""}
              placeholder="e.g. ^[A-Z]{2}[0-9]{6}$"
              onChange={(e) => onChange({ ...validation, pattern: e.target.value || undefined })}
            />
          </div>
          {validation.pattern && (
            <div className="space-y-2">
              <Label className="text-xs">Message shown when it doesn't match</Label>
              <Input
                value={validation.patternErrorMessage ?? ""}
                placeholder="e.g. Must be 2 letters followed by 6 digits"
                onChange={(e) => onChange({ ...validation, patternErrorMessage: e.target.value || undefined })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
