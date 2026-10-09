import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Download, Handshake, Send, Check, X, Link2Off, Scale, Mail, PackageOpen, Award } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BADGE_DEFINITIONS } from "@shared/gamification/badges";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { PARTNER_STATUS_LABEL, PARTNER_STATUS_TONE, SETTLEMENT_LABEL } from "@/lib/partner-transfers";

interface Partnership {
  id: string;
  status: "pending" | "active" | "declined" | "revoked";
  direction: "outgoing" | "incoming";
  tradeCreditLimit: number | null;
  partner: { id: string; name: string; logoUrl: string | null };
  reputation?: { score: number | null; label: "new" | "reliable" | "good" | "needs_attention"; completedTransfers: number };
}

interface Engagement {
  badges: string[];
  points: number;
  reputation: { score: number | null; label: string; completedTransfers: number };
}

const REPUTATION_TEXT: Record<string, string> = { new: "New partner", reliable: "Reliable", good: "Good standing", needs_attention: "Needs attention" };
const REPUTATION_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = { new: "outline", reliable: "default", good: "secondary", needs_attention: "destructive" };

function ReputationChip({ r }: { r?: Partnership["reputation"] }) {
  if (!r) return null;
  return (
    <Badge variant={REPUTATION_TONE[r.label] ?? "outline"} title={r.score == null ? "Not enough history yet" : `${r.score}% of receipts complete and balances cleared on time`}>
      {REPUTATION_TEXT[r.label] ?? r.label}{r.score != null ? ` · ${r.score}` : ""}
    </Badge>
  );
}

interface PartnerTransferRow {
  id: string;
  kind: "send" | "request";
  side: "sender" | "receiver";
  yourTurn?: boolean;
  status: string;
  settlementType: string;
  // Absent for store staff, who are never shown figures.
  agreedTotal?: number;
  fromOrgName: string;
  toOrgName: string;
  fromStoreName: string;
  toStoreName: string;
  createdAt: string;
  obligation?: { amountDue: number; amountSettled: number; status: string } | null;
}

