import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { Plan } from "@shared/schema";

export function PlanPicker() {
  const { toast } = useToast();
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["/api/billing/plans"],
  });

  const subscribeMutation = useMutation({
    mutationFn: async (planId: string) => {
      // Paystack is the only live payment channel right now - the server
      // accepts stripe/flutterwave too, but rejects them with a clear
      // "not connected yet" error until those are wired up.
      const res = await apiRequest("POST", "/api/billing/subscribe", {
        planId,
        billingCycle: cycle,
        provider: "paystack",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to subscribe");
      return body as { authorizationUrl: string; reference: string };
    },
    onSuccess: (body) => {
      window.location.href = body.authorizationUrl;
    },
    onError: (err: Error) => {
      toast({
        title: "Can't activate this plan yet",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Tabs value={cycle} onValueChange={(v) => setCycle(v as "monthly" | "annual")}>
          <TabsList>
            <TabsTrigger value="monthly" data-testid="tab-billing-monthly">Monthly</TabsTrigger>
            <TabsTrigger value="annual" data-testid="tab-billing-annual">Annual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
        {plans.map((plan) => {
          const price = cycle === "monthly" ? plan.priceMonthly : plan.priceAnnual;
          const features = Array.isArray(plan.features) ? (plan.features as string[]) : [];
          return (
            <Card key={plan.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between">
                  <span>{plan.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {cycle === "monthly" ? "/mo" : "/yr"}
                  </span>
                </CardTitle>
                <div className="text-2xl font-bold">
                  {plan.currency} {Number(price).toLocaleString()}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col flex-1 gap-4">
                <ul className="space-y-2 text-sm text-muted-foreground flex-1">
                  {features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  data-testid={`button-subscribe-${plan.id}`}
                  disabled={subscribeMutation.isPending}
                  onClick={() => subscribeMutation.mutate(plan.id)}
                >
                  {subscribeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Choose this plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
