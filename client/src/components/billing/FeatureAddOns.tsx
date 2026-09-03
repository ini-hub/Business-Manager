import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import type { FeatureCatalog, Subscription } from "@shared/schema";

const CATEGORY_LABELS: Record<string, string> = {
  vendor_mgmt: "Vendor Management",
  staff_mgmt: "Staff Management",
  customer_mgmt: "Customer Management",
  financial_mgmt: "Financial Management",
  tax_compliance: "Tax, Compliance & Audit",
  inventory_mgmt: "Inventory Management",
  analytics: "Analytics",
  business_settings: "Business & Settings",
};

const RETURN_TO_KEY = "billing_return_to";

/**
 * The ONE checkout surface in the app now (requirements plan §4) - no plan
 * tier to pick first, nothing else stands between "sign up" and "here's what
 * you can add." Renders the catalog unconditionally, whether or not a
 * subscription exists yet: planId rides along as optional on /subscribe, so
 * the server resolves the implicit ₦0 default plan when there's nothing to
 * choose from.
 *
 * The checklist pre-checks everything the org is CURRENTLY entitled to -
 * purchased add-ons and anything the trial is blanket-granting alike - so
 * "Proceed" with no changes is itself a real action: it charges for
 * whatever's checked but not yet purchased (the trial-conversion path) and
 * schedules removal for whatever's unchecked but still purchased. Doing
 * nothing at all (never opening this) is the only true no-op, and that's
 * deliberate - it's what leaves a business on the free tier once the trial
 * ends (requirements plan §4).
 */
