import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Mail, Shield, Phone, Hash, FileCheck, FileX, User, Briefcase, Settings2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema, type Staff } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { countryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getCurrencyByCode } from "@/lib/currency-utils";
import { z } from "zod";
import { useEffect } from "react";

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
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const staffId = id === "new" ? undefined : id;

  const { data: staffMember, isLoading: isLoadingStaff } = useQuery<Staff>({
    queryKey: [`/api/staff/${staffId}`],
    enabled: !!staffId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff/${staffId}`);
      if (!res.ok) throw new Error("Staff member not found");
      return res.json();
    },
  });

  const { data: customRoles = [] } = useQuery<any[]>({
    queryKey: ["/api/custom-roles"],
    enabled: isOwner,
  });

  const { data: storeSettings } = useQuery<any>({
    queryKey: ["/api/settings", currentStore?.id],
    enabled: !!currentStore?.id && isOwner,
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
    mutationFn: (data: any) => {
      const endpoint = staffId ? `/api/staff/${staffId}` : "/api/staff";
      const method = staffId ? "PATCH" : "POST";
      return apiRequest(method, endpoint, { ...data, storeId: data.storeId || currentStore?.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: `Staff member ${staffId ? "updated" : "created"} successfully` });
      setLocation("/staff");
    },
    onError: (error: Error) => {
      toast({ title: "Error Saving Staff Member", description: getUserFriendlyError(error, "staff"), variant: "destructive" });
    },
  });

  const onSubmit = (data: any) => {
    const validation = validatePhoneNumber(data.mobileNumber, data.countryCode || "NG");
    if (!validation.valid) { form.setError("mobileNumber", { message: validation.error }); return; }
    const payload = {
      ...data,
      commissionRateOverride: data.commissionRateOverride != null ? data.commissionRateOverride / 100 : null,
    };
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
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/staff")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Staff
        </Button>
      </div>
    );
  }

  const currencyInfo = getCurrencyByCode(currentStore?.currency || "NGN");
  const nameInitials = form.watch("name")?.slice(0, 2).toUpperCase() || "";
  const watchRole = form.watch("role");
  const roleLabel = watchRole === "manager" ? "Manager" : watchRole === "staff" ? "Staff" : watchRole || "Staff";

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Sticky top nav */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/staff")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">{staffId ? "Edit Staff Member" : "New Staff Member"}</h1>
          <p className="text-xs text-muted-foreground">{currentStore.name}</p>
        </div>
        <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={mutation.isPending} className="shrink-0">
          {mutation.isPending ? "Saving…" : staffId ? "Save Changes" : "Create Profile"}
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
                      {form.watch("signedContract")
                        ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0"><FileCheck className="h-2.5 w-2.5 mr-0.5" />Contract Signed</Badge>
                        : <Badge variant="secondary" className="text-[10px]"><FileX className="h-2.5 w-2.5 mr-0.5" />Pending Contract</Badge>
                      }
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
                          {stores.filter(s => s.id !== "all").map((s) => (
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
                      <FormDescription className="text-xs">Used for login &amp; notifications.</FormDescription>
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

                <div className="grid grid-cols-5 gap-3">
                  <FormField control={form.control} name="countryCode" render={({ field }) => (
                    <FormItem className="col-span-2">
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
                    <FormItem className="col-span-3">
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
              <CardContent className="p-4">
                <FormField control={form.control} name="signedContract" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div>
                      <FormLabel className="text-sm font-medium flex items-center gap-2">
                        <FileCheck className="h-4 w-4 text-emerald-600" />
                        Employment Contract Signed
                      </FormLabel>
                      <FormDescription className="text-xs mt-0.5">
                        Toggle on once the staff member has signed their official contract.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
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

            {/* Bottom actions */}
            <div className="flex gap-3 pt-2 pb-8">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setLocation("/staff")}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : staffId ? "Save Changes" : "Create Profile"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
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
