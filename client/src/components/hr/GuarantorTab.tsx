import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, CheckCircle2, Copy, Check } from "lucide-react";
import { apiRequest, type ApiError } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { splitNormalizedPhone, normalizePhoneForStorage } from "@shared/phone-utils";
import { PhoneInput } from "@/components/phone-input";
import { LocationSelect } from "@/components/location-select";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/loader";

type Party = "employee" | "next_of_kin";

const partyFields = [
  ["title", "Title"], ["surname", "Surname"], ["otherNames", "Other Names"],
  ["dob", "Date of Birth"], ["nin", "NIN"], ["address", "Residential Address"],
  ["nearestBusStop", "Nearest Bus Stop"], ["landmark", "Closest Landmark"],
  ["mobile", "Mobile Telephone"], ["email", "Email Address"],
] as const;

function emptyParty() {
  return { title: "", surname: "", otherNames: "", dob: "", nin: "", address: "", addressCountry: "", addressState: "", addressCity: "", nearestBusStop: "", landmark: "", mobile: "", email: "" };
}

/**
 * The EMPLOYEE's side of the guarantor form: Employee + Next of Kin data
 * only. The guarantor section itself (identity, business info, eligibility
 * checklist, ID/photo, and the signature) is not something the employee
 * fills in on the guarantor's behalf - it must be entered, once, by the
 * actual guarantor, via the shareable link this component surfaces after
 * initiating. See client/src/pages/guarantor-sign.tsx for that side.
 */
