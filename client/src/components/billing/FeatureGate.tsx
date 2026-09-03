import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useLocation } from "wouter";

/**
 * Centralizes the "hide/disable a gated form field or section, show an
 * upgrade CTA instead of a raw error" pattern (§2.4 of the pay-per-feature
 * plan) so individual pages don't hand-roll the hasFeature branch each time.
 * Renders children only once the entitlement is confirmed - never a flash of
 * gated content before the query resolves.
 */
export function FeatureGate({
  featureKey,
  featureName,
  children,
  fallback,
}: {
  featureKey: string;
  featureName?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasFeature, isLoading } = useEntitlements();
  const [, navigate] = useLocation();

  if (isLoading) return null;
  if (hasFeature(featureKey)) return <>{children}</>;
  if (fallback) return <>{fallback}</>;

  const goToBilling = () => {
    // Stash where we actually are before hopping to the billing page, so
    // FeatureAddOns can send the user back HERE after checkout instead of
    // just to /settings/billing (which is only a stop on the way) - see
    // requirements plan §6 (return-to-last-state).
    try {
      sessionStorage.setItem("billing_return_to", window.location.pathname + window.location.search);
    } catch {
      // sessionStorage can throw in a locked-down browser context - fall
      // back to the default that billing-callback.tsx uses in that case.
    }
    navigate("/settings/billing");
  };

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">{featureName ?? "This feature"} isn't included in your plan yet</p>
          <p className="text-sm text-muted-foreground">Add it from Settings &gt; Billing to unlock it for your business.</p>
        </div>
        <Button size="sm" onClick={goToBilling}>
          View plans &amp; add-ons
        </Button>
      </CardContent>
    </Card>
  );
}
