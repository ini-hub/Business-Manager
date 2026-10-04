import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Lock, Trash2, Undo2, Eye, Power, PowerOff } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Rule = { id: string; kind: "route" | "screen"; methods: string; pattern: string; status: "draft" | "active"; note: string | null; featureId: string; featureKey: string };
type Impact = { totalOrgs: number; withAccess: number; trialing: number; wouldLoseAccess: number; sample: string[]; featureActive: boolean; flagOff: boolean; freeDomainsTouched: string[] };

const METHOD_OPTIONS = [
  { value: "*", label: "Any method" },
  { value: "writes", label: "Writes (POST/PUT/PATCH/DELETE)" },
  { value: "GET", label: "GET only" },
  { value: "POST", label: "POST only" },
];

async function call(method: string, url: string, body?: unknown) {
  const res = await apiRequest(method, url, body);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

/**
 * Attach an existing API route or client screen to a paid feature, no deploy.
 * Safeguards (see server/lib/gateRuleAdmin.ts): rules are saved as drafts, can
 * only point at routes/screens that exist and are not protected, and go live only
 * after the affected-organisation count is confirmed. Every change can be undone
 * from the history.
 */
export function GateRulesDialog({ feature, onClose }: { feature: any; onClose: () => void }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<"route" | "screen">("route");
  const [methods, setMethods] = useState("writes");
  const [pattern, setPattern] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{ rule: Rule; impact: Impact } | null>(null);

  const rulesKey = ["/api/admin/feature-gate-rules"];
  const { data, isLoading } = useQuery({ queryKey: rulesKey, queryFn: () => call("GET", "/api/admin/feature-gate-rules") });
  const { data: picker } = useQuery({ queryKey: ["/api/admin/feature-gate-rules/picker"], queryFn: () => call("GET", "/api/admin/feature-gate-rules/picker") });
  const { data: history } = useQuery({
    queryKey: ["/api/admin/feature-gate-rule-events", feature.key],
    queryFn: () => call("GET", "/api/admin/feature-gate-rule-events"),
  });

  const rules = ((data?.rules ?? []) as Rule[]).filter((r) => r.featureKey === feature.key);
  const baseline = ((data?.baseline ?? []) as { featureKey: string; kind: string; methods: string; pattern: string }[]).filter((b) => b.featureKey === feature.key);
  const events = ((history?.events ?? []) as any[]).filter((e) => e.featureKey === feature.key).slice(0, 15);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: rulesKey });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-gate-rule-events", feature.key] });
  };
  const fail = (title: string) => (err: Error) => toast({ title, description: err.message, variant: "destructive" });

  const create = useMutation({
    mutationFn: () => call("POST", "/api/admin/feature-gate-rules", { featureId: feature.id, kind, methods: kind === "screen" ? "*" : methods, pattern, note: note || null }),
    onSuccess: () => { toast({ title: "Saved as a draft", description: "Nothing is enforced until you preview and enable it." }); setPattern(""); setNote(""); refresh(); },
    onError: fail("Couldn't save this rule"),
  });
  const previewRule = useMutation({
    mutationFn: async (rule: Rule) => ({ rule, impact: (await call("GET", `/api/admin/feature-gate-rules/${rule.id}/preview`)).impact as Impact }),
    onSuccess: setPreview,
    onError: fail("Couldn't preview this rule"),
  });
  const enable = useMutation({
    mutationFn: ({ rule, n }: { rule: Rule; n: number }) => call("POST", `/api/admin/feature-gate-rules/${rule.id}/enable`, { confirmAffectedOrgs: n }),
    onSuccess: () => { toast({ title: "Rule is live" }); setPreview(null); refresh(); },
    onError: fail("Couldn't enable this rule"),
  });
  const disable = useMutation({
    mutationFn: (rule: Rule) => call("POST", `/api/admin/feature-gate-rules/${rule.id}/disable`),
    onSuccess: () => { toast({ title: "Rule turned off" }); refresh(); },
    onError: fail("Couldn't turn this rule off"),
  });
  const remove = useMutation({
    mutationFn: (rule: Rule) => call("DELETE", `/api/admin/feature-gate-rules/${rule.id}`),
    onSuccess: () => { toast({ title: "Rule deleted" }); refresh(); },
    onError: fail("Couldn't delete this rule"),
  });
  const revert = useMutation({
    mutationFn: (eventId: string) => call("POST", `/api/admin/feature-gate-rule-events/${eventId}/revert`),
    onSuccess: () => { toast({ title: "Change reverted", description: "The rule is back as a draft. Enable it again if you want it live." }); refresh(); },
    onError: fail("Couldn't revert this change"),
  });

  const options: string[] = kind === "route"
    ? Array.from(new Set(((picker?.routes ?? []) as { path: string }[]).map((r) => r.path)))
    : (picker?.screens ?? []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gate rules: {feature.name}</DialogTitle>
          <DialogDescription>
            Make an existing page or API route need this feature. Organisations without it see a locked page or a 402. Custom roles also need the "{feature.permissionModule ?? "no module set"}" module.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-5 text-sm">
            {baseline.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Built in (locked, from code)</Label>
                {baseline.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono text-muted-foreground"><Lock className="h-3 w-3" />{b.kind} {b.methods} {b.pattern}</div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Your rules</Label>
              {rules.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
              {rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 border rounded-lg p-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">{r.kind === "route" ? `${r.methods} ` : ""}{r.pattern}</div>
                    {r.note && <div className="text-[11px] text-muted-foreground truncate">{r.note}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status === "active" ? "live" : "draft"}</Badge>
                    {r.status === "draft" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => previewRule.mutate(r)} disabled={previewRule.isPending}><Eye className="mr-1 h-3 w-3" />Preview</Button>
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => disable.mutate(r)}><PowerOff className="mr-1 h-3 w-3" />Turn off</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {preview && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <p className="font-medium">Before this goes live</p>
                <p>
                  <b>{preview.impact.wouldLoseAccess}</b> of {preview.impact.totalOrgs} organisations would lose access to <span className="font-mono">{preview.rule.pattern}</span>.
                  {" "}{preview.impact.withAccess} hold the feature and {preview.impact.trialing} are on a trial (trials keep access).
                </p>
                {preview.impact.sample.length > 0 && <p className="text-xs text-muted-foreground">e.g. {preview.impact.sample.join(", ")}</p>}
                {preview.impact.freeDomainsTouched.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">This restricts a free area ({preview.impact.freeDomainsTouched.join(", ")}): functionality that is free today becomes paid.</p>
                )}
                {!preview.impact.featureActive && <p className="text-xs text-rose-600">This feature is inactive. Activate it before enabling.</p>}
                {preview.impact.flagOff && <p className="text-xs text-rose-600">This feature's flag is off, which blocks it for everyone. Switch it on first.</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => enable.mutate({ rule: preview.rule, n: preview.impact.wouldLoseAccess })} disabled={enable.isPending || !preview.impact.featureActive || preview.impact.flagOff}>
                    <Power className="mr-1 h-3 w-3" />Enable for {preview.impact.wouldLoseAccess} affected
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-4">
              <Label className="text-xs uppercase text-muted-foreground">Add a rule (saved as a draft)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={kind} onValueChange={(v) => { setKind(v as "route" | "screen"); setPattern(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="route">API route</SelectItem>
                    <SelectItem value="screen">Screen (page)</SelectItem>
                  </SelectContent>
                </Select>
                {kind === "route" && (
                  <Select value={methods} onValueChange={setMethods}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{METHOD_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <Select value={pattern} onValueChange={setPattern}>
                <SelectTrigger><SelectValue placeholder={kind === "route" ? "Pick an API route" : "Pick a screen"} /></SelectTrigger>
                <SelectContent className="max-h-72">{options.map((o) => <SelectItem key={o} value={o} className="font-mono text-xs">{o}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">A path covers everything beneath it. Sign-in, billing, plan lookup, webhooks and the account area are protected and not listed.</p>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional, shown in history)" />
              <Button size="sm" onClick={() => create.mutate()} disabled={!pattern || create.isPending}>Save draft</Button>
            </div>

            {events.length > 0 && (
              <div className="space-y-1 border-t pt-4">
                <Label className="text-xs uppercase text-muted-foreground">History</Label>
                {events.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      <b>{e.action}</b> {(e.after ?? e.before)?.pattern} by {e.adminEmail} <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                    </span>
                    {e.action !== "revert" && (
                      <Button size="sm" variant="ghost" onClick={() => revert.mutate(e.id)} disabled={revert.isPending}><Undo2 className="mr-1 h-3 w-3" />Undo</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
