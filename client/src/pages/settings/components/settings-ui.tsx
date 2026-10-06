import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/loader";

/** Building blocks shared by the settings pages: a titled section card, an input with a unit on each side, and a save row. */
export function Card({ title, hint, children, id }: { title?: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      {(title || hint) && (
        <div>
          {title && <h3 className="font-semibold">{title}</h3>}
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Money({ id, value, onChange, suffix, prefix = "₦", testId }: { id: string; value: number; onChange: (n: number) => void; suffix: string; prefix?: string; testId?: string }) {
  return (
    <div className="flex">
      {prefix && <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">{prefix}</span>}
      <Input id={id} type="number" min={0} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className={cn("rounded-none", !prefix && "rounded-l-md")} data-testid={testId} />
      <span className="flex items-center whitespace-nowrap rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">{suffix}</span>
    </div>
  );
}

export function SaveBar({ onSave, pending, label, disabled, note }: { onSave: () => void; pending: boolean; label: string; disabled?: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-end gap-3">
      {note && <p className="text-sm text-destructive">{note}</p>}
      <Button onClick={onSave} disabled={pending || disabled}>
        {pending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