export function FeatureAddOns({ onDone }: { onDone?: () => void } = {}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  // Sticky once true - a redirect to Paystack can take a few seconds, and
  // letting the button re-enable in that gap is what let a slow connection
  // fire the same checkout two or three times (requirements plan §4).
  const [redirecting, setRedirecting] = useState(false);
  // Seeds `selected` from current entitlements exactly once, the first time
  // that data is available - afterward the user's own edits own this state,
  // a background refetch must never silently stomp an in-progress selection.
  const seeded = useRef(false);

  const { data: catalog = [], isLoading: catalogLoading } = useQuery<FeatureCatalog[]>({
    queryKey: ["/api/billing/feature-catalog"],
  });
  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ["/api/billing/subscription"],
  });
  const { entitledKeys, purchasedKeys, isLoading: entitlementsLoading } = useEntitlements();

  const purchasable = catalog.filter((f) => f.tierType === "paid_flat" || f.tierType === "paid_metered_limit" || f.tierType === "bundle_parent");
  // Only these keys are ever checkboxes here, so only these ever belong in a
  // diff - purchasedKeys/entitledKeys from the server also include always-
  // free features (never purchased, never removable), which must never show
  // up as something to "remove" just because they're not in `selected`.
  const purchasableKeys = new Set(purchasable.map((f) => f.key));
  const purchasedSet = new Set(purchasedKeys.filter((k) => purchasableKeys.has(k)));

  useEffect(() => {
    if (seeded.current || catalogLoading || entitlementsLoading) return;
    seeded.current = true;
    setSelected(new Set(entitledKeys.filter((k) => purchasableKeys.has(k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, entitlementsLoading]);

  // A subscription already commits to a cycle - renewals bill everything on
  // it together (§2.6), so there's no per-purchase cycle choice once one
  // exists. Only a first-time subscriber picks one, via the toggle below.
  const effectiveCycle = (subscription?.billingCycle as "monthly" | "annual" | undefined) ?? cycle;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const priceOf = (key: string) => {
    const f = purchasable.find((f) => f.key === key);
    return f ? Number(effectiveCycle === "annual" ? f.priceAnnual : f.priceMonthly) || 0 : 0;
  };
  const nameOf = (key: string) => purchasable.find((f) => f.key === key)?.name ?? key;
  const currency = purchasable[0]?.currency ?? "NGN";

  // Checked-but-not-yet-paid-for → charge these on Proceed. Purchased-but-
  // now-unchecked → schedule these for removal. Anything checked that's
  // already purchased, or unchecked that was never purchased, is unchanged.
  const toAdd = Array.from(selected).filter((k) => !purchasedSet.has(k));
  const toRemove = Array.from(purchasedSet).filter((k) => !selected.has(k));
  const addTotal = toAdd.reduce((sum, k) => sum + priceOf(k), 0);
  const hasChanges = toAdd.length > 0 || toRemove.length > 0;

  const proceedMutation = useMutation({
    mutationFn: async () => {
      // Removals first - if a dependency conflict rejects one, stop before
      // touching the card at all (see scheduleFeatureRemoval server-side).
      for (const key of toRemove) {
        const res = await apiRequest("POST", `/api/billing/features/${key}/remove`);
        const body = await res.json();
        if (!res.ok) throw new Error(`Couldn't remove "${nameOf(key)}": ${body.error || "unknown error"}`);
      }

      if (toAdd.length === 0) return { redirect: false as const };

      // Prefer the page FeatureGate stashed before sending someone here -
      // that's the page they actually wanted, not this billing screen they
      // only passed through. Falls back to wherever this component itself
      // is mounted (e.g. opened directly from Settings > Billing).
      let returnTo = window.location.pathname + window.location.search;
      try {
        const stashed = sessionStorage.getItem(RETURN_TO_KEY);
        if (stashed) returnTo = stashed;
      } catch {
        // ignore - falls back to the current page
      }

      const res = await apiRequest("POST", "/api/billing/subscribe", {
        ...(subscription ? { planId: subscription.planId } : {}),
        billingCycle: effectiveCycle,
        provider: "paystack",
        featureKeys: toAdd,
        returnTo,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to start checkout");
      return { redirect: true as const, authorizationUrl: body.authorizationUrl as string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      if (result.redirect) {
        setRedirecting(true);
        try {
          sessionStorage.removeItem(RETURN_TO_KEY);
        } catch {
          // ignore
        }
        window.location.href = result.authorizationUrl;
        return;
      }
      toast({ title: "Subscription updated." });
      onDone?.();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't update your subscription", description: err.message, variant: "destructive" });
    },
  });

  if (catalogLoading || entitlementsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const byCategory = purchasable.reduce<Record<string, FeatureCatalog[]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  const busy = proceedMutation.isPending || redirecting;

  return (
    <div className="space-y-6">
      {!subscription && (
        <div className="flex justify-center">
          <Tabs value={cycle} onValueChange={(v) => setCycle(v as "monthly" | "annual")}>
            <TabsList>
              <TabsTrigger value="monthly" data-testid="tab-billing-monthly">Monthly</TabsTrigger>
              <TabsTrigger value="annual" data-testid="tab-billing-annual">Annual</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {Object.entries(byCategory).map(([category, features]) => (
        <div key={category}>
          <h3 className="text-sm font-semibold mb-2">{CATEGORY_LABELS[category] ?? category}</h3>
          <div className="space-y-2">
            {features.map((f) => {
              const purchased = purchasedSet.has(f.key);
              const checked = selected.has(f.key);
              const trialGranted = !purchased && entitledKeys.includes(f.key);
              const price = Number(effectiveCycle === "annual" ? f.priceAnnual : f.priceMonthly) || 0;
              const removing = purchased && !checked;
              const adding = !purchased && checked;
              return (
                <Card key={f.id} className={purchased && checked ? "border-primary/40" : removing ? "border-destructive/40" : undefined}>
                  <CardContent className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-start gap-3">
                      <Checkbox checked={checked} onCheckedChange={() => toggle(f.key)} className="mt-1" />
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                          {f.name}
                          {purchased && checked && <Badge variant="secondary">Active</Badge>}
                          {trialGranted && <Badge variant="outline">Included in trial</Badge>}
                          {removing && <Badge variant="destructive">Ends at renewal</Badge>}
                          {f.tierType === "bundle_parent" && <Badge variant="outline">Bundle</Badge>}
                        </p>
                        {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                        {adding && <p className="text-xs text-primary mt-0.5">Will be added when you proceed.</p>}
                        {removing && <p className="text-xs text-destructive mt-0.5">Will stop at your next renewal date.</p>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">
                        {f.currency} {price.toLocaleString()} <span className="text-xs text-muted-foreground">/{effectiveCycle}</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      <Card className={hasChanges ? "border-primary/40" : undefined}>
        <CardHeader>
          <CardTitle className="text-base">
            {toAdd.length > 0 && `${toAdd.length} to add - ${currency} ${addTotal.toLocaleString()} /${effectiveCycle} now`}
            {toAdd.length > 0 && toRemove.length > 0 && " · "}
            {toRemove.length > 0 && `${toRemove.length} to remove at renewal`}
            {!hasChanges && "No changes to your subscription"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={() => proceedMutation.mutate()} disabled={busy || !hasChanges}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {redirecting ? "Redirecting to secure checkout…" : proceedMutation.isPending ? "Updating…" : "Proceed"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