export function GuarantorTab({ staffId, basePath }: { staffId: string; basePath: "/api/hr" | "/api/profile-completion" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isProfileCompletion = basePath === "/api/profile-completion";
  const statusUrl = isProfileCompletion ? `/api/profile-completion/guarantor` : `/api/hr/staff/${staffId}/guarantor`;
  const initiateEndpoint = isProfileCompletion ? `/api/profile-completion/guarantor/initiate` : `/api/hr/staff/${staffId}/guarantor/initiate`;
  const uploadUrlEndpoint = isProfileCompletion ? `/api/profile-completion/guarantor/upload-url` : `/api/hr/guarantor/upload-url`;
  const personalFieldsUrl = isProfileCompletion ? `/api/profile-completion/personal/fields` : `/api/hr/staff/${staffId}/field-values/personal`;

  interface GuarantorStatus {
    status: string;
    declinedReason?: string;
    employee?: ReturnType<typeof emptyParty>;
    nextOfKin?: ReturnType<typeof emptyParty> & { relationship: string };
    guarantorContactEmail?: string;
    guarantorContactPhone?: string;
    documents?: Array<{ party: Party; docType: "id_document" | "photo"; storageKey: string; fileMimeType: string; fileSizeBytes: number; fileOriginalName: string }>;
  }

  const { data: status, isLoading } = useQuery<GuarantorStatus>({
    queryKey: [statusUrl],
    queryFn: async () => (await apiRequest("GET", statusUrl)).json(),
    enabled: !!staffId,
  });

  // Reused only to prefill "Your Details (Employee)" below, on a first-ever
  // submission - not read anywhere else. The guarantor form keeps its own
  // immutable copy of this data (it's a signed legal snapshot the personal
  // profile can keep changing after), but re-typing what Personal
  // Information already has on file is friction with no upside, so this
  // starts the employee section from it instead of blank.
  const { data: personalFields } = useQuery<Array<{ fieldKey: string; value: string | number | boolean | string[] | null }>>({
    queryKey: [personalFieldsUrl],
    queryFn: async () => (await apiRequest("GET", personalFieldsUrl)).json(),
    enabled: !!staffId,
  });

  const [employee, setEmployee] = useState(emptyParty());
  const [nextOfKin, setNextOfKin] = useState({ ...emptyParty(), relationship: "" });
  const [guarantorContactEmail, setGuarantorContactEmail] = useState("");
  const [guarantorContactPhone, setGuarantorContactPhone] = useState("");
  const [documents, setDocuments] = useState<Array<{ party: Party; docType: "id_document" | "photo"; storageKey: string; fileMimeType: string; fileSizeBytes: number; fileOriginalName: string }>>([]);
  const [signingLink, setSigningLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  // Hydrate once from whatever was already submitted, so reloading this page
  // (or relogging in) doesn't show a blank form as if nothing had been
  // saved - see server/services/GuarantorFormService.getEmployeeSubmissionForStaff.
  // Guarded to run once per load: this form has its own local state (not a
  // controlled read of `status`), so a background refetch after the user has
  // started typing must not stomp their in-progress edits.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !status) return;
    if (status.employee) {
      hydrated.current = true;
      setEmployee(status.employee);
      if (status.nextOfKin) setNextOfKin(status.nextOfKin);
      if (status.guarantorContactEmail) setGuarantorContactEmail(status.guarantorContactEmail);
      if (status.guarantorContactPhone) setGuarantorContactPhone(status.guarantorContactPhone);
      if (status.documents) setDocuments(status.documents);
      return;
    }
    // Nothing submitted yet - prefill the overlapping fields from Personal
    // Information instead of leaving them blank (waits for personalFields so
    // it only runs once, with real data, not an empty flash).
    if (!personalFields) return;
    hydrated.current = true;
    const byKey = new Map(personalFields.map((f) => [f.fieldKey, f.value]));
    const str = (key: string) => {
      const v = byKey.get(key);
      return typeof v === "string" ? v : "";
    };
    const firstName = str("first_name");
    const lastName = str("last_name");
    if (!firstName && !lastName && !str("mobile_number") && !str("work_email") && !str("home_email")) return;
    setEmployee((prev) => ({
      ...prev,
      surname: lastName || prev.surname,
      otherNames: firstName || prev.otherNames,
      dob: str("date_of_birth") || prev.dob,
      mobile: str("mobile_number") || prev.mobile,
      email: str("work_email") || str("home_email") || prev.email,
      addressCountry: str("address_country") || prev.addressCountry,
      addressState: str("address_state") || prev.addressState,
      addressCity: str("address_city") || prev.addressCity,
    }));
  }, [status, personalFields]);

  const uploadDoc = async (party: Party, docType: "id_document" | "photo", file: File) => {
    const { uploadUrl, storageKey } = await (await apiRequest("POST", uploadUrlEndpoint, { fileName: file.name, mimeType: file.type })).json();
    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    setDocuments((prev) => [...prev.filter((d) => !(d.party === party && d.docType === docType)), { party, docType, storageKey, fileMimeType: file.type, fileSizeBytes: file.size, fileOriginalName: file.name }]);
  };

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", initiateEndpoint, { employee, nextOfKin, guarantorContactEmail, guarantorContactPhone: guarantorContactPhone || undefined, documents });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Guarantor link sent" });
      setFieldError(null);
      setSigningLink(`${window.location.origin}/guarantor/sign?token=${data.signingToken}`);
      setEmailSent(true);
      queryClient.invalidateQueries({ queryKey: [statusUrl] });
    },
    onError: (error: ApiError) => {
      setFieldError({ field: error.field, message: error.message });
      toast({ variant: "destructive", title: "Could not submit", description: error.field ? error.message : getUserFriendlyError(error) });
    },
  });

  const copyLink = () => {
    if (!signingLink) return;
    navigator.clipboard.writeText(signingLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isLoading) return <div className="flex justify-center py-8"><Spinner className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (status?.status === "signed") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 py-4">
        <CheckCircle2 className="h-5 w-5" /> Guarantor form completed and signed.
      </div>
    );
  }

  if (status?.status === "awaiting_guarantor" && !signingLink) {
    return (
      <div className="space-y-2 py-4 text-sm">
        <p>Your details have been submitted and the signing link has been emailed to your guarantor. This is now waiting on them to fill in their own section and sign.</p>
        <p className="text-muted-foreground">If you need to resend the link or correct your own details, you can resubmit below.</p>
        <GuarantorEditForm
          employee={employee} setEmployee={setEmployee} nextOfKin={nextOfKin} setNextOfKin={setNextOfKin}
          guarantorContactEmail={guarantorContactEmail} setGuarantorContactEmail={setGuarantorContactEmail}
          guarantorContactPhone={guarantorContactPhone} setGuarantorContactPhone={setGuarantorContactPhone}
          onUpload={uploadDoc} documents={documents} onSubmit={() => initiateMutation.mutate()} isPending={initiateMutation.isPending}
          fieldError={fieldError}
        />
      </div>
    );
  }

  if (status?.status === "declined") {
    return (
      <div className="space-y-2 py-4 text-sm">
        <p className="text-destructive">Your guarantor declined this request{status.declinedReason ? `: "${status.declinedReason}"` : "."}</p>
        <p className="text-muted-foreground">You can submit a new request below - either to the same person or someone else.</p>
        <GuarantorEditForm
          employee={employee} setEmployee={setEmployee} nextOfKin={nextOfKin} setNextOfKin={setNextOfKin}
          guarantorContactEmail={guarantorContactEmail} setGuarantorContactEmail={setGuarantorContactEmail}
          guarantorContactPhone={guarantorContactPhone} setGuarantorContactPhone={setGuarantorContactPhone}
          onUpload={uploadDoc} documents={documents} onSubmit={() => initiateMutation.mutate()} isPending={initiateMutation.isPending}
          fieldError={fieldError}
        />
      </div>
    );
  }

  if (signingLink) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Guarantor link sent</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {emailSent && `We've emailed the signing link to ${guarantorContactEmail}. `}
            You can also copy the link below to share it directly (e.g. via WhatsApp or SMS) - it can only be used once, and their submission becomes permanent once signed.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={signingLink} onClick={(e) => (e.target as HTMLInputElement).select()} data-testid="input-guarantor-signing-link" />
            <Button variant="outline" size="icon" onClick={copyLink} data-testid="button-copy-guarantor-link">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <GuarantorEditForm
      employee={employee} setEmployee={setEmployee} nextOfKin={nextOfKin} setNextOfKin={setNextOfKin}
      guarantorContactEmail={guarantorContactEmail} setGuarantorContactEmail={setGuarantorContactEmail}
      guarantorContactPhone={guarantorContactPhone} setGuarantorContactPhone={setGuarantorContactPhone}
      onUpload={uploadDoc} documents={documents} onSubmit={() => initiateMutation.mutate()} isPending={initiateMutation.isPending}
      fieldError={fieldError}
    />
  );
}

