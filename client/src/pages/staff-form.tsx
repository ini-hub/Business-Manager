import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Mail, Shield, Phone, Hash, FileCheck, FileX } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
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

// Local schema to avoid dependency issues during render
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
});

export default function StaffFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  // If ID is literal "new", treat as undefined
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

  const form = useForm<any>({
    resolver: zodResolver(localStaffSchema),
    defaultValues: {
      storeId: (currentStore?.id === "all" ? "" : currentStore?.id) || "",
      name: "",
      email: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
      role: "staff",
      paymentMethod: "hybrid",
      
      overridePaymentMethod: false,
      overrideCommission: false,
      commissionTypeOverride: "percentage",
      commissionFixedAmountOverride: 0,
      overrideFormula: false,
      commissionFormulaOverride: "formula_b",
      overrideAttendanceRates: false,
      activeDayRateOverride: 1000,
      passiveDayRateOverride: 500,
      leaveDayRateOverride: 0,
      payLeaveDaysOverride: false,
      holidayDayRateOverride: 0,
      payHolidayDaysOverride: false,
      offDayRateOverride: 0,
      payOffDaysOverride: false,
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
      toast({ 
        title: "Error Saving Staff Member", 
        description: getUserFriendlyError(error, "staff"), 
        variant: "destructive" 
      });
    },
  });

  const onSubmit = (data: any) => {
    const countryCode = data.countryCode || "NG";
    const validation = validatePhoneNumber(data.mobileNumber, countryCode);
    if (!validation.valid) {
      form.setError("mobileNumber", { message: validation.error });
      return;
    }
    mutation.mutate(data);
  };

  if (staffId && isLoadingStaff) {
    return <div className="flex items-center justify-center min-h-[400px]">Loading...</div>;
  }

  if (!currentStore) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Staff Management" description="Please select a store to manage staff." />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/staff")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to List
        </Button>
      </div>
    );
  }

  const storeCurrency = currentStore?.currency || "NGN";
  const currencyInfo = getCurrencyByCode(storeCurrency);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/staff")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader 
          title={staffId ? "Edit Staff Member" : "Add New Staff Member"} 
          description={staffId ? `Updating details for ${staffMember?.name}` : "Create a new profile for your employee"}
        />
      </div>

      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Staff Details</CardTitle>
            <CardDescription>Enter the basic information and employment terms.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {currentStore?.id === "all" && !staffId && (
                  <FormField
                    control={form.control}
                    name="storeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Store Location</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a branch..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {stores.filter(s => s.id !== "all").map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid gap-6 md:grid-cols-2">

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Jane Smith" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="jane@example.com" {...field} />
                        </FormControl>
                        <FormDescription>Used for account login and notifications.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  {isOwner && (
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Access Role</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "staff"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="staff">Staff (Sales Access Only)</SelectItem>
                              <SelectItem value="manager">Manager (Full Store Access)</SelectItem>
                              {customRoles.map((role: any) => (
                                <SelectItem key={role.id} value={role.name.toLowerCase()}>
                                  {role.name} (Custom Role)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {isOwner && (
                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Model</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "hybrid"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select model" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="hybrid">Hybrid (Base + Commission)</SelectItem>
                              <SelectItem value="fixed">Fixed (Monthly Salary)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="countryCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "NG"}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-[300px]">
                            {countryCodes.map((country) => (
                              <SelectItem key={country.code} value={country.code}>
                                {country.name} ({country.dialCode})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mobileNumber"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Mobile Number</FormLabel>
                        <FormControl>
                          <Input placeholder="8012345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isOwner && (
                  <div className="grid gap-6 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="payPerMonth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Monthly Salary / Base Pay ({currencyInfo?.symbol || "₦"})</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="staffNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Staff ID / Employee Number</FormLabel>
                          <FormControl>
                            <Input placeholder="E.g. STF-001" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {isOwner && (
                  <>
                    <Separator className="my-6" />
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-base font-bold text-indigo-900 dark:text-indigo-200">Roster & Compensation Overrides</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Toggle and configure employee-level overrides that bypass store-wide default policies.</p>
                      </div>

                      {/* Overrides Controls Grid */}
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Override Payment Method */}
                        <FormField
                          control={form.control}
                          name="overridePaymentMethod"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-muted/10">
                              <div className="space-y-0.5 pr-2">
                                <FormLabel className="text-xs font-semibold cursor-pointer">Override Payment Method & Salary</FormLabel>
                                <FormDescription className="text-[9px] leading-tight">Customize payment type or base salary for this profile</FormDescription>
                              </div>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Override Formula */}
                        <FormField
                          control={form.control}
                          name="overrideFormula"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-muted/10">
                              <div className="space-y-0.5 pr-2">
                                <FormLabel className="text-xs font-semibold cursor-pointer">Override Commission Formula</FormLabel>
                                <FormDescription className="text-[9px] leading-tight">Select a custom calculation model for this profile</FormDescription>
                              </div>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Override Commission Rates */}
                        <FormField
                          control={form.control}
                          name="overrideCommission"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-muted/10">
                              <div className="space-y-0.5 pr-2">
                                <FormLabel className="text-xs font-semibold cursor-pointer">Override Commission Rates</FormLabel>
                                <FormDescription className="text-[9px] leading-tight">Bypass default store split percentages and values</FormDescription>
                              </div>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Override Attendance Rates */}
                        <FormField
                          control={form.control}
                          name="overrideAttendanceRates"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-muted/10">
                              <div className="space-y-0.5 pr-2">
                                <FormLabel className="text-xs font-semibold cursor-pointer">Override Attendance Rates</FormLabel>
                                <FormDescription className="text-[9px] leading-tight">Set custom daily transport rates and paid leaves</FormDescription>
                              </div>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Payment Method Override Fields */}
                      {form.watch("overridePaymentMethod") && (
                        <Card className="p-3.5 border-indigo-100 bg-indigo-50/5 space-y-3 shadow-sm">
                          <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Payment Method & Base Salary</h4>
                          <div className="grid gap-4 md:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="paymentMethod"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Payment Model Override</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value || "hybrid"}>
                                    <FormControl>
                                      <SelectTrigger className="h-8 text-xs font-medium">
                                        <SelectValue placeholder="Select method" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="hybrid">Hybrid (Fixed Base + Attendance + Commission)</SelectItem>
                                      <SelectItem value="fixed">Fixed Salary (Flat Monthly Base Only)</SelectItem>
                                      <SelectItem value="commission">Commission Only (Attendance + Commission)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="payPerMonth"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Base Monthly Salary Override (₦)</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      className="h-8 text-xs font-mono"
                                      disabled={form.watch("paymentMethod") === "commission"}
                                      {...field}
                                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </Card>
                      )}

                      {/* Formula Override Fields */}
                      {form.watch("overrideFormula") && (
                        <Card className="p-3.5 border-indigo-100 bg-indigo-50/5 space-y-3 shadow-sm">
                          <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Calculation Formula Override</h4>
                          <FormField
                            control={form.control}
                            name="commissionFormulaOverride"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] font-semibold">Formula Override</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || "formula_b"}>
                                  <FormControl>
                                    <SelectTrigger className="h-8 text-xs font-medium">
                                      <SelectValue placeholder="Select formula" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="formula_b">Formula B: Active & Passive Split Deduction (Recommended)</SelectItem>
                                    <SelectItem value="formula_a">Formula A: Single Rate Present Day Deduction</SelectItem>
                                    <SelectItem value="formula_c">Formula C: Full Split + Paid Leave & Holidays Deduction</SelectItem>
                                    <SelectItem value="formula_d">Formula D: Pure Commission (No Attendance Deductions)</SelectItem>
                                    <SelectItem value="formula_f">Formula F: Fixed Commission Amount Per Worked Service</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                        </Card>
                      )}

                      {/* Commission Override Fields */}
                      {form.watch("overrideCommission") && (
                        <Card className="p-3.5 border-indigo-100 bg-indigo-50/5 space-y-3 shadow-sm">
                          <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Commission Payout Model</h4>
                          <div className="grid gap-4 md:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="commissionTypeOverride"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Commission Type Override</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value || "percentage"}>
                                    <FormControl>
                                      <SelectTrigger className="h-8 text-xs font-medium">
                                        <SelectValue placeholder="Select model" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="percentage">Percentage Split (Based on service value)</SelectItem>
                                      <SelectItem value="fixed_per_service">Fixed Flat Rate Per Service Worked (Formula F only)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="commissionFixedAmountOverride"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Flat Commission Amount Override (₦)</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      className="h-8 text-xs font-mono"
                                      disabled={form.watch("commissionTypeOverride") !== "fixed_per_service" && form.watch("commissionFormulaOverride") !== "formula_f"}
                                      {...field}
                                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </Card>
                      )}

                      {/* Attendance Override Fields */}
                      {form.watch("overrideAttendanceRates") && (
                        <Card className="p-3.5 border-indigo-100 bg-indigo-50/5 space-y-3 shadow-sm">
                          <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Custom Roster & Transport Daily Rates</h4>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <FormField
                              control={form.control}
                              name="activeDayRateOverride"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Active Day Transport Override (₦)</FormLabel>
                                  <FormControl>
                                    <Input type="number" className="h-8 text-xs font-mono" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="passiveDayRateOverride"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-[10px] font-semibold">Passive Day Transport Override (₦)</FormLabel>
                                  <FormControl>
                                    <Input type="number" className="h-8 text-xs font-mono" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>

                          <Separator className="my-1.5" />

                          <div className="grid gap-3 sm:grid-cols-3">
                            {/* Paid Leaves Override */}
                            <div className="p-2.5 border rounded-lg bg-background/50 space-y-2">
                              <FormField
                                control={form.control}
                                name="payLeaveDaysOverride"
                                render={({ field }) => (
                                  <FormItem className="flex items-center justify-between space-y-0">
                                    <FormLabel className="text-[11px] font-semibold cursor-pointer">Paid Leaves</FormLabel>
                                    <FormControl>
                                      <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-75" />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="leaveDayRateOverride"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-[9px] text-muted-foreground font-medium">Daily Rate Override (₦)</FormLabel>
                                    <FormControl>
                                      <Input type="number" disabled={!form.watch("payLeaveDaysOverride")} className="h-7 text-xs font-mono p-1" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>

                            {/* Paid Holidays Override */}
                            <div className="p-2.5 border rounded-lg bg-background/50 space-y-2">
                              <FormField
                                control={form.control}
                                name="payHolidayDaysOverride"
                                render={({ field }) => (
                                  <FormItem className="flex items-center justify-between space-y-0">
                                    <FormLabel className="text-[11px] font-semibold cursor-pointer">Paid Holidays</FormLabel>
                                    <FormControl>
                                      <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-75" />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="holidayDayRateOverride"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-[9px] text-muted-foreground font-medium">Daily Rate Override (₦)</FormLabel>
                                    <FormControl>
                                      <Input type="number" disabled={!form.watch("payHolidayDaysOverride")} className="h-7 text-xs font-mono p-1" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>

                            {/* Paid Sundays/Off Days Override */}
                            <div className="p-2.5 border rounded-lg bg-background/50 space-y-2">
                              <FormField
                                control={form.control}
                                name="payOffDaysOverride"
                                render={({ field }) => (
                                  <FormItem className="flex items-center justify-between space-y-0">
                                    <FormLabel className="text-[11px] font-semibold cursor-pointer">Paid Sundays</FormLabel>
                                    <FormControl>
                                      <Switch checked={field.value} onCheckedChange={field.onChange} className="scale-75" />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="offDayRateOverride"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-[9px] text-muted-foreground font-medium">Daily Rate Override (₦)</FormLabel>
                                    <FormControl>
                                      <Input type="number" disabled={!form.watch("payOffDaysOverride")} className="h-7 text-xs font-mono p-1" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        </Card>
                      )}
                    </div>
                  </>
                )}

                <Separator />

                <FormField
                  control={form.control}
                  name="signedContract"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Employment Contract</FormLabel>
                        <FormDescription>
                          Has the staff member signed their official contract?
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setLocation("/staff")}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={mutation.isPending} className="min-w-[120px]">
                    {mutation.isPending ? "Saving..." : staffId ? "Update Profile" : "Create Profile"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
