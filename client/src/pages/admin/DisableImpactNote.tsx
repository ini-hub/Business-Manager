import { disableImpact, disableRisk, getFeatureDef } from "@shared/features";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** True when the form may be saved as "off": no confirmation needed, or the key has been typed. */
export function disableAllowed(featureKey: string, typed: string): boolean {
  const risk = disableRisk(featureKey);
  return risk === "none" || (risk === "confirm" && typed.trim() === featureKey);
}

/**
 * What switching a feature off takes with it. Core features (free ones, or ones other features depend on) also
 * ask for the key to be typed; the server enforces the same rule, so this is the explanation, not the only guard.
 */
export function DisableImpactNote({ featureKey, typed, onTyped }: { featureKey: string; typed: string; onTyped: (v: string) => void }) {
  const def = getFeatureDef(featureKey);
  if (!def) return null;
  const risk = disableRisk(featureKey);
  const { screens, domains, alsoOff } = disableImpact(featureKey);

  if (risk === "blocked") {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 p-3 text-xs" data-testid="disable-blocked">
        <p className="font-semibold text-rose-900 dark:text-rose-200">{def.name} can't be switched off.</p>
        <p className="text-muted-foreground">Sign-in, billing, settings and navigation depend on it. Leave it active.</p>
      </div>
    );
  }

  const core = risk === "confirm";
  return (
    <div
      className={`rounded-md border p-3 text-xs space-y-1 ${core ? "border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800" : "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800"}`}
      data-testid="disable-impact"
    >
      <p className={`font-semibold ${core ? "text-rose-900 dark:text-rose-200" : "text-amber-900 dark:text-amber-200"}`}>
        {core ? `${def.name} is a core feature. Switching it off removes it for every business, immediately.` : "Switching this off removes it for every business, immediately."}
      </p>
      {screens.length > 0 && <p>Pages hidden: <span className="font-mono">{screens.join(", ")}</span></p>}
      {domains.length > 0 && <p>API blocked: <span className="font-mono">{domains.map((d) => `/api/${d}`).join(", ")}</span></p>}
      {alsoOff.length > 0 && <p>Also switched off: {alsoOff.map((f) => f.name).join(", ")}</p>}
      <p className="text-muted-foreground">Other pages that use this feature's data will show errors where they call it.</p>
      {core && (
        <div className="space-y-1 pt-1">
          <Label className="text-xs">Type <span className="font-mono">{featureKey}</span> to confirm</Label>
          <Input value={typed} onChange={(e) => onTyped(e.target.value)} className="font-mono text-xs h-8" data-testid="input-confirm-disable" />
        </div>
      )}
    </div>
  );
}