function GuarantorEditForm({
  employee, setEmployee, nextOfKin, setNextOfKin,
  guarantorContactEmail, setGuarantorContactEmail, guarantorContactPhone, setGuarantorContactPhone,
  onUpload, documents, onSubmit, isPending, fieldError,
}: {
  employee: Record<string, string>; setEmployee: (v: any) => void;
  nextOfKin: Record<string, string>; setNextOfKin: (v: any) => void;
  guarantorContactEmail: string; setGuarantorContactEmail: (v: string) => void;
  guarantorContactPhone: string; setGuarantorContactPhone: (v: string) => void;
  onUpload: (party: Party, docType: "id_document" | "photo", file: File) => void;
  documents: Array<{ party: Party; docType: string }>;
  onSubmit: () => void; isPending: boolean;
  fieldError: { field?: string; message: string } | null;
}) {
  const emailValid = /\S+@\S+\.\S+/.test(guarantorContactEmail);
  return (
    <div className="space-y-6">
      <PartySection title="Your Details (Employee)" party="employee" values={employee} onChange={setEmployee} onUpload={onUpload} documents={documents} fieldError={fieldError} pathPrefix="employee" />
      <PartySection title="Next of Kin Data" party="next_of_kin" values={nextOfKin} onChange={setNextOfKin} onUpload={onUpload} documents={documents} fieldError={fieldError} pathPrefix="nextOfKin" extra={
        <Field label="Relationship *" value={(nextOfKin as any).relationship} onChange={(v) => setNextOfKin({ ...nextOfKin, relationship: v })} error={fieldError?.field === "nextOfKin.relationship" ? fieldError.message : undefined} />
      } />

      <Card>
        <CardHeader><CardTitle className="text-base">Who is your guarantor?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">We'll email them a link to fill in their own details and sign. They never see or edit what you've entered above.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guarantor's email *" value={guarantorContactEmail} onChange={setGuarantorContactEmail} error={fieldError?.field === "guarantorContactEmail" ? fieldError.message : undefined} />
            <PhoneField label="Guarantor's phone (optional)" value={guarantorContactPhone} onChange={setGuarantorContactPhone} error={fieldError?.field === "guarantorContactPhone" ? fieldError.message : undefined} />
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={onSubmit}
        disabled={isPending || !employee.surname || !nextOfKin.surname || !emailValid}
        data-testid="button-generate-guarantor-link"
      >
        {isPending && <Spinner className="h-5 w-5 mr-2 animate-spin" />}
        Email guarantor link
      </Button>
    </div>
  );
}

