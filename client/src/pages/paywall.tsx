import { Lock, LogOut, Building2, ArrowRightLeft } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { PlanPicker } from "@/components/billing/PlanPicker";
import { SupportChatPanel } from "@/components/support/SupportChatPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isOrgLocked } from "@/lib/trial";
import type { Business } from "@shared/schema";

type OwnedOrg = {
  id: string;
  name: string;
  role: string;
  orgStatus: string;
  trialEndsAt: string | null;
};

/** Other businesses this owner has that aren't locked - an escape hatch so a
 * payment problem on one workspace doesn't strand someone who runs several. */
function SwitchBusinessPanel({ currentBusinessId }: { currentBusinessId: string | undefined }) {
  const { toast } = useToast();

  // Same query key OrgSwitcher.tsx uses, so this shares its cache.
  const { data: orgs = [] } = useQuery<OwnedOrg[]>({
    queryKey: ["/api/auth/organisations"],
  });

  const switchMutation = useMutation({
    mutationFn: async (organisationId: string) => {
      const res = await apiRequest("POST", "/api/auth/organisation/switch", { organisationId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.reload();
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't switch business",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const switchableOrgs = orgs.filter(
    (o) =>
      o.role === "owner" &&
      o.id !== currentBusinessId &&
      !isOrgLocked({ status: o.orgStatus, trialEndsAt: o.trialEndsAt })
  );

  if (switchableOrgs.length === 0) return null;

  return (
    <Card className="text-left">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">Or switch to another business you own</p>
        <div className="space-y-2">
          {switchableOrgs.map((org) => (
            <div key={org.id} className="flex items-center justify-between rounded-lg border p-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {org.name}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={switchMutation.isPending}
                onClick={() => switchMutation.mutate(org.id)}
                data-testid={`button-switch-business-${org.id}`}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Switch
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Full-screen lock for owners once a trial has expired (or the account is
 * suspended for non-payment) with no active subscription. Only ever shown to
 * organisations created by the trial flow, or manually suspended by an admin -
 * every pre-existing organisation stays "active" and never sees this.
 */
export function Paywall({ business }: { business: Business | null | undefined }) {
  const { logout } = useAuth();
  const isSuspended = business?.status === "suspended";

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-3xl space-y-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-destructive/10 p-3">
            <Lock className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold">
            {isSuspended
              ? business?.suspensionReason === "non_payment"
                ? "Your subscription payment failed"
                : "This account has been suspended"
              : "Your free trial has ended"}
          </h1>
          <p className="text-muted-foreground max-w-md">
            {isSuspended && business?.suspensionReason !== "non_payment"
              ? "Send a message to our support team below and we'll help resolve this and restore your access."
              : "Pick a plan below to keep using this business account without interruption."}
          </p>
        </div>

        {!isSuspended || business?.suspensionReason === "non_payment" ? (
          <PlanPicker />
        ) : (
          <SupportChatPanel />
        )}

        <SwitchBusinessPanel currentBusinessId={business?.id} />

        <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </div>
    </div>
  );
}

export default Paywall;
