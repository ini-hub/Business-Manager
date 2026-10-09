import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { OrgPicker, type PickedOrg } from "@/components/admin/OrgPicker";
import { SaveBar } from "@/components/admin/SaveBar";
import { DisableImpactNote, disableAllowed } from "../DisableImpactNote";
import { rolloutOf, type Rollout } from "./featureRow";
import type { FeatureDetailData } from "./detailTypes";

const OPTIONS: { value: Rollout; title: string; body: string }[] = [
  { value: "off", title: "Off", body: "Hidden for every business, trial and paid." },
  { value: "on", title: "On", body: "Every business that has it through the free tier, a plan, a purchase or a grant." },
  { value: "scoped", title: "Scoped", body: "Only the businesses you pick below." },
];

export function RolloutTab({ data, canEdit }: { data: FeatureDetailData; canEdit: boolean }) {
  const { feature, flag, scopedOrgs } = data;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saved = rolloutOf(flag?.status);
  const [choice, setChoice] = useState<Rollout>(saved);
  const [orgs, setOrgs] = useState<PickedOrg[]>(scopedOrgs);
  const [confirmKey, setConfirmKey] = useState("");

  useEffect(() => {
    setChoice(saved); setOrgs(scopedOrgs); setConfirmKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag?.id, flag?.status, scopedOrgs.map((o) => o.id).join(",")]);

  const sameOrgs = orgs.map((o) => o.id).sort().join(",") === scopedOrgs.map((o) => o.id).sort().join(",");
  const dirty = choice !== saved || (choice === "scoped" && !sameOrgs);
  // Same rule as the server: leaving On for Off or Scoped is what needs confirming.
  const turnsOff = saved === "on" && choice !== "on";
  const blocked = (choice === "scoped" && orgs.length === 0) || (turnsOff && !disableAllowed(feature.key, confirmKey));

  const save = useMutation({
    mutationFn: async () => {
      if (!flag) throw new Error("This feature has no flag.");
      const body: Record<string, unknown> = { status: choice };
      if (choice === "scoped") body.scopedOrgIds = orgs.map((o) => o.id);
      if (turnsOff) body.confirmKey = confirmKey.trim() || undefined;
      const res = await apiRequest("PUT", `/api/admin/feature-flags/${flag.id}`, body);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to change the rollout");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Rollout updated", description: "It reaches the apps within about 15 seconds." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
    },
    onError: (err: Error) => toast({ title: "Couldn't change the rollout", description: err.message, variant: "destructive" }),
  });

  if (!flag) return <p className="text-sm text-muted-foreground">This feature has no flag yet. The next release sync creates it.</p>;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Rollout" className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const selected = choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canEdit}
              onClick={() => setChoice(o.value)}
              data-testid={`rollout-${o.value}`}
              className={cn(
                "text-left rounded-2xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed",
                selected ? "border-primary border-2 bg-primary/10" : "border-border/80 bg-card/40 hover:bg-muted/50",
              )}
            >
              <p className="text-sm font-bold text-foreground">{o.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{o.body}</p>
            </button>
          );
        })}
      </div>

      {choice === "scoped" && (
        <section className="rounded-2xl border border-border/80 bg-card/40 p-4 sm:p-5 space-y-3" aria-labelledby="scope-h">
          <h3 id="scope-h" className="text-sm font-bold text-foreground">Businesses in scope</h3>
          <OrgPicker value={orgs} onChange={setOrgs} disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">Only real businesses can be added. {orgs.length === 0 && "Pick at least one, or choose Off."}</p>
        </section>
      )}

      {turnsOff && <DisableImpactNote featureKey={feature.key} typed={confirmKey} onTyped={setConfirmKey} />}

      <p className="text-xs text-muted-foreground">Every change is logged in the Audit Trail and reaches the apps within about 15 seconds.</p>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          disabled={!!blocked}
          saveLabel="Save rollout"
          onSave={() => save.mutate()}
          onDiscard={() => { setChoice(saved); setOrgs(scopedOrgs); setConfirmKey(""); }}
          hint={blocked ? (choice === "scoped" && orgs.length === 0 ? "Pick at least one business." : "Type the key in the note above to confirm.") : undefined}
        />
      )}
    </div>
  );
}
