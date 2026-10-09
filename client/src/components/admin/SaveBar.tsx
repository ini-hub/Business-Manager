import { Button } from "@/components/ui/button";

/** Appears only when there is something unsaved; sticks to the bottom of the panel. */
export function SaveBar({
  dirty, saving, disabled, saveLabel, onSave, onDiscard, hint,
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  saveLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  hint?: string;
}) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 -mx-4 sm:-mx-6 mt-4 border-t border-border bg-background/95 backdrop-blur px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2" role="region" aria-label="Unsaved changes">
      <p className="text-xs text-muted-foreground flex-1">{hint ?? "You have unsaved changes."}</p>
      <div className="grid grid-cols-2 sm:flex gap-2">
        <Button variant="outline" className="rounded-xl h-11 sm:h-9" onClick={onDiscard} disabled={saving}>Discard</Button>
        <Button className="rounded-xl h-11 sm:h-9" onClick={onSave} disabled={saving || disabled}>{saving ? "Saving…" : saveLabel}</Button>
      </div>
    </div>
  );
}
