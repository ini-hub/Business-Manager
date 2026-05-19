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
});

export default function StaffFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
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
      storeId: currentStore?.id || "",
      name: "",
      email: "",
      staffNumber: "",
      countryCode: "NG",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
      role: "staff",
      paymentMethod: "hybrid",
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
      });
    }
  }, [staffMember, form]);

  const mutation = useMutation({
    mutationFn: (data: any) => {
      const endpoint = staffId ? `/api/staff/${staffId}` : "/api/staff";
      const method = staffId ? "PATCH" : "POST";
      return apiRequest(method, endpoint, { ...data, storeId: currentStore?.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff", currentStore?.id] });
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
                                {country.name} (+{country.dialCode})
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
