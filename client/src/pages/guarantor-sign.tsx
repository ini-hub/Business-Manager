import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Upload, Camera } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationSelect } from "@/components/location-select";
import { FullScreenLoader, Spinner } from "@/components/ui/loader";

interface PendingForm {
  version: {
    employeeSurname: string;
    employeeOtherNames: string;
    nokSurname: string;
    nokOtherNames: string;
  };
}

const ELIGIBILITY_ITEMS = [
  "I am at least 25 years of age",
  "I am gainfully employed (working class or entrepreneur)",
  "I am not a family member of the employee by blood",
  "I have attached a valid means of ID",
];

const GUARANTOR_FIELDS = [
  ["title", "Title"], ["surname", "Surname"], ["otherNames", "Other Names"],
  ["dob", "Date of Birth"], ["nin", "NIN"], ["address", "Residential Address"],
  ["nearestBusStop", "Nearest Bus Stop"], ["landmark", "Closest Landmark"],
  ["mobile", "Mobile Telephone"], ["email", "Email Address"],
] as const;

const BUSINESS_FIELDS = [
  ["businessName", "Business/Organization Name"], ["businessAddress", "Business Address"],
  ["occupation", "Occupation/Job Title"], ["jobGrade", "Job Grade/Level"], ["officialEmail", "Official Email Address"],
] as const;

function emptyGuarantor() {
  return { title: "", surname: "", otherNames: "", dob: "", nin: "", address: "", addressCountry: "", addressState: "", addressCity: "", nearestBusStop: "", landmark: "", mobile: "", email: "", businessName: "", businessAddress: "", occupation: "", jobGrade: "", officialEmail: "" };
}

/**
 * The actual guarantor's own page - no login, gated entirely by ?token= (a
 * guarantor_pending JWT, see requireGuarantorSigningToken in server/auth.ts).
 * Reached from the link the employee generates in
 * client/src/components/hr/GuarantorTab.tsx after submitting their own
 * Employee + Next of Kin data. This is where the guarantor section is
 * actually filled in - the employee never sees or enters this data - and
 * where the signature (a photographed/uploaded image, not a typed name) is
 * captured. One shot: once submitted, the form is signed and immutable.
 */
