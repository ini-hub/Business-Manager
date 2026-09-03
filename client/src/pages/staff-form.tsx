import { useQuery, useMutation } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { useReturnTo } from "@/lib/return-to";
import { ArrowLeft, Mail, Shield, Phone, Hash, FileCheck, FileX, FileClock, User, Briefcase, Settings2, UserCheck, UserPlus, Unlink, Link2, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema, type Staff, type Customer, type StaffInviteStatus, type StaffContractStatus } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { uploadContractFileToStaging } from "@/lib/contract-upload";
import { useStore } from "@/lib/store-context";
import { countryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getCurrencyByCode } from "@/lib/currency-utils";
import { z } from "zod";
import { useEffect, useState } from "react";

const localStaffSchema = z.object({
  storeId: z.string().min(1, "Store ID is required"),
  name: z.string().min(1, "Staff name is required"),
  email: z.string().email("Valid email is required"),
  staffNumber: z.string().optional().default(""),
  countryCode: z.string().default("NG"),
  mobileNumber: z.string().min(1, "Mobile number is required"),
  payPerMonth: z.coerce.number().min(0),
  signedContract: z.boolean().default(false),
  role: z.string().default("staff"),
  paymentMethod: z.string().default("hybrid"),
  overridePaymentMethod: z.boolean().default(false),
  overrideCommission: z.boolean().default(false),
  commissionTypeOverride: z.string().nullable().optional(),
  commissionFixedAmountOverride: z.coerce.number().nullable().optional(),
  overrideFormula: z.boolean().default(false),
  commissionFormulaOverride: z.string().nullable().optional(),
  overrideAttendanceRates: z.boolean().default(false),
  activeDayRateOverride: z.coerce.number().nullable().optional(),
  passiveDayRateOverride: z.coerce.number().nullable().optional(),
  leaveDayRateOverride: z.coerce.number().nullable().optional(),
  payLeaveDaysOverride: z.boolean().default(false),
  holidayDayRateOverride: z.coerce.number().nullable().optional(),
  payHolidayDaysOverride: z.boolean().default(false),
  offDayRateOverride: z.coerce.number().nullable().optional(),
  payOffDaysOverride: z.boolean().default(false),
  commissionRateOverride: z.coerce.number().min(0).max(100).nullable().optional(),
});

