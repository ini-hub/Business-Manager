import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Store, Users, Package, ShoppingCart, CheckCircle2, ChevronRight } from "lucide-react";


// ─── Step Schemas ──────────────────────────────────────────────────────────────

const storeSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  code: z.string().min(1, "Store code is required").max(10).transform(s => s.toUpperCase().replace(/\s+/g, "")),
  address: z.string().optional(),
  phone: z.string().optional(),
  phoneCountryCode: z.string().default("+234"),
  country: z.string().default("NG"),
  currency: z.string().default("NGN"),
});

const staffSchema = z.object({
  name: z.string().min(1, "Staff name is required"),
  email: z.string().email("Valid email required"),
  mobileNumber: z.string().min(1, "Phone number is required"),
  countryCode: z.string().default("+234"),
  role: z.enum(["manager", "staff"]),
  payPerMonth: z.coerce.number().min(0, "Pay must be 0 or more"),
});

const inventorySchema = z.object({
  name: z.string().min(1, "Item name is required"),
  type: z.enum(["product", "service"]),
  costPrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0, "Selling price is required"),
  quantity: z.coerce.number().int().min(0).default(0),
});

// ─── Step Configuration ────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Store", icon: Store, description: "Create your first store location" },
  { id: 2, label: "Staff", icon: Users, description: "Add a staff member" },
  { id: 3, label: "Inventory", icon: Package, description: "Add your first product or service" },
  { id: 4, label: "Start Selling", icon: ShoppingCart, description: "You're ready to go!" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [createdStoreId, setCreatedStoreId] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // ── Step 1: Store ──────────────────────────────────────────────────────────

  const storeForm = useForm<z.infer<typeof storeSchema>>({
    resolver: zodResolver(storeSchema),
    defaultValues: { name: "", code: "", address: "", phone: "", phoneCountryCode: "+234", country: "NG", currency: "NGN" },
  });

  const storeMutation = useMutation({
    mutationFn: async (data: z.infer<typeof storeSchema>) => {
      const res = await apiRequest("POST", "/api/stores", { ...data, businessId: (user as any)?.businessId });
      if (!res.ok) throw await res.json();
      return res.json();
    },
    onSuccess: (store) => {
      setCreatedStoreId(store.id);
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      toast({ title: "Store created!", description: `${store.name} is ready.` });
      setStep(2);
    },
    onError: (err: any) => toast({ title: "Failed to create store", description: err.error || "Please try again.", variant: "destructive" }),
  });

  // ── Step 2: Staff ──────────────────────────────────────────────────────────

  const staffForm = useForm<z.infer<typeof staffSchema>>({
    resolver: zodResolver(staffSchema),
    defaultValues: { name: "", email: "", mobileNumber: "", countryCode: "+234", role: "staff", payPerMonth: 0 },
  });

  const staffMutation = useMutation({
    mutationFn: async (data: z.infer<typeof staffSchema>) => {
      const res = await apiRequest("POST", "/api/staff", { ...data, storeId: createdStoreId });
      if (!res.ok) throw await res.json();
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Staff member added!" });
      setStep(3);
    },
    onError: (err: any) => toast({ title: "Failed to add staff", description: err.error || "Please try again.", variant: "destructive" }),
  });

  // ── Step 3: Inventory ──────────────────────────────────────────────────────

  const inventoryForm = useForm<z.infer<typeof inventorySchema>>({
    resolver: zodResolver(inventorySchema),
    defaultValues: { name: "", type: "product", costPrice: 0, sellingPrice: 0, quantity: 1 },
  });

  const inventoryMutation = useMutation({
    mutationFn: async (data: z.infer<typeof inventorySchema>) => {
      const res = await apiRequest("POST", "/api/inventory", { ...data, storeId: createdStoreId });
      if (!res.ok) throw await res.json();
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item added to inventory!" });
      setStep(4);
    },
    onError: (err: any) => toast({ title: "Failed to add item", description: err.error || "Please try again.", variant: "destructive" }),
  });

  const finishOnboarding = async (destination: string = "/") => {
    // Refetch stores so AuthenticatedLayout sees them before we navigate
    await queryClient.refetchQueries({ queryKey: ["/api/stores"] });
    setLocation(destination);
  };

  // ─── UI ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Business Manager</h1>
          <p className="text-muted-foreground">Let's set up your business in just a few steps</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    done ? "bg-primary border-primary text-primary-foreground" :
                    active ? "border-primary text-primary bg-primary/10" :
                    "border-muted text-muted-foreground"
                  }`}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span className={`text-xs font-medium ${active ? "text-primary" : done ? "text-primary" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Cards */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" /> Create Your First Store</CardTitle>
              <CardDescription>This is your primary business location. You can add more stores later.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...storeForm}>
                <form onSubmit={storeForm.handleSubmit(d => storeMutation.mutate(d))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={storeForm.control} name="name" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Store Name</FormLabel>
                        <FormControl><Input placeholder="e.g. Main Branch" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={storeForm.control} name="code" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Store Code</FormLabel>
                        <FormControl><Input placeholder="e.g. MAIN" maxLength={10} {...field} onChange={e => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={storeForm.control} name="currency" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Currency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="NGN">NGN — Nigerian Naira</SelectItem>
                            <SelectItem value="USD">USD — US Dollar</SelectItem>
                            <SelectItem value="GBP">GBP — British Pound</SelectItem>
                            <SelectItem value="EUR">EUR — Euro</SelectItem>
                            <SelectItem value="GHS">GHS — Ghanaian Cedi</SelectItem>
                            <SelectItem value="KES">KES — Kenyan Shilling</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={storeForm.control} name="address" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Address <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
                        <FormControl><Input placeholder="123 Business Street" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" className="w-full" disabled={storeMutation.isPending}>
                    {storeMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <>Create Store <ChevronRight className="h-4 w-4 ml-1" /></>}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Add Your First Staff Member</CardTitle>
              <CardDescription>Add a team member to this store. You can skip this and add staff later.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...staffForm}>
                <form onSubmit={staffForm.handleSubmit(d => staffMutation.mutate(d))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={staffForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={staffForm.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={staffForm.control} name="email" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={staffForm.control} name="mobileNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl><Input placeholder="08012345678" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={staffForm.control} name="payPerMonth" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monthly Pay</FormLabel>
                        <FormControl><Input type="number" min="0" placeholder="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(3)}>
                      Skip for now
                    </Button>
                    <Button type="submit" className="flex-1" disabled={staffMutation.isPending}>
                      {staffMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : <>Add Staff <ChevronRight className="h-4 w-4 ml-1" /></>}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Add Your First Product or Service</CardTitle>
              <CardDescription>Add an item to your inventory. You can add more from the Inventory page.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...inventoryForm}>
                <form onSubmit={inventoryForm.handleSubmit(d => inventoryMutation.mutate(d))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={inventoryForm.control} name="name" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Item Name</FormLabel>
                        <FormControl><Input placeholder="e.g. Laptop, Web Design Service" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={inventoryForm.control} name="type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="product">Product</SelectItem>
                            <SelectItem value="service">Service</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={inventoryForm.control} name="quantity" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantity in Stock</FormLabel>
                        <FormControl><Input type="number" min="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={inventoryForm.control} name="costPrice" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Price</FormLabel>
                        <FormControl><Input type="number" min="0" placeholder="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={inventoryForm.control} name="sellingPrice" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Selling Price</FormLabel>
                        <FormControl><Input type="number" min="0" placeholder="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(4)}>
                      Skip for now
                    </Button>
                    <Button type="submit" className="flex-1" disabled={inventoryMutation.isPending}>
                      {inventoryMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding...</> : <>Add Item <ChevronRight className="h-4 w-4 ml-1" /></>}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-primary" />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold">You're all set!</h2>
                <p className="text-muted-foreground mt-2">Your business is ready. Head to the dashboard to start managing operations.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm sm:max-w-none mx-auto justify-center">
                <Button onClick={() => finishOnboarding("/")} size="lg" className="w-full sm:w-auto">
                  Go to Dashboard <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => finishOnboarding("/sales/new")} className="w-full sm:w-auto">
                  Make First Sale <ShoppingCart className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
