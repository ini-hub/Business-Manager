import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SaveBar } from "@/components/admin/SaveBar";
import { DisableImpactNote, disableAllowed } from "../DisableImpactNote";
import { CancelSunsetDialog, PublishDialog, SunsetDialog, sunsetKey, type SunsetInfo } from "./FeatureDialogs";
import { isPriced, type FeatureRow } from "./featureRow";
import { isCapType } from "@shared/thresholds";
import type { FeatureDetailData } from "./detailTypes";

const hasOwnPrice = (tier: string) => tier === "paid_flat" || tier === "paid_metered_limit" || tier === "bundle_parent";
const toNumber = (v: string) => (v.trim() === "" ? null : Number(v));
const symbol = (c: string) => (c === "NGN" ? "₦" : c);

/** The dialogs only need the identifying and pricing fields of a list row. */
function asRow(f: FeatureDetailData["feature"]): FeatureRow {
  return {
    id: f.id, key: f.key, name: f.name, description: f.description ?? "", tier: f.tierType, section: f.section,
    groupParent: null, sortOrder: 0, price: f.priceMonthly, currency: f.currency, freeLimit: f.freeLimit,
    state: f.reviewStatus === "pending_review" ? "needs_review" : f.isActive ? "live" : "inactive",
    rollout: "on", scopedCount: 0, gatePending: false, updatedAt: null, flagId: null,
  };
}

