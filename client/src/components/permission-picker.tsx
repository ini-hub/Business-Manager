import { Check, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PERMISSIONS_BY_MODULE } from "@shared/permissions";

const area = (m: string) => m.replace(/ & /g, " and ");

export interface PermissionPickerProps {
  /** Page keys currently ticked (expand module names with expandPermissions first). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Pages the editor may not tick (a manager can't hand out access they lack). */
  disabledKeys?: ReadonlySet<string>;
  readOnly?: boolean;
  /** Paid features under a module, shown beneath its heading with whether the business holds them. */
  featuresByModule?: Map<string, { key: string; name: string; granted: boolean }[]>;
}

/**
 * The page-by-page access picker shared by the super-admin Roles screen and the business role
 * form. Pages every role has (the dashboard, a person's own attendance and pay) are shown as
 * always on rather than as choices.
 */
export function PermissionPicker({ value, onChange, disabledKeys, readOnly, featuresByModule }: PermissionPickerProps) {
  const selected = new Set(value);
  const toggle = (key: string) => onChange(selected.has(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div className="space-y-4">
      {PERMISSIONS_BY_MODULE.map(({ module, permissions }) => {
        const choices = permissions.filter((p) => !p.selfService);
        const always = permissions.filter((p) => p.selfService);
        const editable = choices.filter((p) => !disabledKeys?.has(p.key));
        const allOn = editable.length > 0 && editable.every((p) => selected.has(p.key));
        const setModule = (on: boolean) => {
          const keys = new Set(editable.map((p) => p.key));
          const rest = value.filter((k) => !keys.has(k));
          onChange(on ? [...rest, ...Array.from(keys)] : rest);
        };
        return (
          <div key={module} className="rounded-lg border bg-muted/10 p-3" data-testid={`perm-module-${module}`}>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{area(module)}</h4>
              {!readOnly && editable.length > 1 && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setModule(!allOn)}>
                  {allOn ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            {(featuresByModule?.get(module) ?? []).map((f) => (
              <p key={f.key} className={`mt-1 flex items-center gap-1 text-[11px] ${f.granted ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                {f.granted ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {f.name}
                {!f.granted && " (not in your plan)"}
              </p>
            ))}
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {choices.map((p) => {
                const disabled = readOnly || disabledKeys?.has(p.key);
                return (
                  <label
                    key={p.key}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`}
                    title={disabledKeys?.has(p.key) ? "You don't have this access yourself, so you can't give it." : undefined}
                  >
                    <Checkbox checked={selected.has(p.key)} disabled={disabled} onCheckedChange={() => toggle(p.key)} aria-label={p.label} data-testid={`perm-${p.key}`} />
                    <span>{p.label}</span>
                  </label>
                );
              })}
              {always.map((p) => (
                <div key={p.key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  <span>{p.label}</span>
                  <span className="text-[11px]">(every role)</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
