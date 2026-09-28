import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Loader2, Send } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TemplateManagerSection } from "./components/template-manager";

type Customer = { id: string; name: string; mobileNumber: string | null };
type Template = { id: string; metaTemplateName: string; bodyText: string; variableCount: number; variableLabels: Record<string, string> | null };
type Broadcast = { id: string; name: string; status: string; totalRecipients: number; sentCount: number; deliveredCount: number; failedCount: number; createdAt: string };

/**
 * Staff campaign composer: pick customers, pick an approved WhatsApp
 * template, map merge fields, send. See server/routes/broadcast.routes.ts -
 * targeting is re-checked against opt-in status server-side regardless of
 * what's selected here.
 */
export default function BroadcastsPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const storeId = currentStore?.id;

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", storeId],
    queryFn: async () => (await fetch(`/api/customers?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates", storeId],
    queryFn: async () => (await fetch(`/api/whatsapp/templates?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const { data: broadcasts = [], refetch: refetchBroadcasts } = useQuery<Broadcast[]>({
    queryKey: ["/api/whatsapp/broadcasts", storeId],
    queryFn: async () => (await fetch(`/api/whatsapp/broadcasts?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const createAndSend = useMutation({
    mutationFn: async () => {
      const createRes = await apiRequest("POST", "/api/whatsapp/broadcasts", {
        storeId,
        name,
        templateId,
        variableMapping,
        customerIds: Array.from(selectedCustomerIds),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || "Failed to create broadcast");

      const sendRes = await apiRequest("POST", `/api/whatsapp/broadcasts/${created.broadcast.id}/send`, {});
      if (!sendRes.ok) throw new Error((await sendRes.json()).error || "Failed to send broadcast");
      return created;
    },
    onSuccess: (created) => {
      toast({
        title: "Broadcast sent",
        description: created.excludedForConsent > 0
          ? `${created.excludedForConsent} selected customer(s) were excluded — no recorded WhatsApp opt-in.`
          : "Delivering now — check progress below.",
      });
      setName("");
      setTemplateId("");
      setSelectedCustomerIds(new Set());
      setVariableMapping({});
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/broadcasts", storeId] });
      refetchBroadcasts();
    },
    onError: (err: Error) => toast({ title: "Couldn't send broadcast", description: err.message, variant: "destructive" }),
  });

  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">WhatsApp Broadcasts</h1>
      </div>

      <TemplateManagerSection storeId={storeId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Broadcast</CardTitle>
          <CardDescription>Send a personalized, template-based WhatsApp message to selected customers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Campaign Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend promo" />
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setVariableMapping({}); }}>
              <SelectTrigger><SelectValue placeholder="Choose an approved template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.metaTemplateName}</SelectItem>)}
              </SelectContent>
            </Select>
            {templates.length === 0 && <p className="text-xs text-muted-foreground">No approved templates yet — submit one for approval in your Meta Business account first.</p>}
          </div>

          {selectedTemplate && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <p className="text-sm font-mono">{selectedTemplate.bodyText}</p>
              {Array.from({ length: selectedTemplate.variableCount }).map((_, i) => {
                const key = String(i + 1);
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="text-xs w-24 shrink-0">{"{{"}{key}{"}}"}  →</Label>
                    <Input
                      className="text-sm"
                      placeholder='e.g. "customer.name" or literal text'
                      value={variableMapping[key] ?? ""}
                      onChange={(e) => setVariableMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Customers ({selectedCustomerIds.size} selected)</Label>
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
              {customers.filter((c) => c.mobileNumber).map((c) => (
                <label key={c.id} className="flex items-center gap-3 p-2 text-sm cursor-pointer hover:bg-muted/50">
                  <Checkbox checked={selectedCustomerIds.has(c.id)} onCheckedChange={() => toggleCustomer(c.id)} />
                  <span>{c.name}</span>
                  <span className="text-muted-foreground text-xs ml-auto">{c.mobileNumber}</span>
                </label>
              ))}
              {customers.filter((c) => c.mobileNumber).length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No customers with a phone number yet.</p>
              )}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!name || !templateId || selectedCustomerIds.size === 0 || createAndSend.isPending}
            onClick={() => createAndSend.mutate()}
          >
            {createAndSend.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send Broadcast
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Past Broadcasts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {broadcasts.length === 0 && <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>}
          {broadcasts.map((b) => (
            <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
              <div>
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{b.totalRecipients} recipients</Badge>
                <Badge variant="outline">{b.sentCount} sent</Badge>
                <Badge variant="outline">{b.deliveredCount} delivered</Badge>
                {b.failedCount > 0 && <Badge variant="destructive">{b.failedCount} failed</Badge>}
                <Badge className="capitalize">{b.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
