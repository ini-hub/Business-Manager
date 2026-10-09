import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { apiRequest, type ApiError } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/loader";

// Fire-and-forget funnel instrumentation - never blocks the wizard on failure.
function logFunnelEvent(eventName: string, metadata?: Record<string, unknown>) {
  apiRequest("POST", "/api/funnel-events", { eventName, metadata }).catch(() => {});
}


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

// Store is the only required step. Staff, products and capital are picked up
// afterwards from the dashboard's getting-started checklist, in context.

export default function OnboardingWizard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const storeForm = useForm<z.infer<typeof storeSchema>>({
    resolver: zodResolver(storeSchema),
    defaultValues: { name: "", code: "", address: "", phone: "", phoneCountryCode: "+234", country: "NG", currency: "NGN" },
  });

  const finishOnboarding = async (destination: string = "/") => {
    logFunnelEvent("onboarding_completed", { destination });
    // Refetch stores so AuthenticatedLayout sees them before we navigate
    await queryClient.refetchQueries({ queryKey: ["/api/stores"] });
    setLocation(destination);
  };

  const storeMutation = useMutation({
    mutationFn: async (data: z.infer<typeof storeSchema>) => {
      // apiRequest already throws a proper Error (the server's message on
      // .message) for any non-2xx response - no need to re-check res.ok or
      // re-parse the body here.
      const res = await apiRequest("POST", "/api/stores", { ...data, businessId: (user as any)?.businessId });
      return res.json();
    },
    onSuccess: async (store) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      toast({ title: "Store created!", description: `${store.name} is ready.` });
      await finishOnboarding("/");
    },
    onError: (error: Error) => {
      // At the plan cap, apiRequest has already opened the upgrade dialog; a toast saying the same would double up.
      if ((error as ApiError).planLimit) return;
      toast({ title: "Failed to create store", description: getUserFriendlyError(error, "store"), variant: "destructive" });
    },
  });

  // Server creates "Main Store"/"MAIN" (idempotent) so the dashboard has a store to attach to.
  const skipMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stores/skip-setup")).json(),
    onSuccess: async () => {
      logFunnelEvent("onboarding_skipped");
      await finishOnboarding("/");
    },
    onError: (error: Error) => {
      if ((error as ApiError).planLimit) return;
      toast({ title: "Couldn't set up your store", description: getUserFriendlyError(error, "store"), variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-[26px] font-bold tracking-tight">Welcome to Kowope</h1>
          <p className="text-muted-foreground text-sm">One quick step - name your first store (about 30 seconds). You'll add products and staff from your dashboard.</p>
        </div>

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
                  <div className="flex flex-col-reverse sm:flex-row gap-3">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => skipMutation.mutate()} disabled={storeMutation.isPending || skipMutation.isPending}>
                      {skipMutation.isPending ? "Setting up..." : "Skip for now, go to dashboard"}
                    </Button>
                    <Button type="submit" className="flex-1" disabled={storeMutation.isPending || skipMutation.isPending}>
                      {storeMutation.isPending ? <><Spinner className="h-5 w-5 mr-2 animate-spin" />Creating...</> : <>Create store and continue <ChevronRight className="h-4 w-4 ml-1" /></>}
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
