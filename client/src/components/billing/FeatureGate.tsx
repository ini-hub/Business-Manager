import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useEntitlements, formatPrice } from "@/hooks/useEntitlements";
import { useLocation } from "wouter";
import { openBilling } from "@/lib/upgrade-prompt";

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
  const { hasFeature, isDisabled, priceFor, isLoading, isError, refetch } = useEntitlements();
  const [, navigate] = useLocation();

  if (isLoading) return null;
  if (isError) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-medium">Couldn't check your plan</p>
          <p className="text-sm text-muted-foreground">Something went wrong loading your features. Please try again.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (hasFeature(featureKey)) return <>{children}</>;
  // Flag off: the feature does not exist for this org, so there is nothing to upsell.
  if (isDisabled(featureKey)) return fallback ? <>{fallback}</> : null;
  if (fallback) return <>{fallback}</>;

  const goToBilling = () => openBilling(navigate);
  const price = priceFor(featureKey);
  const priceLabel = formatPrice(price);
  const name = featureName ?? price?.name ?? "This feature";

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">{priceLabel ? `${name} costs ${priceLabel}` : `${name} isn't included in your plan yet`}</p>
          <p className="text-sm text-muted-foreground">Add it from Settings &gt; Billing to unlock it for your business.</p>
        </div>
        <Button size="sm" onClick={goToBilling}>
          View plans &amp; add-ons
        </Button>
      </CardContent>
    </Card>
  );
}
