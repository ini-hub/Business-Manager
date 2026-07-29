import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { isOrgTrialing } from "@/lib/trial";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Package, ArrowRight } from "lucide-react";

/**
 * Onboarding's "Skip for now" buttons let a trial user reach checkout with no
 * staff/inventory set up, which used to just dead-end at checkout's validation
 * errors with no path back. This banner stays visible (dashboard + new-sale)
 * until both exist, deep-linking straight to the form that's still missing.
 * Trial-gated: never renders for a pre-existing (non-trialing) organisation.
 */
export function GettingStartedChecklist() {
  const { business, currentStore } = useStore();
  const trialing = isOrgTrialing(business);
  const enabled = trialing && !!currentStore?.id && currentStore.id !== "all";

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled,
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["/api/products", currentStore?.id],
    enabled,
  });

  if (!enabled) return null;

  const missingStaff = staffList.length === 0;
  const missingInventory = products.length === 0;
  if (!missingStaff && !missingInventory) return null;

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="card-getting-started-checklist">
      <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <p className="font-medium text-sm">Finish setting up your business</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {missingStaff && missingInventory
              ? "Add a staff member and your first product or service to start selling."
              : missingStaff
              ? "Add a staff member to assign to sales."
              : "Add your first product or service to sell."}
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          {missingStaff && (
            <Link href="/staff/new" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Users className="h-3.5 w-3.5" /> Add staff <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {missingInventory && (
            <Link href="/inventory/new" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Package className="h-3.5 w-3.5" /> Add item <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
