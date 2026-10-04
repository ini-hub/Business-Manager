import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { splitNormalizedPhone, normalizePhoneForStorage } from "@shared/phone-utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { PhoneInput } from "@/components/phone-input";
import { LocationSelect } from "@/components/location-select";

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string | null;
  workPhone: string | null;
  workPhoneExt: string | null;
  homePhone: string | null;
  mobile: string | null;
  email: string | null;
  addressStreet1: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostcode: string | null;
  addressCountry: string | null;
}

const EMPTY = { name: "", relationship: "", workPhone: "", workPhoneExt: "", homePhone: "", mobile: "", email: "", addressStreet1: "", addressCity: "", addressState: "", addressPostcode: "", addressCountry: "" };

export function EmergencyContactsTab({ staffId, basePath }: { staffId: string; basePath: "/api/hr" | "/api/profile-completion" }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listUrl = basePath === "/api/hr" ? `/api/hr/staff/${staffId}/emergency-contacts` : `/api/profile-completion/emergency-contacts`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const { data: contacts = [], isLoading } = useQuery<EmergencyContact[]>({
    queryKey: [listUrl],
    queryFn: async () => (await apiRequest("GET", listUrl)).json(),
    enabled: !!staffId,
  });

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", listUrl, form),
    onSuccess: () => {
      toast({ title: "Contact added" });
      queryClient.invalidateQueries({ queryKey: [listUrl] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not add contact", description: getUserFriendlyError(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${listUrl}/${id}`),
    onSuccess: () => {
      toast({ title: "Contact removed" });
      queryClient.invalidateQueries({ queryKey: [listUrl] });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not remove contact", description: getUserFriendlyError(error) }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {contacts.map((c) => (
        <Card key={c.id}>
          <CardContent className="pt-4 flex items-start justify-between">
            <div className="text-sm space-y-0.5">
              <p className="font-medium">{c.name} {c.relationship && <span className="text-muted-foreground font-normal">({c.relationship})</span>}</p>
              {c.mobile && <p className="text-muted-foreground">Mobile: {c.mobile}</p>}
              {c.workPhone && <p className="text-muted-foreground">Work: {c.workPhone}{c.workPhoneExt ? ` ext. ${c.workPhoneExt}` : ""}</p>}
              {c.homePhone && <p className="text-muted-foreground">Home: {c.homePhone}</p>}
              {c.email && <p className="text-muted-foreground">{c.email}</p>}
              {(c.addressStreet1 || c.addressCity) && (
                <p className="text-muted-foreground">{[c.addressStreet1, c.addressCity, c.addressState, c.addressPostcode, c.addressCountry].filter(Boolean).join(", ")}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)} data-testid={`button-delete-emergency-contact-${c.id}`}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </CardContent>
        </Card>
      ))}
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">No emergency contacts added yet.</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" data-testid="button-add-emergency-contact"><Plus className="h-4 w-4 mr-2" />Add contact</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add emergency contact</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Relationship" value={form.relationship} onChange={(v) => setForm({ ...form, relationship: v })} />
            <div className="sm:col-span-2">
              <PhoneField label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
            </div>
            <div className="sm:col-span-2">
              <PhoneField label="Work Phone" value={form.workPhone} onChange={(v) => setForm({ ...form, workPhone: v })} />
            </div>
            <Field label="Work Phone Ext" value={form.workPhoneExt} onChange={(v) => setForm({ ...form, workPhoneExt: v })} />
            <Field label="Home Phone" value={form.homePhone} onChange={(v) => setForm({ ...form, homePhone: v })} />
            <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label="Street" value={form.addressStreet1} onChange={(v) => setForm({ ...form, addressStreet1: v })} />
          </div>
          <LocationSelect
            country={form.addressCountry}
            state={form.addressState}
            city={form.addressCity}
            onCountryChange={(v) => setForm({ ...form, addressCountry: v })}
            onStateChange={(v) => setForm({ ...form, addressState: v })}
            onCityChange={(v) => setForm({ ...form, addressCity: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Postcode" value={form.addressPostcode} onChange={(v) => setForm({ ...form, addressPostcode: v })} />
          </div>
          <DialogFooter>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name.trim() || createMutation.isPending} data-testid="button-save-emergency-contact">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Stores the canonical dial-code+digits string (shared/phone-utils.ts) in
// the one text column these contacts have per phone field - same shape
// staff.mobileNumber uses, so lookups/normalization stay consistent across
// the app instead of each form inventing its own phone string format.
function PhoneField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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
      />
    </div>
  );
}
