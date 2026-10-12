import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useEntitlements } from "@/hooks/useEntitlements";
import { countLimitMessage, openBilling } from "@/lib/upgrade-prompt";
import { LIMITS, type LimitType } from "@shared/limits";

/**
 * Wraps an "add new X" page. At the free-tier cap it shows the upgrade card
 * up front instead of a form the server would only reject after the user has
 * filled it in. Editing existing records is never wrapped: an org over its cap
 * keeps everything it has and is only blocked from adding more. The server
 * (assertWithinCountLimit) stays the source of truth; this is the courtesy layer.
 */
export function LimitGate({ limitType, children }: { limitType: LimitType; children: ReactNode }) {
  const { limitStatus, isLoading } = useEntitlements();
  const [, navigate] = useLocation();

  if (isLoading) return null;
  const status = limitStatus[limitType];
  if (!status || status.unlimited || status.used < status.limit) return <>{children}</>;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">
            {LIMITS[limitType].short} limit reached ({status.used} of {status.limit})
          </p>
          <p className="text-sm text-muted-foreground">{countLimitMessage(limitType, status.limit, status.tiered, status.trial)}</p>
        </div>
        <Button size="sm" onClick={() => openBilling(navigate)}>
          View plans &amp; add-ons
        </Button>
      </CardContent>
    </Card>
  );
}
