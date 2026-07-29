import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { PageHeader } from "@/components/page-header";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isOrgTrialing, trialDaysRemaining } from "@/lib/trial";
import type { Subscription, Plan } from "@shared/schema";

export default function BillingSettingsPage() {
  const { toast } = useToast();
  const { business } = useStore();

  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ["/api/billing/subscription"],
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["/api/billing/plans"],
  });

  const currentPlan = plans.find((p) => p.id === subscription?.planId);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/cancel");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to cancel");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
      toast({ title: "Subscription set to cancel at period end." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't cancel your subscription", description: err.message, variant: "destructive" });
    },
  });

  const trialing = isOrgTrialing(business);
  const daysLeft = trialDaysRemaining(business);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="View your trial status, manage your plan, and update payment details."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Current status
            {trialing && <Badge variant="secondary">Trial</Badge>}
            {subscription?.status === "active" && <Badge>Active</Badge>}
            {subscription?.status === "past_due" && <Badge variant="destructive">Past due</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {trialing && (
            <p className="text-sm text-muted-foreground">
              {daysLeft === 0 ? "Your free trial ends today." : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in your free trial.`}
            </p>
          )}
          {subscription && currentPlan && (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{currentPlan.name}</p>
                <p className="text-xs text-muted-foreground">
                  {currentPlan.currency} {Number(subscription.billingCycle === "monthly" ? currentPlan.priceMonthly : currentPlan.priceAnnual).toLocaleString()} / {subscription.billingCycle}
                  {subscription.cancelAtPeriodEnd && " · cancels at period end"}
                </p>
              </div>
              {!subscription.cancelAtPeriodEnd && subscription.status === "active" && (
                <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                  Cancel plan
                </Button>
              )}
            </div>
          )}
          {!subscription && !trialing && (
            <p className="text-sm text-muted-foreground">You don't have an active plan yet.</p>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold mb-3">{subscription ? "Change plan" : "Choose a plan"}</h2>
        <PlanPicker />
      </div>
    </div>
  );
}