export function PricingTab({ data, canEdit }: { data: FeatureDetailData; canEdit: boolean }) {
  const { feature } = data;
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const pending = feature.reviewStatus === "pending_review";
  const priced = hasOwnPrice(feature.tierType);

  const initial = {
    monthly: feature.priceMonthly != null ? String(feature.priceMonthly) : "",
    annual: feature.priceAnnual != null ? String(feature.priceAnnual) : "",
    active: feature.isActive,
  };
  const [monthly, setMonthly] = useState(initial.monthly);
  const [annual, setAnnual] = useState(initial.annual);
  const [active, setActive] = useState(initial.active);
  const [confirmKey, setConfirmKey] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [sunsetting, setSunsetting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const livePriced = isPriced(feature.tierType) && !pending && feature.isActive;
  const sunset = useQuery<SunsetInfo>({
    queryKey: sunsetKey(feature.id),
    queryFn: async () => (await apiRequest("GET", `/api/admin/feature-catalog/${feature.id}/sunset`)).json(),
    enabled: livePriced,
  });

  // Reset the form when the saved feature changes underneath (after a save or a refetch).
  useEffect(() => {
    setMonthly(initial.monthly); setAnnual(initial.annual); setActive(initial.active); setConfirmKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id, feature.priceMonthly, feature.priceAnnual, feature.isActive]);

  const dirty = monthly !== initial.monthly || annual !== initial.annual || active !== initial.active;
  const turningOff = !active && feature.isActive;
  const blocked = (priced && monthly.trim() === "" && active) || (turningOff && !disableAllowed(feature.key, confirmKey));

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (priced && monthly !== initial.monthly) body.priceMonthly = toNumber(monthly);
      if (priced && annual !== initial.annual) body.priceAnnual = toNumber(annual);
      if (!pending && active !== initial.active) { body.isActive = active; if (turningOff) body.confirmKey = confirmKey.trim() || undefined; }
      const res = await apiRequest("PUT", `/api/admin/feature-catalog/${feature.id}`, body);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save pricing");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Pricing saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
    },
    onError: (err: Error) => toast({ title: "Couldn't save pricing", description: err.message, variant: "destructive" }),
  });

  const discard = () => { setMonthly(initial.monthly); setAnnual(initial.annual); setActive(initial.active); setConfirmKey(""); };

  const yearly = toNumber(monthly) != null ? (toNumber(monthly) as number) * 12 : null;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/80 bg-card/40 p-4 sm:p-5 space-y-4" aria-labelledby="price-h">
        <h3 id="price-h" className="text-sm font-bold text-foreground">Price</h3>
        {priced ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([["Monthly", monthly, setMonthly], ["Annual", annual, setAnnual]] as const).map(([label, value, set]) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs" htmlFor={`price-${label}`}>{label}</Label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-border bg-muted text-sm text-muted-foreground">{symbol(feature.currency)}</span>
                    <Input id={`price-${label}`} type="number" min={0} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} disabled={!canEdit} className="rounded-l-none rounded-r-xl h-11 sm:h-10" />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {yearly != null ? `Monthly × 12 is ${symbol(feature.currency)}${yearly.toLocaleString()}. ` : ""}Annual price is set separately. Currency: {feature.currency} (set per platform).
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {feature.tierType === "bundle_child" ? "This feature is priced with its bundle." : "This feature is free, so there is no price to set."}
          </p>
        )}

        <div className="border-t border-border pt-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-foreground" id="sold-label">Sold to businesses</p>
            <p className="text-xs text-muted-foreground">
              {pending
                ? "Hidden until you price and publish it."
                : "Off hides it from the catalogue and stops new purchases. Rollout can still switch it off for everyone."}
            </p>
          </div>
          <Switch aria-labelledby="sold-label" checked={active} onCheckedChange={setActive} disabled={!canEdit || pending} />
        </div>
        {pending && canEdit && (
          <Button className="rounded-xl h-11 sm:h-9 w-full sm:w-auto" onClick={() => setPublishing(true)}>
            {priced ? "Set a price and publish" : "Publish"}
          </Button>
        )}
        {turningOff && <DisableImpactNote featureKey={feature.key} typed={confirmKey} onTyped={setConfirmKey} />}
      </section>

      {feature.tierType === "paid_metered_limit" && isCapType(feature.limitType) && (
        <section className="rounded-2xl border border-border/80 bg-card/40 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3" aria-labelledby="thr-tab-h">
          <div className="flex-1">
            <h3 id="thr-tab-h" className="text-sm font-bold text-foreground">Thresholds</h3>
            <p className="text-xs text-muted-foreground">This is a capped feature, so you can add another paid limit above its free cap.</p>
          </div>
          <Button variant="outline" className="rounded-xl h-11 sm:h-9" onClick={() => navigate(`/super-admin/features/review?cap=${feature.limitType}${canEdit ? "&add=1" : ""}`)}>
            {canEdit ? "Add threshold" : "View thresholds"}
          </Button>
        </section>
      )}

      {livePriced && (canEdit || sunset.data?.scheduled) && (
        <section className="rounded-2xl border border-border/80 bg-card/40 p-4 sm:p-5 space-y-3" aria-labelledby="life-h">
          <h3 id="life-h" className="text-sm font-bold text-foreground">Lifecycle</h3>
          {sunset.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : sunset.data?.scheduled ? (
            <>
              <p className="text-sm text-foreground">
                Sunset scheduled for <strong>{sunset.data.effectiveAt ? new Date(sunset.data.effectiveAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "an unknown date"}</strong>.
                After that it needs to be bought; {sunset.data.scheduledOrgs} business{sunset.data.scheduledOrgs === 1 ? "" : "es"} on notice.
              </p>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="rounded-xl h-11 sm:h-9" onClick={() => setSunsetting(true)}>Reschedule</Button>
                  <Button variant="outline" className="rounded-xl h-11 sm:h-9 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30" onClick={() => setCancelling(true)}>Cancel sunset</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Move a feature that businesses use for free behind the paywall, with staged reminders at 30, 7 and 1 day.
                {sunset.data ? ` ${sunset.data.eligibleOrgs} business${sunset.data.eligibleOrgs === 1 ? "" : "es"} would be put on notice.` : ""}
              </p>
              <Button variant="outline" className="rounded-xl h-11 sm:h-9" onClick={() => setSunsetting(true)}>Schedule sunset</Button>
            </>
          )}
        </section>
      )}

      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          disabled={!!blocked}
          saveLabel="Save pricing"
          onSave={() => save.mutate()}
          onDiscard={discard}
          hint={blocked ? (turningOff ? "Type the key in the note above to switch this off." : "Set a monthly price first.") : undefined}
        />
      )}

      {publishing && <PublishDialog feature={asRow(feature)} onClose={() => setPublishing(false)} />}
      {sunsetting && <SunsetDialog feature={asRow(feature)} state={sunset.data} onClose={() => setSunsetting(false)} />}
      {cancelling && sunset.data && <CancelSunsetDialog feature={asRow(feature)} state={sunset.data} onClose={() => setCancelling(false)} />}
    </div>
  );
}