function PartySection({ title, party, values, onChange, onUpload, documents, extra, fieldError, pathPrefix }: {
  title: string; party: Party; values: Record<string, string>; onChange: (v: any) => void;
  onUpload: (party: Party, docType: "id_document" | "photo", file: File) => void;
  documents: Array<{ party: Party; docType: string }>; extra?: React.ReactNode;
  fieldError: { field?: string; message: string } | null; pathPrefix: string;
}) {
  const hasId = documents.some((d) => d.party === party && d.docType === "id_document");
  const hasPhoto = documents.some((d) => d.party === party && d.docType === "photo");
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {partyFields.map(([key, label]) => {
            const error = fieldError?.field === `${pathPrefix}.${key}` ? fieldError.message : undefined;
            if (key === "mobile") {
              return <PhoneField key={key} label={label} value={values[key] ?? ""} onChange={(v) => onChange({ ...values, [key]: v })} error={error} />;
            }
            if (key === "dob") {
              return <DateField key={key} label={label} value={values[key] ?? ""} onChange={(v) => onChange({ ...values, [key]: v })} error={error} />;
            }
            return <Field key={key} label={label} value={values[key] ?? ""} onChange={(v) => onChange({ ...values, [key]: v })} error={error} />;
          })}
          {extra}
        </div>
        <LocationSelect
          country={values.addressCountry ?? ""}
          state={values.addressState ?? ""}
          city={values.addressCity ?? ""}
          onCountryChange={(v) => onChange({ ...values, addressCountry: v })}
          onStateChange={(v) => onChange({ ...values, addressState: v })}
          onCityChange={(v) => onChange({ ...values, addressCity: v })}
        />
        <div className="flex gap-4 pt-1">
          <UploadButton label={hasId ? "ID uploaded ✓" : "Upload ID"} onSelect={(f) => onUpload(party, "id_document", f)} />
          <UploadButton label={hasPhoto ? "Photo uploaded ✓" : "Upload Photo"} onSelect={(f) => onUpload(party, "photo", f)} />
        </div>
      </CardContent>
    </Card>
  );
}

function UploadButton({ label, onSelect }: { label: string; onSelect: (f: File) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
      <Upload className="h-3.5 w-3.5" /> {label}
      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onSelect(e.target.files[0])} />
    </label>
  );
}

function Field({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={error ? "border-destructive focus-visible:ring-destructive" : undefined} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DateField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} max={new Date().toISOString().slice(0, 10)} className={error ? "border-destructive focus-visible:ring-destructive" : undefined} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Stores the canonical dial-code+digits string (shared/phone-utils.ts) -
// same reusable PhoneInput + storage shape as EmergencyContactsTab and the
// HR dynamic field form's "phone" fieldType, so mobile numbers are entered
// and validated the same way everywhere in the app.
function PhoneField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const split = splitNormalizedPhone(value) ?? { countryCode: "+234", localNumber: value };
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <PhoneInput
        countryCode={split.countryCode}
        phoneNumber={split.localNumber}
        onCountryCodeChange={(code) => onChange(split.localNumber ? normalizePhoneForStorage(split.localNumber, code) : "")}
        onPhoneNumberChange={(num) => onChange(num ? normalizePhoneForStorage(num, split.countryCode) : "")}
        countryCodeLabel=""
        phoneNumberLabel=""
        className={error ? "border-destructive focus-visible:ring-destructive" : undefined}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
