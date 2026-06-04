import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Phone, Mail, MapPin, FileText, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { validateEmail, getDefaultCountryCode } from "@/lib/validation-utils";

const empty = { name: "", contactName: "", email: "", phone: "", address: "", notes: "" };

export default function VendorFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [form, setForm] = useState(empty);
  const [phoneCountryCode, setPhoneCountryCode] = useState(
    () => deduplicatedCountryCodes.find(c => c.code === getDefaultCountryCode(currentStore?.currency))?.dialCode ?? "+234"
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, setIsPending] = useState(false);

  const { data: vendor } = useQuery<any>({
    queryKey: ["/api/vendors", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors/${id}`);
      return res.json();
    },
    enabled: isEdit,
  });

  useEffect(() => {
    if (vendor) {
      setForm({
        name: vendor.name ?? "",
        contactName: vendor.contactName ?? "",
        email: vendor.email ?? "",
        phone: vendor.phone ?? "",
        address: vendor.address ?? "",
        notes: vendor.notes ?? "",
      });
    }
  }, [vendor]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Vendor name is required.";
    if (form.email) {
      const emailCheck = validateEmail(form.email);
      if (!emailCheck.valid) errs.email = emailCheck.error!;
    }
    if (form.phone) {
      const phoneCheck = validatePhoneNumber(form.phone, phoneCountryCode);
      if (!phoneCheck.valid) errs.phone = phoneCheck.error!;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!validate()) throw new Error("Please fix the errors above.");
      const payload = { ...form, storeId: currentStore!.id };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/vendors/${id}`, payload)
        : await apiRequest("POST", "/api/vendors", payload);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to save vendor");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors", currentStore?.id] });
      toast({ title: isEdit ? "Vendor updated" : "Vendor added" });
      setLocation("/vendors");
    },
    onError: (e: Error) => {
      if (e.message !== "Please fix the errors above.") {
        toast({ title: "Error", description: e.message, variant: "destructive" });
      }
    },
  });

  if (!currentStore) return <StoreRequiredAlert />;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const nameInitials = form.name?.slice(0, 2).toUpperCase() || "";

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Top nav */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/vendors")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">{isEdit ? "Edit Vendor" : "New Vendor"}</h1>
          <p className="text-xs text-muted-foreground">{currentStore.name}</p>
        </div>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="shrink-0">
          {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Vendor"}
        </Button>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        {/* Identity banner */}
        <Card className="overflow-hidden border-0 shadow-sm">
          <div className="h-20 bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-transparent" />
          <CardContent className="-mt-10 pb-5 px-5">
            <div className="flex items-end gap-4">
              <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border-4 border-background flex items-center justify-center shadow-sm">
                {nameInitials
                  ? <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{nameInitials}</span>
                  : <Building2 className="h-7 w-7 text-muted-foreground" />
                }
              </div>
              <div className="pb-1">
                <p className="font-semibold text-sm leading-tight">
                  {form.name || (isEdit ? "Vendor" : "New Vendor")}
                </p>
                <Badge variant="outline" className="text-[10px] mt-0.5">Supplier</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business info */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Building2 className="h-3.5 w-3.5" />Business Details
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-name">
                Vendor / Supplier Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="v-name"
                value={form.name}
                onChange={set("name")}
                placeholder="e.g. Kolade Suppliers Ltd."
                className="h-11"
                autoFocus
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-contact">
                <span className="flex items-center gap-1.5">
                  <User className="h-3 w-3" />
                  Contact Person / Organization / Company
                </span>
              </Label>
              <Input
                id="v-contact"
                value={form.contactName}
                onChange={set("contactName")}
                placeholder="Jane Doe or Acme Ltd."
                className="h-11"
              />
            </div>
          </CardContent>
        </Card>

        {/* Contact info */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Phone className="h-3.5 w-3.5" />Contact Information
            </div>

            <div className="space-y-1.5">
              <Label>Phone <span className="font-normal text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex gap-2">
                <Select value={phoneCountryCode} onValueChange={setPhoneCountryCode}>
                  <SelectTrigger className="w-[120px] h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {deduplicatedCountryCodes.map(c => (
                      <SelectItem key={c.dialCode} value={c.dialCode}>
                        {c.name} ({c.dialCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id="v-phone"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="08012345678"
                  className="h-11"
                />
              </div>
              {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-email" className="flex items-center gap-1.5">
                <Mail className="h-3 w-3" />
                Email <span className="font-normal text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="v-email"
                value={form.email}
                onChange={set("email")}
                placeholder="vendor@company.com"
                className="h-11"
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-address" className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3" />
                Address <span className="font-normal text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="v-address"
                value={form.address}
                onChange={set("address")}
                placeholder="123 Market St, Lagos"
                className="h-11"
              />
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" />Notes
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-notes">Internal Notes <span className="font-normal text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea
                id="v-notes"
                value={form.notes}
                onChange={set("notes")}
                placeholder="Payment terms, delivery preferences, special instructions…"
                className="resize-none"
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bottom action */}
        <div className="flex gap-3 pt-2 pb-8">
          <Button variant="outline" className="flex-1" onClick={() => setLocation("/vendors")}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Vendor"}
          </Button>
        </div>
      </div>
    </div>
  );
}
