import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { FeatureAddOns } from "@/components/billing/FeatureAddOns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { isOrgTrialing, trialDaysRemaining } from "@/lib/trial";
import type { Subscription, Plan } from "@shared/schema";

export default function BillingSettingsPage() {
  const { toast } = useToast();
  const { business } = useStore();
  const [managingSubscription, setManagingSubscription] = useState(false);

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
  const hasActiveSubscription = subscription?.status === "active" && !subscription.cancelAtPeriodEnd;
  // "Update" once there's a live paid subscription to tweak; "Renew" while
  // trialing, lapsed, past due, or set to cancel - anything where proceeding
  // is what keeps the business paying and running past this point.
  const manageLabel = hasActiveSubscription ? "Update subscription" : "Renew subscription";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="View your trial status, manage your plan, and update payment details."
        actions={
          <>
            <BackToSettingsButton />
            <Button variant="outline" asChild data-testid="link-payment-history">
              <Link href="/settings/billing/payment-history">
                <History className="mr-2 h-4 w-4" />
                Payment history
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Active subscription
            {trialing && <Badge variant="secondary">Trial</Badge>}
            {subscription?.status === "active" && <Badge>Active</Badge>}
            {subscription?.status === "past_due" && <Badge variant="destructive">Past due</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {trialing && (
            <p className="text-sm text-muted-foreground">
              {daysLeft === 0 ? "Your free trial ends today." : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in your free trial.`}
              {" "}Choose what to keep before it ends.
            </p>
          )}
          {subscription && currentPlan && (
            <div>
              <p className="font-medium text-sm">{currentPlan.name}</p>
              <p className="text-xs text-muted-foreground">
                {currentPlan.currency} {Number(subscription.billingCycle === "monthly" ? currentPlan.priceMonthly : currentPlan.priceAnnual).toLocaleString()} / {subscription.billingCycle}
                {subscription.cancelAtPeriodEnd && ` · cancels ${new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`}
              </p>
            </div>
          )}
          {!subscription && !trialing && (
            <p className="text-sm text-muted-foreground">You don't have an active plan yet.</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setManagingSubscription((v) => !v)} data-testid="button-manage-subscription">
              {managingSubscription ? "Hide add-ons" : manageLabel}
            </Button>
            {subscription && !subscription.cancelAtPeriodEnd && subscription.status === "active" && (
              <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                Cancel plan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {managingSubscription && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Features & add-ons</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Everything you currently have access to is checked. Uncheck what you don't want to keep, check anything
            else you'd like, then proceed - that's what actually charges your card or schedules a removal.
          </p>
          <FeatureAddOns onDone={() => setManagingSubscription(false)} />
        </div>
      )}
    </div>
  );
}