export default function GuarantorSignPage() {
  const { toast } = useToast();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [signed, setSigned] = useState(false);
  const [declined, setDeclined] = useState(false);

  const [guarantor, setGuarantor] = useState(emptyGuarantor());
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [idDoc, setIdDoc] = useState<{ storageKey: string; fileMimeType: string; fileSizeBytes: number; fileOriginalName: string } | null>(null);
  const [photoDoc, setPhotoDoc] = useState<{ storageKey: string; fileMimeType: string; fileSizeBytes: number; fileOriginalName: string } | null>(null);
  const [signatureImage, setSignatureImage] = useState<{ storageKey: string; fileMimeType: string; fileSizeBytes: number } | null>(null);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null);
  const [printedFullName, setPrintedFullName] = useState("");
  const [yearsKnownEmployee, setYearsKnownEmployee] = useState("");
  const [relationshipToEmployee, setRelationshipToEmployee] = useState("");
  const [affirmedReadAndAgree, setAffirmedReadAndAgree] = useState(false);
  const [acceptsLiability, setAcceptsLiability] = useState(false);
  const [consentedElectronicSignature, setConsentedElectronicSignature] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<PendingForm>({
    queryKey: ["/api/guarantor/pending", token],
    queryFn: async () => (await apiRequest("GET", `/api/guarantor/pending?token=${encodeURIComponent(token)}`)).json(),
    enabled: !!token,
    retry: false,
  });

  const upload = async (kind: "id" | "photo" | "signature", file: File) => {
    setUploading(kind);
    try {
      const { uploadUrl, storageKey } = await (await apiRequest("POST", `/api/guarantor/upload-url?token=${encodeURIComponent(token)}`, { fileName: file.name, mimeType: file.type })).json();
      await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      const doc = { storageKey, fileMimeType: file.type, fileSizeBytes: file.size, fileOriginalName: file.name };
      if (kind === "id") setIdDoc(doc);
      else if (kind === "photo") setPhotoDoc(doc);
      else {
        setSignatureImage(doc);
        setSignaturePreviewUrl(URL.createObjectURL(file));
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: getUserFriendlyError(err) });
    } finally {
      setUploading(null);
    }
  };

  const fillAndSignMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/guarantor/fill?token=${encodeURIComponent(token)}`, {
      guarantor,
      eligibilityChecklist: checklist,
      documents: [idDoc && { ...idDoc, party: "guarantor", docType: "id_document" }, photoDoc && { ...photoDoc, party: "guarantor", docType: "photo" }].filter(Boolean),
      printedFullName,
      signatureImage,
      yearsKnownEmployee: Number(yearsKnownEmployee),
      relationshipToEmployee,
      affirmedReadAndAgree, acceptsLiability, consentedElectronicSignature,
    }),
    onSuccess: () => { toast({ title: "Signature recorded" }); setSigned(true); },
    onError: (err) => toast({ variant: "destructive", title: "Could not submit", description: getUserFriendlyError(err) }),
  });

  const declineMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/guarantor/decline?token=${encodeURIComponent(token)}`, { reason: declineReason }),
    onSuccess: () => { toast({ title: "Response recorded" }); setDeclined(true); },
    onError: (err) => toast({ variant: "destructive", title: "Could not submit", description: getUserFriendlyError(err) }),
  });

  if (!token) return <CenteredMessage title="Invalid link" description="This link is missing its token." />;
  if (isLoading) return <FullScreenLoader />;
  if (signed) return <CenteredMessage icon={<CheckCircle2 className="h-10 w-10 text-green-600" />} title="Thank you" description="Your information and signature have been recorded." />;
  if (declined) return <CenteredMessage icon={<XCircle className="h-10 w-10 text-muted-foreground" />} title="Response recorded" description="Thank you for letting us know." />;
  if (error || !data) return <CenteredMessage title="This link is no longer valid" description="It may have expired or already been used." />;

  const { version } = data;
  const canSubmit = !!idDoc && !!signatureImage && !!printedFullName && !!yearsKnownEmployee && !!relationshipToEmployee
    && affirmedReadAndAgree && acceptsLiability && consentedElectronicSignature
    && ELIGIBILITY_ITEMS.every((item) => checklist[item]);

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Guarantor Form</CardTitle>
            <CardDescription>
              You are being asked to act as guarantor for {version.employeeOtherNames} {version.employeeSurname}. Please fill in your details below - this can only be submitted once.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Your Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {GUARANTOR_FIELDS.map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    type={key === "dob" ? "date" : "text"}
                    max={key === "dob" ? new Date().toISOString().slice(0, 10) : undefined}
                    value={(guarantor as any)[key]}
                    onChange={(e) => setGuarantor({ ...guarantor, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <LocationSelect
              country={guarantor.addressCountry}
              state={guarantor.addressState}
              city={guarantor.addressCity}
              onCountryChange={(v) => setGuarantor({ ...guarantor, addressCountry: v })}
              onStateChange={(v) => setGuarantor({ ...guarantor, addressState: v })}
              onCityChange={(v) => setGuarantor({ ...guarantor, addressCity: v })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Business/Employment Details</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {BUSINESS_FIELDS.map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label>{label}</Label>
                <Input value={(guarantor as any)[key]} onChange={(e) => setGuarantor({ ...guarantor, [key]: e.target.value })} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Eligibility</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {ELIGIBILITY_ITEMS.map((item) => (
              <label key={item} className="flex items-start gap-2 text-sm">
                <Checkbox checked={!!checklist[item]} onCheckedChange={(v) => setChecklist((prev) => ({ ...prev, [item]: !!v }))} />
                {item}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Identification</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <UploadTile label={idDoc ? "ID uploaded ✓" : "Upload ID"} busy={uploading === "id"} onSelect={(f) => upload("id", f)} />
            <UploadTile label={photoDoc ? "Photo uploaded ✓" : "Upload Photo (optional)"} busy={uploading === "photo"} onSelect={(f) => upload("photo", f)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Declaration &amp; Signature</CardTitle>
            <CardDescription>
              I hereby confirm that {version.employeeOtherNames} {version.employeeSurname} has been known to me and I declare that all
              information and ID tendered for this purpose are valid and authentic. I confirm that the employee is of
              good character, fit and proper to work in this organization. I accept to produce the employee for any
              loss or liability incurred as a result of their action, inaction, negligence or fraud, and if unable to,
              I accept to remedy or refund the loss or liability on behalf of the employee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              <Label>Your printed full name *</Label>
              <Input value={printedFullName} onChange={(e) => setPrintedFullName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Years known *</Label>
                <Input type="number" value={yearsKnownEmployee} onChange={(e) => setYearsKnownEmployee(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Relationship *</Label>
                <Input value={relationshipToEmployee} onChange={(e) => setRelationshipToEmployee(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Signature *</Label>
              <p className="text-xs text-muted-foreground">Snap a photo of your handwritten signature, or upload one - this is your actual signature, not a typed name.</p>
              {signaturePreviewUrl && <img src={signaturePreviewUrl} alt="Your signature" className="h-20 border rounded-md bg-white object-contain px-2" />}
              <UploadTile label={signatureImage ? "Replace signature" : "Snap / upload signature"} busy={uploading === "signature"} onSelect={(f) => upload("signature", f)} capture icon={<Camera className="h-3.5 w-3.5" />} />
            </div>

            <label className="flex items-start gap-2"><Checkbox checked={affirmedReadAndAgree} onCheckedChange={(v) => setAffirmedReadAndAgree(!!v)} />I have read and agree to this declaration.</label>
            <label className="flex items-start gap-2"><Checkbox checked={acceptsLiability} onCheckedChange={(v) => setAcceptsLiability(!!v)} />I accept the liability terms described above.</label>
            <label className="flex items-start gap-2"><Checkbox checked={consentedElectronicSignature} onCheckedChange={(v) => setConsentedElectronicSignature(!!v)} />I consent to sign electronically.</label>

            <Button onClick={() => fillAndSignMutation.mutate()} disabled={!canSubmit || fillAndSignMutation.isPending} data-testid="button-sign-guarantor-form">
              {fillAndSignMutation.isPending && <Spinner className="h-5 w-5 mr-2 animate-spin" />}Submit and sign
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Decline instead</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea placeholder="Reason (optional)" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
            <Button variant="outline" onClick={() => declineMutation.mutate()} disabled={declineMutation.isPending} data-testid="button-decline-guarantor-form">
              {declineMutation.isPending && <Spinner className="h-5 w-5 mr-2 animate-spin" />}Decline
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UploadTile({ label, onSelect, busy, capture, icon }: { label: string; onSelect: (f: File) => void; busy?: boolean; capture?: boolean; icon?: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
      {busy ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : (icon ?? <Upload className="h-3.5 w-3.5" />)} {label}
      <input
        type="file"
        accept="image/*,application/pdf"
        capture={capture ? "environment" : undefined}
        className="hidden"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && onSelect(e.target.files[0])}
      />
    </label>
  );
}

function CenteredMessage({ icon, title, description }: { icon?: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="text-center space-y-2 max-w-sm">
        {icon && <div className="flex justify-center">{icon}</div>}
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
