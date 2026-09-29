import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useEntitlements } from "@/hooks/useEntitlements";
import { countLimitMessage, openBilling } from "@/lib/upgrade-prompt";

const LABELS = {
  staff_seats: { plural: "staff", short: "Staff" },
  customer_count: { plural: "customers", short: "Customers" },
  store_count: { plural: "stores", short: "Stores" },
} as const;

/**
 * Wraps an "add new X" page. At the free-tier cap it shows the upgrade card
 * up front instead of a form the server would only reject after the user has
 * filled it in. Editing existing records is never wrapped: an org over its cap
 * keeps everything it has and is only blocked from adding more. The server
 * (assertWithinCountLimit) stays the source of truth; this is the courtesy layer.
 */
export function LimitGate({ limitType, children }: { limitType: keyof typeof LABELS; children: ReactNode }) {
  const { staffSeats, customerCount, storeCount, isLoading } = useEntitlements();
  const [, navigate] = useLocation();

  if (isLoading) return null;
  const status = { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount }[limitType];
  if (!status || status.unlimited || status.used < status.limit) return <>{children}</>;

  const label = LABELS[limitType];
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <div>
          <p className="font-medium">
            {label.short} limit reached ({status.used} of {status.limit})
          </p>
          <p className="text-sm text-muted-foreground">{countLimitMessage(limitType, status.limit)}</p>
        </div>
        <Button size="sm" onClick={() => openBilling(navigate)}>
          View plans &amp; add-ons
        </Button>
      </CardContent>
    </Card>
  );
}