export default function PartnersPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const currency = currentStore?.currency || "NGN";
  const [code, setCode] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareIds, setShareIds] = useState<Set<string>>(new Set());
  const storeId = currentStore?.id && currentStore.id !== "all" ? currentStore.id : "";

  const { data } = useQuery<{ code: string; partnerships: Partnership[] }>({
    queryKey: ["/api/partners"],
    queryFn: async () => (await apiRequest("GET", "/api/partners")).json(),
    enabled: !isStaff,
  });
  // Staff see only their own store's transfers, so they must name it; managers and owners see the whole business.
  const staffStoreId = currentStore?.id && currentStore.id !== "all" ? currentStore.id : "";
  const { data: transfers = [] } = useQuery<PartnerTransferRow[]>({
    queryKey: ["/api/partner-transfers", isStaff ? staffStoreId : "all"],
    queryFn: async () => (await apiRequest("GET", isStaff ? `/api/partner-transfers?storeId=${staffStoreId}` : "/api/partner-transfers")).json(),
    enabled: !isStaff || !!staffStoreId,
  });

  const { data: engagement } = useQuery<Engagement>({
    queryKey: ["/api/partners/engagement"],
    queryFn: async () => (await apiRequest("GET", "/api/partners/engagement")).json(),
    enabled: !isStaff,
  });
  const { data: sharedNow } = useQuery<{ inventoryIds: string[] }>({
    queryKey: ["/api/partners/shared-items", storeId],
    queryFn: async () => (await apiRequest("GET", `/api/partners/shared-items?storeId=${storeId}`)).json(),
    enabled: !isStaff && !!storeId, // managers and owners choose what is shared; staff are not asked
  });
  const { data: ownProducts = [] } = useQuery<{ id: string; name: string; type: string; isDeleted: boolean; quantity: number }[]>({
    queryKey: ["/api/inventory", storeId, "partner-share"],
    queryFn: async () => fetchAllPages<any>(`/api/inventory?storeId=${storeId}`),
    enabled: shareOpen && !!storeId,
  });

  const partnerships = data?.partnerships ?? [];
  const incoming = partnerships.filter((p) => p.status === "pending" && p.direction === "incoming");
  const outgoing = partnerships.filter((p) => p.status === "pending" && p.direction === "outgoing");
  const active = partnerships.filter((p) => p.status === "active");

  const done = () => queryClient.invalidateQueries({ queryKey: ["/api/partners"] });
  const onError = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const request = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partners/request", { code })).json(),
    onSuccess: (p: { status: string }) => {
      setCode("");
      done();
      toast(p.status === "active"
        ? { title: "You are now partners", description: "They had already asked to connect with you." }
        : { title: "Request sent", description: "They will see it the next time they open Partners." });
    },
    onError: onError("Could not send request"),
  });
  const respond = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => (await apiRequest("POST", `/api/partners/${v.id}/respond`, { accept: v.accept })).json(),
    onSuccess: done,
    onError: onError("Could not answer request"),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/partners/${id}/revoke`)).json(),
    onSuccess: () => { done(); toast({ title: "Partnership ended", description: "Open transfers and any balances are kept." }); },
    onError: onError("Could not end partnership"),
  });

  const invite = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partners/invite", { email: inviteEmail })).json(),
    onSuccess: (r: { invited: string }) => { setInviteEmail(""); toast({ title: "Invitation sent", description: `${r.invited} will get an email with your partner code.` }); },
    onError: onError("Could not send invitation"),
  });
  const saveShared = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/partners/shared-items", { storeId, inventoryIds: Array.from(shareIds) })).json(),
    onSuccess: (r: { shared: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/partners/shared-items"] });
      setShareOpen(false);
      toast({ title: "Saved", description: r.shared === 0 ? "Partners can no longer see any of your items." : `Partners can now see and request ${r.shared} of your items.` });
    },
    onError: onError("Could not save"),
  });

  const copyCode = async () => {
    if (!data?.code) return;
    try {
      await navigator.clipboard.writeText(data.code);
      toast({ title: "Code copied", description: "Share it with a business you trade with." });
    } catch {
      toast({ title: "Copy failed", description: data.code });
    }
  };

  if (isStaff) {
    const waiting = transfers.filter((t) => t.side === "receiver" && t.status === "shipped");
    return (
      <div className="space-y-6">
        <PageHeader compact title="Partner deliveries" description="Stock coming to and leaving your store. Confirm deliveries when they arrive." />
        {!staffStoreId && <p className="py-8 text-center text-sm text-muted-foreground">Choose your store to see its deliveries.</p>}
        {waiting.length > 0 && (
          <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="text-deliveries-waiting">
            {waiting.length === 1 ? "1 delivery is on its way to you." : `${waiting.length} deliveries are on their way to you.`} Open it to confirm what arrived.
          </p>
        )}
        <div className="space-y-2">
          {staffStoreId && transfers.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No partner transfers for this store yet.</p>}
          {transfers.map((t) => {
            const other = t.side === "sender" ? `${t.toOrgName} · ${t.toStoreName}` : `${t.fromOrgName} · ${t.fromStoreName}`;
            return (
              <button key={t.id} type="button" onClick={() => setLocation(`/partners/transfers/${t.id}`)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left hover:bg-muted/50" data-testid={`partner-transfer-${t.id}`}>
                <div>
                  <div className="font-medium">{t.kind === "request" ? (t.side === "sender" ? "Requested by" : "Requested from") : (t.side === "sender" ? "Sent to" : "Received from")} {other}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</div>
                </div>
                <Badge variant={PARTNER_STATUS_TONE[t.status] ?? "outline"}>{PARTNER_STATUS_LABEL[t.status] ?? t.status}</Badge>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        title="Partners"
        description="Trusted businesses you can share stock with, and a record of what is owed either way."
        actions={
          <>
            <Button variant="outline" disabled={!storeId} onClick={() => { setShareIds(new Set(sharedNow?.inventoryIds ?? [])); setShareSearch(""); setShareOpen(true); }} data-testid="button-share-items">
              <PackageOpen className="mr-2 h-4 w-4" /> Items I share
            </Button>
            <Button variant="outline" onClick={() => setLocation("/partners/ledger")} data-testid="button-partner-ledger">
              <Scale className="mr-2 h-4 w-4" /> Partner ledger
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connect with a business</CardTitle>
          <CardDescription>Enter their partner code, or give them yours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Your code</span>
            <code className="rounded bg-muted px-2 py-1 text-sm font-semibold tracking-wider" data-testid="text-partner-code">{data?.code ?? "…"}</code>
            <Button size="sm" variant="ghost" onClick={copyCode} disabled={!data?.code}><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) request.mutate(); }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="partner-code">Their partner code</Label>
              <Input id="partner-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PT-XXXXXX" autoCapitalize="characters" />
            </div>
            <Button type="submit" disabled={!code.trim() || request.isPending} data-testid="button-request-partner">
              <Handshake className="mr-2 h-4 w-4" /> Send request
            </Button>
          </form>
          <form
            className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end"
            onSubmit={(e) => { e.preventDefault(); if (inviteEmail.trim()) invite.mutate(); }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Not on the platform yet? Invite them by email</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="owner@theirbusiness.com" />
            </div>
            <Button type="submit" variant="outline" disabled={!inviteEmail.trim() || invite.isPending} data-testid="button-invite-partner">
              <Mail className="mr-2 h-4 w-4" /> Send invitation
            </Button>
          </form>
        </CardContent>
      </Card>

      {engagement && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Award className="h-4 w-4" /> Your standing</CardTitle>
            <CardDescription>Partners see this before they trade with you.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <ReputationChip r={engagement.reputation as Partnership["reputation"]} />
            <span className="text-sm text-muted-foreground">{engagement.points} points</span>
            {engagement.badges.length === 0 && <span className="text-sm text-muted-foreground">Complete a transfer to earn your first badge.</span>}
            {engagement.badges.map((k) => {
              const def = BADGE_DEFINITIONS.find((b) => b.key === k);
              return def ? <Badge key={k} variant="secondary" title={def.description}>{def.label}</Badge> : null;
            })}
          </CardContent>
        </Card>
      )}

      {incoming.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Requests waiting for you</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {incoming.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <span className="font-medium">{p.partner.name}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respond.mutate({ id: p.id, accept: true })} disabled={respond.isPending}><Check className="mr-1 h-4 w-4" /> Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: p.id, accept: false })} disabled={respond.isPending}><X className="mr-1 h-4 w-4" /> Decline</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="partners">
        <TabsList>
          <TabsTrigger value="partners">Partners ({active.length})</TabsTrigger>
          <TabsTrigger value="transfers">Transfers ({transfers.length}){transfers.some((t) => t.yourTurn) ? ` · ${transfers.filter((t) => t.yourTurn).length} for you` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="partners" className="space-y-2">
          {active.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No partners yet. Share your code or enter theirs above.</p>}
          {active.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" data-testid={`partner-${p.id}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2 font-medium">{p.partner.name} <ReputationChip r={p.reputation} /></div>
                {p.tradeCreditLimit != null && <div className="text-xs text-muted-foreground">Credit limit {formatCurrency(p.tradeCreditLimit, currency)}</div>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setLocation(`/partners/transfers/new?partner=${p.partner.id}`)}><Send className="mr-1 h-4 w-4" /> Send stock</Button>
                <Button size="sm" variant="outline" onClick={() => setLocation(`/partners/transfers/new?partner=${p.partner.id}&mode=request`)} data-testid={`button-request-from-${p.id}`}><Download className="mr-1 h-4 w-4" /> Request stock</Button>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(p.id)} disabled={revoke.isPending}><Link2Off className="mr-1 h-4 w-4" /> End</Button>
              </div>
            </div>
          ))}
          {outgoing.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
              <span>{p.partner.name} <span className="text-xs text-muted-foreground">· waiting for their answer</span></span>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(p.id)} disabled={revoke.isPending}>Withdraw</Button>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="transfers" className="space-y-2">
          {transfers.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No partner transfers yet.</p>}
          {transfers.map((t) => {
            const other = t.side === "sender" ? `${t.toOrgName} · ${t.toStoreName}` : `${t.fromOrgName} · ${t.fromStoreName}`;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setLocation(`/partners/transfers/${t.id}`)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left hover:bg-muted/50"
                data-testid={`partner-transfer-${t.id}`}
              >
                <div>
                  <div className="font-medium">{t.kind === "request" ? (t.side === "sender" ? "Requested by" : "Requested from") : (t.side === "sender" ? "Sent to" : "Received from")} {other}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                    {t.agreedTotal != null && ` · ${formatCurrency(t.agreedTotal, currency)}`}
                    {t.settlementType && ` · ${SETTLEMENT_LABEL[t.settlementType]}`}
                    {t.obligation?.status === "open" && ` · ${formatCurrency(t.obligation.amountDue - t.obligation.amountSettled, currency)} open`}
                  </div>
                </div>
                <span className="flex items-center gap-2">
                  {t.yourTurn && <Badge variant="default" data-testid={`your-turn-${t.id}`}>Your turn</Badge>}
                  <Badge variant={PARTNER_STATUS_TONE[t.status] ?? "outline"}>{PARTNER_STATUS_LABEL[t.status] ?? t.status}</Badge>
                </span>
              </button>
            );
          })}
        </TabsContent>
      </Tabs>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Items I share with partners</DialogTitle>
            <DialogDescription>Partners can see and request only what you tick. They see whether an item is in stock, never how many or what it cost you.</DialogDescription>
          </DialogHeader>
          <Input value={shareSearch} onChange={(e) => setShareSearch(e.target.value)} placeholder="Search your products…" aria-label="Search your products" />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {ownProducts
              .filter((i) => i.type === "product" && !i.isDeleted && i.name.toLowerCase().includes(shareSearch.trim().toLowerCase()))
              .map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted/50">
                  <Checkbox
                    checked={shareIds.has(i.id)}
                    onCheckedChange={(on) => setShareIds((cur) => { const n = new Set(cur); if (on) n.add(i.id); else n.delete(i.id); return n; })}
                  />
                  <span className="flex-1 text-sm">{i.name}</span>
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>Cancel</Button>
            <Button onClick={() => saveShared.mutate()} disabled={saveShared.isPending}>Save ({shareIds.size} shared)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
