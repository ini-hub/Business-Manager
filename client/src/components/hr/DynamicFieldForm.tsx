import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { apiRequest, type ApiError } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { validateHrFieldValue, isFieldValueEmpty } from "@shared/hr-field-validation";
import type { HrFieldType, HrFieldValidation } from "@shared/schema";
import { splitNormalizedPhone, normalizePhoneForStorage } from "@shared/phone-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneInput } from "@/components/phone-input";
import { LocationSelect, NationalitySelect } from "@/components/location-select";
import { SocialUrlField, socialPlatformFromFieldKey } from "@/components/social-url-field";

type FieldValue = string | number | boolean | string[] | null;

interface HrField {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "textarea" | "number" | "date" | "select" | "multiselect" | "boolean" | "email" | "phone";
  options: Array<{ value: string; label: string }> | null;
  validation: HrFieldValidation | null;
  isRequired: boolean;
  value: FieldValue;
}

/**
 * The one generic renderer behind the dynamic field builder (Personal +
 * Job-current sections) - see shared/schema/hr-field-definitions.ts. Renders
 * an input per fieldType and bulk-upserts on save. `basePath` lets this same
 * component serve both the authenticated /api/hr/* routes and the
 * pre-activation /api/profile-completion/* routes.
 */
export function DynamicFieldForm({
  staffId,
  section,
  basePath,
  onSaved,
}: {
  staffId: string;
  section: "personal" | "job_current";
  basePath: "/api/hr" | "/api/profile-completion";
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fieldsUrl = basePath === "/api/hr"
    ? `/api/hr/staff/${staffId}/field-values/${section}`
    : `/api/profile-completion/personal/fields`;

  const { data: fields = [], isLoading } = useQuery<HrField[]>({
    queryKey: [fieldsUrl],
    queryFn: async () => (await apiRequest("GET", fieldsUrl)).json(),
    enabled: !!staffId,
  });

  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  // Client-side pass of the same rules the server enforces
  // (@shared/hr-field-validation) - catches obvious mistakes before a round
  // trip, but the server call below is still the actual authority.
  const validateBeforeSubmit = (): { field: string; message: string } | null => {
    for (const f of fields) {
      const value = values[f.id] ?? null;
      if (f.isRequired && isFieldValueEmpty(value)) {
        return { field: f.id, message: `${f.label} is required.` };
      }
      const result = validateHrFieldValue(f.fieldType as HrFieldType, value, f.validation, f.label);
      if (!result.ok) return { field: f.id, message: result.error };
    }
    return null;
  };

  useEffect(() => {
    const next: Record<string, FieldValue> = {};
    for (const f of fields) next[f.id] = f.value;
    setValues(next);
  }, [fields]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const valuesUrl = basePath === "/api/hr"
        ? `/api/hr/staff/${staffId}/field-values/${section}`
        : `/api/profile-completion/personal/values`;
      const payload = {
        values: fields.map((f) => ({ fieldDefinitionId: f.id, value: values[f.id] ?? null })),
      };
      await apiRequest("PUT", valuesUrl, payload);
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      setFieldError(null);
      queryClient.invalidateQueries({ queryKey: [fieldsUrl] });
      onSaved?.();
    },
    onError: (error: ApiError) => {
      setFieldError({ field: error.field, message: error.message });
      toast({ variant: "destructive", title: "Could not save", description: error.field ? error.message : getUserFriendlyError(error) });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No fields configured for this section.</p>;
  }

  const fieldsByKey = Object.fromEntries(fields.map((f) => [f.fieldKey, f]));
  // address_state/address_city render together with address_country as one
  // LocationSelect cascade (see client/src/components/location-select.tsx) -
  // skip them as standalone fields below, whichever order the API returns
  // fields in.
  const addressCountryField = fieldsByKey["address_country"];
  const locationGroupKeys = addressCountryField ? new Set(["address_country", "address_state", "address_city"]) : new Set<string>();

  const setValue = (fieldId: string, v: FieldValue) => setValues((prev) => ({ ...prev, [fieldId]: v }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          if (locationGroupKeys.has(field.fieldKey) && field.fieldKey !== "address_country") return null;

          if (field.fieldKey === "address_country" && locationGroupKeys.size > 0) {
            const stateField = fieldsByKey["address_state"];
            const cityField = fieldsByKey["address_city"];
            return (
              <div key="address-group" className="sm:col-span-2">
                <LocationSelect
                  country={(values[field.id] as string) ?? ""}
                  state={stateField ? (values[stateField.id] as string) ?? "" : ""}
                  city={cityField ? (values[cityField.id] as string) ?? "" : ""}
                  onCountryChange={(v) => setValue(field.id, v || null)}
                  onStateChange={(v) => stateField && setValue(stateField.id, v || null)}
                  onCityChange={(v) => cityField && setValue(cityField.id, v || null)}
                  includeCity={!!cityField}
                />
                {[field, stateField, cityField].filter(Boolean).map((f) => (
                  fieldError?.field === f!.id && <p key={f!.id} className="text-xs text-destructive mt-1">{fieldError!.message}</p>
                ))}
              </div>
            );
          }

          const value = values[field.id] ?? null;
          const fieldErrorMessage = fieldError?.field === field.id ? fieldError.message : undefined;

          if (field.fieldKey === "employee_id") {
            return (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input id={field.id} value={(value as string) ?? ""} disabled readOnly title="Assigned automatically and cannot be edited" />
              </div>
            );
          }

          if (field.fieldKey === "nationality") {
            return (
              <div key={field.id}>
                <NationalitySelect label={`${field.label}${field.isRequired ? " *" : ""}`} value={(value as string) ?? ""} onChange={(v) => setValue(field.id, v || null)} />
                {fieldErrorMessage && <p className="text-xs text-destructive mt-1">{fieldErrorMessage}</p>}
              </div>
            );
          }

          const socialPlatform = socialPlatformFromFieldKey(field.fieldKey);
          if (socialPlatform) {
            return (
              <div key={field.id}>
                <SocialUrlField platform={socialPlatform} value={(value as string) ?? ""} onChange={(v) => setValue(field.id, v || null)} error={fieldErrorMessage} />
              </div>
            );
          }

          if (field.fieldType === "phone") {
            const split = splitNormalizedPhone((value as string) ?? "") ?? { countryCode: "+234", localNumber: (value as string) ?? "" };
            return (
              <div key={field.id}>
                <Label className="mb-2 block">{field.label}{field.isRequired && <span className="text-destructive"> *</span>}</Label>
                <PhoneInput
                  countryCode={split.countryCode}
                  phoneNumber={split.localNumber}
                  onCountryCodeChange={(code) => setValue(field.id, normalizePhoneForStorage(split.localNumber, code) || null)}
                  onPhoneNumberChange={(num) => setValue(field.id, num ? normalizePhoneForStorage(num, split.countryCode) : null)}
                  countryCodeLabel=""
                  phoneNumberLabel=""
                />
                {fieldErrorMessage && <p className="text-xs text-destructive mt-1">{fieldErrorMessage}</p>}
              </div>
            );
          }

          return (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id}>
                {field.label}{field.isRequired && <span className="text-destructive"> *</span>}
              </Label>
              <FieldInput field={field} value={value} onChange={(v) => setValue(field.id, v)} />
              {fieldErrorMessage && <p className="text-xs text-destructive">{fieldErrorMessage}</p>}
            </div>
          );
        })}
      </div>
      <Button
        onClick={() => {
          const error = validateBeforeSubmit();
          setFieldError(error);
          if (error) {
            toast({ variant: "destructive", title: "Could not save", description: error.message });
            return;
          }
          saveMutation.mutate();
        }}
        disabled={saveMutation.isPending}
        data-testid="button-save-hr-fields"
      >
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save
      </Button>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: HrField; value: FieldValue; onChange: (v: FieldValue) => void }) {
  const v = field.validation;
  switch (field.fieldType) {
    case "textarea":
      return <Textarea id={field.id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={v?.maxLength} />;
    case "number":
      return <Input id={field.id} type="number" value={value === null ? "" : Number(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} min={v?.min} max={v?.max} step={v?.integerOnly ? 1 : undefined} />;
    case "date":
      return <Input id={field.id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return <Switch id={field.id} checked={!!value} onCheckedChange={(checked) => onChange(checked)} />;
    case "email":
      return <Input id={field.id} type="email" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "phone":
      return <Input id={field.id} type="tel" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={v?.maxLength} />;
    case "select":
      return (
        <Select value={(value as string) ?? undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={field.id}><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => onChange(active ? selected.filter((v) => v !== opt.value) : [...selected, opt.value])}
                className={`text-xs px-2.5 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "border-input"}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return <Input id={field.id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} maxLength={v?.maxLength} />;
  }
}
