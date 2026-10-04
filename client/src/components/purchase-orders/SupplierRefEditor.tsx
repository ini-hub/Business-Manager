import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// The supplier's own order / invoice number - often only known after ordering,
// so it stays editable on the PO. Renders only the value + action; the caller
// supplies the row label.
export function SupplierRefEditor({ poId, value, canEdit }: { poId: string; value?: string | null; canEdit: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/purchase-orders/${poId}/supplier-ref`, { supplierRef: draft });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", poId] });
      setEditing(false);
    } catch (e) {
      toast({ title: "Couldn't save reference", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 justify-end">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Their order / invoice no."
          aria-label="Supplier reference"
          className="h-8 w-40 font-mono text-sm"
          autoFocus
        />
        <Button size="sm" className="h-8" onClick={save} disabled={saving}>Save</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => { setDraft(value ?? ""); setEditing(false); }}>Cancel</Button>
      </div>
    );
  }
  return (
    <span className="flex items-center gap-3 justify-end">
      <span className={value ? "font-mono font-medium" : "text-muted-foreground"}>{value || "Not set"}</span>
      {canEdit && (
        <button
          type="button"
          className="text-primary text-sm font-medium hover:underline"
          onClick={() => { setDraft(value ?? ""); setEditing(true); }}
        >
          {value ? "Edit" : "Add"}
        </button>
      )}
    </span>
  );
}
