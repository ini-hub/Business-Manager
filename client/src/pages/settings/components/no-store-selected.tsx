import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import type { Store } from "lucide-react";

/**
 * Shared across the store-scoped settings pages (store-details.tsx,
 * attendance.tsx, credit-sales.tsx, payment-integrations.tsx) - extracted
 * from the old settings-store.tsx tab hub when each tab got its own route.
 */
export function NoStoreSelected({ icon: Icon, action }: { icon: typeof Store; action: string }) {
  return (
    <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
      <div>
        <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
        <CardDescription className="max-w-sm mt-1">
          Select a store from the store switcher to {action}.
        </CardDescription>
      </div>
    </Card>
  );
}
