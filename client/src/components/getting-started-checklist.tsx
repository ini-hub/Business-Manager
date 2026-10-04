import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Circle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAllStaff } from "@/lib/staff-api";

/**
 * Onboarding's "Skip for now" buttons let a user reach checkout with no
 * staff/inventory set up, which used to just dead-end at checkout's validation
 * errors with no path back. This banner stays visible (dashboard + new-sale)
 * until both exist, deep-linking straight to the form that's still missing.
 * Shows for any store with a pending step, regardless of trial status — an
 * account whose trial has since ended, or a pre-trial-system account, can
 * still genuinely be missing staff/inventory and needs the same nudge.
 *
 * "Create account" is always shown as done — reaching this screen at all
 * implies the account step is complete — so it's a display-only checklist
 * entry, not a fetched condition like the other two.
 */
export function GettingStartedChecklist() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const enabled = !!currentStore?.id && currentStore.id !== "all";

  // Setup is the owner's and manager's job: staff can't open those forms, so for
  // them the staff list isn't fetched and the steps aren't shown at all.
  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: () => fetchAllStaff(currentStore!.id),
    enabled: enabled && !isStaff,
  });
  const { data: products = [], isSuccess: productsLoaded } = useQuery<any[]>({
    queryKey: ["/api/products", currentStore?.id],
    enabled,
  });

  if (!enabled) return null;

  if (isStaff) {
    // Only claim the catalogue is empty once it has actually loaded; a failed
    // fetch also leaves `products` empty.
    if (!productsLoaded || products.length > 0) return null;
    return (
      <Card className="border-amber-300/60 bg-amber-50 dark:bg-amber-950/20" data-testid="card-store-not-ready">
        <CardContent className="p-3 space-y-0.5">
          <p className="font-medium text-sm">This store has nothing to sell yet</p>
          <p className="text-xs text-muted-foreground">
            No products or services have been added. Ask your manager to add them, then you can ring up sales here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const missingStaff = staffList.length === 0;
  const missingInventory = products.length === 0;
  if (!missingStaff && !missingInventory) return null;

  const steps = [
    { key: "account", label: "Create account", done: true, href: undefined },
    { key: "inventory", label: "Add your first product or service", done: !missingInventory, href: "/inventory/new" },
    { key: "staff", label: "Invite a staff member", done: !missingStaff, href: "/staffs/new" },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="card-getting-started-checklist">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium text-sm">Set up your business</p>
          <p className="text-xs font-medium text-primary">{completed} of {steps.length}</p>
        </div>

        <div className="h-1.5 w-full rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>

        <ul className="space-y-1.5">
          {steps.map((step) => {
            const row = (
              <span className={cn("flex items-center gap-1.5 text-xs", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
                {step.done ? (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                {step.label}
                {!step.done && <ArrowRight className="h-3 w-3 text-primary shrink-0" />}
              </span>
            );
            return (
              <li key={step.key}>
                {!step.done && step.href ? (
                  <Link href={step.href} className="hover:opacity-80">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
