import { useLocation } from "wouter";
import { ArrowLeft, Building2, MapPin, Phone, Globe, Coins, ShieldCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { useStore } from "@/lib/store-context";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";

const businessFormSchema = z.object({
  name: z.string().min(1, "Business name is required").max(200, "Name is too long"),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  phoneCountryCode: z.string().default("+234"),
  logoUrl: z.string().optional().default(""),
  businessUrl: z.string().optional().default(""),
  commissionSplitBusinessShare: z.number().min(0).max(100).default(80),
  commissionSplitStaffShare: z.number().min(0).max(100).default(20),
}).refine(data => data.commissionSplitBusinessShare + data.commissionSplitStaffShare === 100, {
  message: "Commission split percentages must sum to exactly 100%",
  path: ["commissionSplitStaffShare"]
});

export default function BusinessFormPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { business, createBusiness, updateBusiness, isLoading } = useStore();
  const isOwner = user?.role === "owner";

  const form = useForm<z.infer<typeof businessFormSchema>>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      name: "",
      address: "",
      phone: "",
      phoneCountryCode: "+234",
      logoUrl: "",
      businessUrl: "",
      commissionSplitBusinessShare: 80,
      commissionSplitStaffShare: 20,
    },
  });

  useEffect(() => {
    if (business) {
      form.reset({
        name: business.name || "",
        address: (business as any).address || "",
        phone: (business as any).phone || "",
        phoneCountryCode: (business as any).phoneCountryCode || "+234",
        logoUrl: (business as any).logoUrl || "",
        businessUrl: (business as any).businessUrl || "",
        commissionSplitBusinessShare: (business as any).commissionSplitBusinessShare ?? 80,
        commissionSplitStaffShare: (business as any).commissionSplitStaffShare ?? 20,
      });
    }
  }, [business, form]);

  const onSubmit = async (values: z.infer<typeof businessFormSchema>) => {
    if (values.phone) {
      const phoneCheck = validatePhoneNumber(values.phone, values.phoneCountryCode);
      if (!phoneCheck.valid) {
        form.setError("phone", { message: phoneCheck.error });
        return;
      }
    }
    try {
      if (business) {
        await updateBusiness(business.id, values);
        toast({ title: "Business updated successfully" });
      } else {
        await createBusiness(values);
        toast({ title: "Business created successfully" });
      }
      setLocation("/settings/stores");
    } catch (error) {
      toast({
        title: "Error Saving Business",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]">Loading...</div>;
  }

  if (!isOwner) {
    return (
      <div className="p-8 text-center">
        <PageHeader title="Business Configuration" description="Only owners can manage business settings." />
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/settings/stores")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/settings/stores")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader 
          title={business ? "Edit Business Profile" : "Set Up Business"} 
          description={business ? `Updating parameters for ${business?.name}` : "Configure the high-level corporate entity"}
        />
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="border border-muted/80 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Corporate Identity
            </CardTitle>
            <CardDescription>
              This represents your primary brand settings, dynamic splits, and details across all store franchises.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="flex flex-col items-center gap-4 mb-4 bg-muted/20 p-4 rounded-lg border border-dashed">
                  <Avatar className="h-20 w-20 border-2">
                    <AvatarImage src={form.watch("logoUrl") || ""} />
                    <AvatarFallback className="bg-primary/10">
                      <Building2 className="h-10 w-10 text-primary/40" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="w-full text-center">
                    <Label className="text-xs mb-1.5 block font-bold text-muted-foreground uppercase tracking-wider">Business Logo</Label>
                    <Input 
                      type="file" 
                      accept="image/*"
                      className="cursor-pointer max-w-xs mx-auto"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const maxSize = 2 * 1024 * 1024; // 2MB
                          if (file.size > maxSize) {
                            toast({
                              title: "File too large",
                              description: "Business logo must be smaller than 2MB.",
                              variant: "destructive"
                            });
                            e.target.value = ""; // clear input
                            return;
                          }
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            form.setValue("logoUrl", reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Upload logo (JPG, PNG). Max size 2MB (Strictly enforced).
                    </p>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Name</FormLabel>
                        <FormControl>
                          <Input placeholder="My Enterprise" {...field} data-testid="input-business-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="businessUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Website (Optional)</FormLabel>
                        <FormControl>
                          <div className="flex">
                            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                              https://
                            </span>
                            <Input 
                              {...field} 
                              placeholder="example.com" 
                              className="rounded-l-none"
                              data-testid="input-business-url" 
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Corporate Headquarters Address (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="123 Corporate Blvd, Lagos, Nigeria" {...field} data-testid="input-business-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Phone Number (Optional)</FormLabel>
                  <div className="flex gap-2">
                    <FormField
                      control={form.control}
                      name="phoneCountryCode"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || "+234"}>
                          <SelectTrigger className="w-[120px]" data-testid="select-business-phone-country">
                            <SelectValue placeholder="+234" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {deduplicatedCountryCodes.map((cc) => (
                              <SelectItem key={cc.dialCode} value={cc.dialCode}>
                                {cc.dialCode} ({cc.name})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormControl className="flex-1">
                          <Input {...field} placeholder="Phone number" data-testid="input-business-phone" />
                        </FormControl>
                      )}
                    />
                  </div>
                </FormItem>

                <div className="border border-muted/80 p-4 rounded-lg bg-muted/10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Coins className="h-5 w-5 text-primary" />
                    <p className="text-sm font-semibold text-foreground uppercase tracking-wider">Default Hybrid Commission Split</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="commissionSplitBusinessShare"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Business Share (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              placeholder="80"
                              data-testid="input-business-split-business"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="commissionSplitStaffShare"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Staff Share (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              placeholder="20"
                              data-testid="input-business-split-staff"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Standard split percentage automatically applies to staff checkouts unless overriden at the store location or individual service level. Must total exactly 100%.
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button type="button" variant="outline" onClick={() => setLocation("/settings/stores")}>
                    Cancel
                  </Button>
                  <Button type="submit" data-testid="button-save-business" className="min-w-[120px]">
                    {business ? "Save Changes" : "Create Profile"}
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