export default function StaffFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { backHref } = useReturnTo("/staffs");
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const staffId = id === "new" ? undefined : id;

  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [selectedLinkCustomerId, setSelectedLinkCustomerId] = useState<string>("");

  const { data: staffMember, isLoading: isLoadingStaff } = useQuery<Staff & { inviteStatus?: StaffInviteStatus; contractStatus?: StaffContractStatus }>({
    queryKey: [`/api/staff/${staffId}`],
    enabled: !!staffId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff/${staffId}`);
      if (!res.ok) throw new Error("Staff member not found");
      return res.json();
    },
  });

  const { data: linkedCustomer, isLoading: isLoadingCustomer } = useQuery<Customer | null>({
    queryKey: [`/api/staff/${staffId}/customer-profile`],
    enabled: !!staffId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff/${staffId}/customer-profile`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: customerSearchResults = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", staffMember?.storeId, customerSearchQuery],
    enabled: isLinkDialogOpen && customerSearchQuery.trim().length >= 2 && !!staffMember?.storeId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/customers?storeId=${staffMember!.storeId}&search=${encodeURIComponent(customerSearchQuery)}&limit=10&page=1`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.data || [];
    },
  });

  const linkCustomerMutation = useMutation({
    mutationFn: (payload: { customerId?: string; createNew?: boolean }) =>
      apiRequest("POST", `/api/staff/${staffId}/link-customer`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/staff/${staffId}/customer-profile`] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Customer profile linked successfully" });
      setIsLinkDialogOpen(false);
      setSelectedLinkCustomerId("");
      setCustomerSearchQuery("");
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Link Profile", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const unlinkCustomerMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/staff/${staffId}/link-customer`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/staff/${staffId}/customer-profile`] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Customer profile unlinked" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't Unlink Profile", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  // ─── Contract ────────────────────────────────────────────────────────────
  // File/image contracts upload to a business-scoped staging key (POST
  // /api/staff/contract-upload-url) that doesn't need a real staffId yet, so
  // they can be attached inline at creation time too - see
  // uploadContractFileToStaging below, used both here (create) and by
  // attachContractMutation (edit/replace on an existing staff member).
  const [contractType, setContractType] = useState<"none" | "text" | "file" | "image">("none");
  const [contractText, setContractText] = useState("");
  const [contractAltText, setContractAltText] = useState("");
  const [contractFile, setContractFile] = useState<File | null>(null);
  // Only meaningful (and only shown) when this staff member is already
  // active - see the checkbox below and POST /api/staff/:id/contract's
  // handling of requireSignature.
  const [requireSignatureOnAttach, setRequireSignatureOnAttach] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const { data: contractDetail } = useQuery<{
    contractStatus: StaffContractStatus;
    contractType?: "file" | "image" | "text";
    contentText?: string;
    altText?: string;
    fileOriginalName?: string;
    signedGetUrl?: string;
    declinedAt?: string;
    declinedReason?: string;
    signature?: { typedFullName: string; signedAt: string; ipAddress: string };
    history?: Array<{
      id: string;
      versionNumber: number;
      contractType: "file" | "image" | "text";
      createdAt: string;
      supersededAt: string | null;
      isCurrent: boolean;
      createdByName?: string;
      contentText?: string | null;
      fileOriginalName?: string | null;
      altText?: string | null;
      signedGetUrl?: string;
    }>;
  }>({
    queryKey: [`/api/staff/${staffId}/contract`],
    enabled: !!staffId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff/${staffId}/contract`);
      return res.json();
    },
  });

  const attachContractMutation = useMutation({
    mutationFn: async () => {
      if (contractType === "text") {
        const res = await apiRequest("POST", `/api/staff/${staffId}/contract`, {
          contractType: "text",
          contentText: contractText.trim(),
          requireSignature: requireSignatureOnAttach,
        });
        return res.json();
      }
      if (!contractFile) throw new Error("Please choose a file to upload.");
      const uploaded = await uploadContractFileToStaging(contractFile);

      const res = await apiRequest("POST", `/api/staff/${staffId}/contract`, {
        contractType,
        ...uploaded,
        ...(contractType === "image" ? { altText: contractAltText.trim() } : {}),
        requireSignature: requireSignatureOnAttach,
      });
      return res.json();
    },
    onSuccess: (data: { contractStatus: StaffContractStatus; requiredSignatureApplied?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/staff/${staffId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/staff/${staffId}/contract`] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });

      // Honest, response-driven messaging - this used to be one hardcoded
      // "will be asked to sign during onboarding" toast regardless of
      // whether that was ever going to happen (it wasn't, for an
      // already-active staff member left unchecked).
      if (data.requiredSignatureApplied) {
        toast({
          title: "Contract attached",
          description: `${staffMember?.name || "The staff member"} will be asked to sign it the next time they log in.`,
        });
      } else if (data.contractStatus === "not_applicable_existing_account") {
        toast({
          title: "Contract saved as a record",
          description: "This staff member already has access, so they won't be prompted to sign it unless you check “Require signature” above.",
        });
      } else {
        toast({ title: "Contract attached", description: "The staff member will be asked to review and sign it during onboarding." });
      }
      setContractType("none");
      setContractText("");
      setContractAltText("");
      setContractFile(null);
      setRequireSignatureOnAttach(false);
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't attach contract", description: getUserFriendlyError(error), variant: "destructive" });
    },
  });

  const { data: customRoles = [] } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: isOwner,
    staleTime: STALE_TIMES.reference,
  });

  const { data: storeSettings } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && isOwner,
    staleTime: STALE_TIMES.reference,
  });
  const storeDefaultCommissionRate = Math.round((storeSettings?.commissionRate ?? 0.30) * 100);
  const storeDefaultBaseAmount = storeSettings?.fixedBaseAmount ?? 30000;

  const form = useForm<any>({
    resolver: zodResolver(localStaffSchema),
    defaultValues: {
      storeId: (currentStore?.id === "all" ? "" : currentStore?.id) || "",
      name: "", email: "", staffNumber: "", countryCode: "NG", mobileNumber: "",
      payPerMonth: 0, signedContract: false, role: "staff", paymentMethod: "hybrid",
      overridePaymentMethod: false, overrideCommission: false,
      commissionTypeOverride: "percentage", commissionFixedAmountOverride: 0,
      overrideFormula: false, commissionFormulaOverride: "formula_b",
      overrideAttendanceRates: false,
      activeDayRateOverride: 1000, passiveDayRateOverride: 500,
      leaveDayRateOverride: 0, payLeaveDaysOverride: false,
      holidayDayRateOverride: 0, payHolidayDaysOverride: false,
      offDayRateOverride: 0, payOffDaysOverride: false,
      commissionRateOverride: null,
    },
  });

  useEffect(() => {
    if (staffMember) {
      let countryCode = staffMember.countryCode || "NG";
      if (countryCode.startsWith("+")) {
        const country = countryCodes.find(c => c.dialCode === countryCode);
        countryCode = country?.code || "NG";
      }
      form.reset({
        storeId: staffMember.storeId,
        name: staffMember.name,
        email: staffMember.email || "",
        staffNumber: staffMember.staffNumber,
        countryCode,
        mobileNumber: staffMember.mobileNumber,
        payPerMonth: staffMember.payPerMonth,
        signedContract: staffMember.signedContract,
        role: staffMember.role || "staff",
        paymentMethod: staffMember.paymentMethod || "hybrid",
        overridePaymentMethod: !!staffMember.overridePaymentMethod,
        overrideCommission: !!staffMember.overrideCommission,
        commissionTypeOverride: staffMember.commissionTypeOverride || "percentage",
        commissionFixedAmountOverride: staffMember.commissionFixedAmountOverride ?? 0,
        overrideFormula: !!staffMember.overrideFormula,
        commissionFormulaOverride: staffMember.commissionFormulaOverride || "formula_b",
        overrideAttendanceRates: !!staffMember.overrideAttendanceRates,
        activeDayRateOverride: staffMember.activeDayRateOverride ?? 1000,
        passiveDayRateOverride: staffMember.passiveDayRateOverride ?? 500,
        leaveDayRateOverride: staffMember.leaveDayRateOverride ?? 0,
        payLeaveDaysOverride: !!staffMember.payLeaveDaysOverride,
        holidayDayRateOverride: staffMember.holidayDayRateOverride ?? 0,
        payHolidayDaysOverride: !!staffMember.payHolidayDaysOverride,
        offDayRateOverride: staffMember.offDayRateOverride ?? 0,
        payOffDaysOverride: !!staffMember.payOffDaysOverride,
        commissionRateOverride: staffMember.commissionRateOverride != null
          ? Math.round(staffMember.commissionRateOverride * 100) : null,
      });
    }
  }, [staffMember, form]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const endpoint = staffId ? `/api/staff/${staffId}` : "/api/staff";
      const method = staffId ? "PATCH" : "POST";
      const res = await apiRequest(method, endpoint, { ...data, storeId: data.storeId || currentStore?.id });
      // The body carries what happened to the invitation, which used to be
      // invisible - a staff member could be created with no invitation ever
      // sent and nothing said about it.
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      if (result?.inviteWarning) {
        // Stay on the page: a warning the user navigates away from is a
        // warning they never read.
        toast({
          title: "Saved, but the invitation wasn't sent",
          description: result.inviteWarning,
          variant: "destructive",
        });
        return;
      }

      const inviteMessage: Record<string, string> = {
        reinvited: "A fresh activation code was emailed to the new address.",
        relinked: "This staff member is now linked to the account for that email address.",
        added_to_existing: "That email already has an account - they've been added to this business.",
        email_changed_verification_sent:
          "We emailed a verification code to the new address. They'll be asked to confirm it next time they sign in.",
        invited: "An invitation has been emailed to them.",
      };
      toast({
        title: `Staff member ${staffId ? "updated" : "created"} successfully`,
        ...(result?.inviteAction && inviteMessage[result.inviteAction]
          ? { description: inviteMessage[result.inviteAction] }
          : {}),
      });
      setLocation(backHref);
    },
    onError: (error: Error) => {
      toast({ title: "Error Saving Staff Member", description: getUserFriendlyError(error, "staff"), variant: "destructive" });
    },
  });

  const [isPreparingContract, setIsPreparingContract] = useState(false);

  const onSubmit = async (data: any) => {
    const validation = validatePhoneNumber(data.mobileNumber, data.countryCode || "NG");
    if (!validation.valid) { form.setError("mobileNumber", { message: validation.error }); return; }
    const payload: any = {
      ...data,
      commissionRateOverride: data.commissionRateOverride != null ? data.commissionRateOverride / 100 : null,
    };

    // The Contract section only offers this inline path on the create form
    // (staffId undefined) - once saved, attaching/replacing goes through its
    // own attachContractMutation instead.
    if (!staffId && contractType === "text" && contractText.trim()) {
      payload.contract = { contractType: "text", contentText: contractText.trim() };
    } else if (!staffId && (contractType === "file" || contractType === "image") && contractFile) {
      try {
        setIsPreparingContract(true);
        const uploaded = await uploadContractFileToStaging(contractFile);
        payload.contract = {
          contractType,
          ...uploaded,
          ...(contractType === "image" ? { altText: contractAltText.trim() } : {}),
        };
      } catch (error) {
        toast({ title: "Couldn't upload contract file", description: getUserFriendlyError(error as Error), variant: "destructive" });
        return;
      } finally {
        setIsPreparingContract(false);
      }
    }
    mutation.mutate(payload);
  };

  if (staffId && isLoadingStaff) {
    return (
      <div className="space-y-3 p-6">
        {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (!currentStore) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please select a store to manage staff.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation(backHref)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Staff
        </Button>
      </div>
    );
  }

  const currencyInfo = getCurrencyByCode(currentStore?.currency || "NGN");
  const nameInitials = form.watch("name")?.slice(0, 2).toUpperCase() || "";
  const watchRole = form.watch("role");
  const roleLabel = watchRole === "manager" ? "Manager" : watchRole === "staff" ? "Staff" : watchRole || "Staff";

  // staffMember.contractStatus (the versioned staff_contracts table) is the
  // source of truth once a staff row exists; signedContract is the
  // deprecated bare checkbox that predates it and is only ever relevant for
  // a record that has never had a real contract attached.
  const contractBadge = (() => {
    const status = staffMember?.contractStatus;
    if (status === "signed") {
      return <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0"><FileCheck className="h-2.5 w-2.5 mr-0.5" />Contract Signed</Badge>;
    }
    if (status === "pending_signature") {
      return <Badge variant="secondary" className="text-[10px]"><FileClock className="h-2.5 w-2.5 mr-0.5" />Awaiting Signature</Badge>;
    }
    if (status === "declined") {
      return <Badge variant="destructive" className="text-[10px]"><FileX className="h-2.5 w-2.5 mr-0.5" />Contract Declined</Badge>;
    }
    if (status === "not_applicable_existing_account") {
      return <Badge variant="outline" className="text-[10px]">No Signature Required</Badge>;
    }
    return form.watch("signedContract")
      ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0"><FileCheck className="h-2.5 w-2.5 mr-0.5" />Contract Signed</Badge>
      : <Badge variant="secondary" className="text-[10px]"><FileX className="h-2.5 w-2.5 mr-0.5" />No Contract</Badge>;
  })();

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Sticky top nav */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation(backHref)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">{staffId ? "Edit Staff Member" : "New Staff Member"}</h1>
          <p className="text-xs text-muted-foreground">{currentStore.name}</p>
        </div>
        <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={mutation.isPending || isPreparingContract} className="shrink-0">
          {isPreparingContract ? "Uploading contract…" : mutation.isPending ? "Saving…" : staffId ? "Save Changes" : "Create Profile"}
        </Button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Identity banner */}
            <Card className="overflow-hidden border-0 shadow-sm">
              <div className="h-20 bg-gradient-to-r from-violet-500/20 via-purple-500/10 to-transparent" />
              <CardContent className="-mt-10 pb-5 px-5">
                <div className="flex items-end gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-violet-500/10 border-4 border-background flex items-center justify-center shadow-sm">
                    {nameInitials
                      ? <span className="text-lg font-bold text-violet-600 dark:text-violet-400">{nameInitials}</span>
                      : <User className="h-7 w-7 text-muted-foreground" />
                    }
                  </div>
                  <div className="pb-1">
                    <p className="font-semibold text-sm leading-tight">
                      {form.watch("name") || (staffId ? "Staff Member" : "New Employee")}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{roleLabel}</Badge>
                      {contractBadge}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Branch selector */}
            {currentStore?.id === "all" && !staffId && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <SectionHeader icon={<Briefcase className="h-3.5 w-3.5" />} label="Branch" />
                  <FormField control={form.control} name="storeId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Store Location</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="Select a branch..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {stores.filter(s => s.id !== "all" && s.isActive !== false).map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {/* Personal Info */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                <SectionHeader icon={<User className="h-3.5 w-3.5" />} label="Personal Information" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Full Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="e.g. Jane Adeyemi" className="h-11" autoFocus {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5"><Mail className="h-3 w-3" />Email <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input type="email" placeholder="jane@example.com" className="h-11" {...field} /></FormControl>
                      <FormDescription className="text-xs">
                        {!staffId
                          ? "Used for login & notifications. We'll email them an activation code."
                          : staffMember?.inviteStatus === "active"
                            ? "This is their login email. Changing it means they'll have to confirm the new address before signing in again."
                            : "Used for login & notifications. Correcting a typo here re-sends their activation code to the new address."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="staffNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5"><Hash className="h-3 w-3" />Staff ID <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                      <FormControl><Input placeholder="e.g. STF-001" className="h-11 font-mono" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

            {/* Contact */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                <SectionHeader icon={<Phone className="h-3.5 w-3.5" />} label="Contact" />

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <FormField control={form.control} name="countryCode" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "NG"}>
                        <FormControl><SelectTrigger className="h-11"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent className="max-h-[280px]">
                          {countryCodes.map((c) => (
                            <SelectItem key={c.code} value={c.code}>{c.name} ({c.dialCode})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="mobileNumber" render={({ field }) => (
                    <FormItem className="sm:col-span-3">
                      <FormLabel>Mobile Number <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input placeholder="8012345678" className="h-11" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </CardContent>
            </Card>

            {/* Employment (owners only) */}
            {isOwner && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <SectionHeader icon={<Briefcase className="h-3.5 w-3.5" />} label="Employment" />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5"><Shield className="h-3 w-3" />Access Role</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "staff"}>
                          <FormControl><SelectTrigger className="h-11"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="staff">Staff — Sales Access Only</SelectItem>
                            <SelectItem value="manager">Manager — Full Store Access</SelectItem>
                            {customRoles.map((r: any) => (
                              <SelectItem key={r.id} value={r.name.toLowerCase()}>{r.name} (Custom)</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Model</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "hybrid"}>
                          <FormControl><SelectTrigger className="h-11"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="hybrid">Hybrid (Base + Commission)</SelectItem>
                            <SelectItem value="fixed">Fixed Salary</SelectItem>
                            <SelectItem value="commission">Commission Only</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Base salary info / override hint */}
                  {!form.watch("overridePaymentMethod") ? (
                    <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground mb-0.5">Base Salary</p>
                      Store default: <strong>{currencyInfo?.symbol || "₦"}{Number(storeDefaultBaseAmount).toLocaleString()}/month</strong>
                      <span className="ml-1">— enable override below to set a custom amount.</span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
                      Base salary is configured in the Override section below.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Contract */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-4">
                <SectionHeader icon={<FileCheck className="h-3.5 w-3.5" />} label="Employment Contract" />

                {staffMember?.contractStatus === "signed" ? (
                  <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
                    <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-1.5">
                      <FileCheck className="h-3.5 w-3.5" /> Signed by {contractDetail?.signature?.typedFullName}
                    </p>
                    {contractDetail?.signature?.signedAt && (
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(contractDetail.signature.signedAt).toLocaleString()} · IP {contractDetail.signature.ipAddress}
                      </p>
                    )}
                    {contractDetail?.signedGetUrl && (
                      <a href={contractDetail.signedGetUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline block">
                        View {contractDetail.fileOriginalName || "signed document"}
                      </a>
                    )}
                    {contractDetail?.contractType === "text" && contractDetail.contentText && (
                      <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground bg-background/60 rounded p-2 max-h-32 overflow-y-auto">{contractDetail.contentText}</pre>
                    )}
                    <p className="text-[11px] text-muted-foreground">Amending a signed contract isn't supported yet.</p>
                  </div>
                ) : (
                  <>
                    {staffMember?.contractStatus === "declined" && (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
                        <p className="font-medium">This staff member declined to sign.</p>
                        {contractDetail?.declinedReason && <p>Reason given: {contractDetail.declinedReason}</p>}
                        <p className="text-muted-foreground">Attaching a new contract below will let them try again.</p>
                      </div>
                    )}
                    {staffMember?.contractStatus === "pending_signature" && (
                      <p className="text-xs text-muted-foreground">
                        Awaiting the staff member's signature. Attaching a new contract below replaces this one before they've signed.
                      </p>
                    )}
                    {!staffId && (
                      <p className="text-xs text-muted-foreground">
                        Optional — attach now for the staff member to review and sign during onboarding (after they set their password).
                      </p>
                    )}

                    <RadioGroup
                      value={contractType}
                      onValueChange={(v) => setContractType(v as typeof contractType)}
                      className="flex flex-wrap gap-3"
                    >
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="none" id="contract-none" />
                        <label htmlFor="contract-none" className="text-xs cursor-pointer">None for now</label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="text" id="contract-text" />
                        <label htmlFor="contract-text" className="text-xs cursor-pointer">Type contract text</label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="file" id="contract-file" />
                        <label htmlFor="contract-file" className="text-xs cursor-pointer">Upload file (PDF)</label>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <RadioGroupItem value="image" id="contract-image" />
                        <label htmlFor="contract-image" className="text-xs cursor-pointer">Upload image</label>
                      </div>
                    </RadioGroup>

                    {contractType === "text" && (
                      <Textarea
                        placeholder="Paste or type the full contract text..."
                        className="min-h-32 text-sm"
                        value={contractText}
                        onChange={(e) => setContractText(e.target.value)}
                      />
                    )}

                    {(contractType === "file" || contractType === "image") && (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs border rounded-lg p-3 cursor-pointer hover:bg-muted/30">
                          <Upload className="h-4 w-4 text-muted-foreground" />
                          {contractFile ? contractFile.name : `Choose ${contractType === "image" ? "an image" : "a PDF"}...`}
                          <input
                            type="file"
                            className="hidden"
                            accept={contractType === "image" ? "image/png,image/jpeg,image/webp" : "application/pdf"}
                            onChange={(e) => setContractFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        {contractType === "image" && (
                          <Input
                            placeholder="Describe the image for accessibility (required)"
                            value={contractAltText}
                            onChange={(e) => setContractAltText(e.target.value)}
                            className="text-xs h-9"
                          />
                        )}
                      </div>
                    )}

                    {staffId && contractType !== "none" && staffMember?.inviteStatus === "active" && (
                      <div className="flex items-start space-x-2 rounded-lg border p-2.5 bg-muted/20">
                        <Checkbox
                          id="require-signature-on-attach"
                          checked={requireSignatureOnAttach}
                          onCheckedChange={(checked) => setRequireSignatureOnAttach(!!checked)}
                        />
                        <label htmlFor="require-signature-on-attach" className="text-xs cursor-pointer leading-relaxed">
                          Require <strong>{staffMember?.name || "this staff member"}</strong> to sign this before their next login.
                          Their current session is unaffected — this only takes effect the next time they log in.
                        </label>
                      </div>
                    )}

                    {staffId && contractType !== "none" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          attachContractMutation.isPending ||
                          (contractType === "text" && !contractText.trim()) ||
                          ((contractType === "file" || contractType === "image") && !contractFile) ||
                          (contractType === "image" && !contractAltText.trim())
                        }
                        onClick={() => attachContractMutation.mutate()}
                      >
                        {attachContractMutation.isPending ? "Attaching…" : "Attach Contract"}
                      </Button>
                    )}
                  </>
                )}

                {!!contractDetail?.history && contractDetail.history.length > 1 && (
                  <div className="pt-3 border-t">
                    <button
                      type="button"
                      onClick={() => setIsHistoryOpen((open) => !open)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      {isHistoryOpen ? "Hide" : "View"} history ({contractDetail.history.length} versions)
                    </button>
                    {isHistoryOpen && (
                      <div className="mt-2 space-y-2">
                        {contractDetail.history.map((v) => (
                          <div key={v.id} className="rounded-lg border p-2.5 text-[11px] space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-medium capitalize">v{v.versionNumber} · {v.contractType}</span>
                              <Badge variant={v.isCurrent ? "default" : "secondary"} className="text-[9px]">
                                {v.isCurrent ? "Current" : "Superseded"}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground">
                              {new Date(v.createdAt).toLocaleString()}
                              {v.createdByName ? ` · attached by ${v.createdByName}` : ""}
                              {v.supersededAt ? ` · replaced ${new Date(v.supersededAt).toLocaleDateString()}` : ""}
                            </p>
                            {v.contractType === "text" && v.contentText && (
                              <pre className="whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-24 overflow-y-auto">{v.contentText}</pre>
                            )}
                            {v.signedGetUrl && (
                              <a href={v.signedGetUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline block">
                                View {v.fileOriginalName || "document"}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Override section — owners only */}
            {isOwner && (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <SectionHeader icon={<Settings2 className="h-3.5 w-3.5" />} label="Roster & Compensation Overrides" />
                  <p className="text-xs text-muted-foreground -mt-2">
                    Per-employee overrides that bypass store-wide defaults. Toggle only what you need to customise.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { name: "overridePaymentMethod", label: "Payment Method & Salary", desc: "Customise pay type or base salary" },
                      { name: "overrideFormula", label: "Commission Formula", desc: "Custom calculation model" },
                      { name: "overrideCommission", label: "Commission Rates", desc: "Override split % and flat amounts" },
                      { name: "overrideAttendanceRates", label: "Attendance Rates", desc: "Custom daily transport & leave pay" },
                    ].map(({ name, label, desc }) => (
                      <FormField key={name} control={form.control} name={name} render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-xl border p-3 bg-muted/10 hover:bg-muted/20 transition-colors">
                          <div className="pr-2">
                            <FormLabel className="text-xs font-semibold cursor-pointer">{label}</FormLabel>
                            <FormDescription className="text-[10px] leading-tight">{desc}</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )} />
                    ))}
                  </div>

                  {/* Payment Method Override */}
                  {form.watch("overridePaymentMethod") && (
                    <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-none">
                      <CardContent className="p-3.5 space-y-3">
                        <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Payment Method &amp; Base Salary</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] font-semibold">Model Override</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || "hybrid"}>
                                <FormControl><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="hybrid">Hybrid (Base + Attendance + Commission)</SelectItem>
                                  <SelectItem value="fixed">Fixed Salary (Flat Monthly Only)</SelectItem>
                                  <SelectItem value="commission">Commission Only</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="payPerMonth" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] font-semibold">Base Salary Override ({currencyInfo?.symbol || "₦"})</FormLabel>
                              <FormControl>
                                <Input type="number" className="h-8 text-xs font-mono"
                                  disabled={form.watch("paymentMethod") === "commission"}
                                  {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                              </FormControl>
                            </FormItem>
                          )} />
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Formula Override */}
                  {form.watch("overrideFormula") && (
                    <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-none">
                      <CardContent className="p-3.5 space-y-2">
                        <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Commission Formula</p>
                        <FormField control={form.control} name="commissionFormulaOverride" render={({ field }) => (
                          <FormItem>
                            <Select onValueChange={field.onChange} value={field.value || "formula_b"}>
                              <FormControl><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="formula_b">Formula B — Active &amp; Passive Split Deduction (Recommended)</SelectItem>
                                <SelectItem value="formula_a">Formula A — Single Rate Present Day Deduction</SelectItem>
                                <SelectItem value="formula_c">Formula C — Full Split + Leave &amp; Holiday Deduction</SelectItem>
                                <SelectItem value="formula_d">Formula D — Pure Commission</SelectItem>
                                <SelectItem value="formula_f">Formula F — Fixed Amount Per Service</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Commission Rates Override */}
                  {form.watch("overrideCommission") && (
                    <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-none">
                      <CardContent className="p-3.5 space-y-3">
                        <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Commission Payout Model</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField control={form.control} name="commissionTypeOverride" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] font-semibold">Commission Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || "percentage"}>
                                <FormControl><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="percentage">Percentage Split</SelectItem>
                                  <SelectItem value="fixed_per_service">Fixed Flat Rate Per Service</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="commissionRateOverride" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] font-semibold">Rate Override (%)</FormLabel>
                              <FormDescription className="text-[9px]">Blank = store default ({storeDefaultCommissionRate}%)</FormDescription>
                              <FormControl>
                                <Input type="number" min={0} max={100} className="h-8 text-xs font-mono"
                                  placeholder={`${storeDefaultCommissionRate}%`}
                                  {...field} value={field.value ?? ""}
                                  onChange={e => field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))} />
                              </FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="commissionFixedAmountOverride" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] font-semibold">Flat Amount ({currencyInfo?.symbol || "₦"})</FormLabel>
                              <FormControl>
                                <Input type="number" className="h-8 text-xs font-mono"
                                  disabled={form.watch("commissionTypeOverride") !== "fixed_per_service" && form.watch("commissionFormulaOverride") !== "formula_f"}
                                  {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                              </FormControl>
                            </FormItem>
                          )} />
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Attendance Rates Override */}
                  {form.watch("overrideAttendanceRates") && (
                    <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-none">
                      <CardContent className="p-3.5 space-y-3">
                        <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Roster &amp; Transport Daily Rates</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            { name: "activeDayRateOverride", label: "Active Day Transport (₦)" },
                            { name: "passiveDayRateOverride", label: "Passive Day Transport (₦)" },
                          ].map(({ name, label }) => (
                            <FormField key={name} control={form.control} name={name} render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] font-semibold">{label}</FormLabel>
                                <FormControl>
                                  <Input type="number" className="h-8 text-xs font-mono" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                </FormControl>
                              </FormItem>
                            )} />
                          ))}
                        </div>

                        <Separator className="my-1" />

                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            { toggle: "payLeaveDaysOverride", rate: "leaveDayRateOverride", label: "Paid Leaves" },
                            { toggle: "payHolidayDaysOverride", rate: "holidayDayRateOverride", label: "Paid Holidays" },
                            { toggle: "payOffDaysOverride", rate: "offDayRateOverride", label: "Paid Sundays" },
                          ].map(({ toggle, rate, label }) => (
                            <div key={toggle} className="p-2.5 border rounded-xl bg-background/50 space-y-2">
                              <FormField control={form.control} name={toggle} render={({ field }) => (
                                <FormItem className="flex items-center justify-between space-y-0">
                                  <FormLabel className="text-[11px] font-semibold cursor-pointer">{label}</FormLabel>
                                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} className="scale-75" /></FormControl>
                                </FormItem>
                              )} />
                              <FormField control={form.control} name={rate} render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[9px] text-muted-foreground">Daily Rate (₦)</FormLabel>
                                  <FormControl>
                                    <Input type="number" disabled={!form.watch(toggle)} className="h-7 text-xs font-mono p-1"
                                      {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                  </FormControl>
                                </FormItem>
                              )} />
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Customer Profile Link — only shown when editing an existing staff member */}
            {staffId && (
              <Card className="border-0 shadow-sm">
                <CardContent className="pt-5 pb-5 px-5 space-y-3">
                  <SectionHeader icon={<UserCheck className="h-3.5 w-3.5" />} label="Customer Profile" />
                  <p className="text-xs text-muted-foreground">
                    Link a customer profile so purchases made by this staff member are tracked as staff sales.
                  </p>
                  {isLoadingCustomer ? (
                    <div className="h-14 rounded-lg bg-muted animate-pulse" />
                  ) : linkedCustomer ? (
                    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                          <UserCheck className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                        </div>
                        <div>
                          <p className="text-sm font-medium leading-none">{linkedCustomer.name}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {linkedCustomer.customerNumber}{linkedCustomer.mobileNumber ? ` • ${linkedCustomer.mobileNumber}` : ""}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive gap-1.5"
                        disabled={unlinkCustomerMutation.isPending}
                        onClick={() => unlinkCustomerMutation.mutate()}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        Unlink
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setIsLinkDialogOpen(true)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Link Existing Customer
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={linkCustomerMutation.isPending}
                        onClick={() => linkCustomerMutation.mutate({ createNew: true })}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Create & Link
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Bottom actions */}
            <div className="flex gap-3 pt-2 pb-8">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setLocation(backHref)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending || isPreparingContract}>
                {isPreparingContract ? "Uploading contract…" : mutation.isPending ? "Saving…" : staffId ? "Save Changes" : "Create Profile"}
              </Button>
            </div>
          </form>
        </Form>
      </div>

      {/* Link Customer Dialog */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Customer Profile</DialogTitle>
            <DialogDescription>
              Search for an existing customer to link to this staff member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Search by name or phone…"
              value={customerSearchQuery}
              onChange={(e) => { setCustomerSearchQuery(e.target.value); setSelectedLinkCustomerId(""); }}
              autoFocus
            />
            {customerSearchQuery.trim().length >= 2 && (
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                {customerSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No customers found</p>
                ) : (
                  customerSearchResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors ${selectedLinkCustomerId === c.id ? "bg-muted" : ""}`}
                      onClick={() => setSelectedLinkCustomerId(c.id)}
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {c.customerNumber}{c.mobileNumber ? ` • ${c.mobileNumber}` : ""}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsLinkDialogOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={!selectedLinkCustomerId || linkCustomerMutation.isPending}
              onClick={() => linkCustomerMutation.mutate({ customerId: selectedLinkCustomerId })}
            >
              {linkCustomerMutation.isPending ? "Linking…" : "Link Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {icon}{label}
    </div>
  );
}
