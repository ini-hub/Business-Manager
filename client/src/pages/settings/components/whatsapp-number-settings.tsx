import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, HelpCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Spinner } from "@/components/ui/loader";

const MASK = "••••••••••••••••";

type WhatsAppNumber = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  status: string;
  qualityRating: string | null;
  accessTokenSet: boolean;
  updatedAt: string;
} | null;

type DiscoveredPhoneNumber = { phoneNumberId: string; displayPhoneNumber: string; verifiedName: string; qualityRating: string | null };
type DiscoveredWaba = { wabaId: string; wabaName: string; businessName: string; phoneNumbers: DiscoveredPhoneNumber[] };

/**
 * Lets an owner/manager connect this store's WhatsApp number, or change it
 * later. Rather than making them find and type phone_number_id / waba_id
 * (Meta internal IDs, not the phone number itself), they paste one access
 * token and pick their real number from a discovered list - see
 * server/lib/metaGraphDiscovery.ts and server/routes/whatsapp-number.routes.ts.
 */
export function WhatsAppNumberSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const storeId = currentStore?.id;

  const { data, isLoading, refetch } = useQuery<WhatsAppNumber>({
    queryKey: ["/api/stores", storeId, "whatsapp-number"],
    queryFn: async () => (await fetch(`/api/stores/${storeId}/whatsapp-number`)).json(),
    enabled: !!storeId,
  });

  const [accessToken, setAccessToken] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredWaba[] | null>(null);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState("");

  useEffect(() => {
    if (data) setAccessToken(data.accessTokenSet ? MASK : "");
  }, [data]);

  const discover = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/stores/${storeId}/whatsapp-number/discover`, { accessToken });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't discover numbers");
      return body.wabas as DiscoveredWaba[];
    },
    onSuccess: (wabas) => {
      setDiscovered(wabas);
      setSelectedPhoneNumberId("");
    },
    onError: (err: Error) => toast({ title: "Couldn't find your numbers", description: err.message, variant: "destructive" }),
  });

  const connect = useMutation({
    mutationFn: async () => {
      const selected = discovered?.flatMap((w) => w.phoneNumbers.map((n) => ({ ...n, wabaId: w.wabaId }))).find((n) => n.phoneNumberId === selectedPhoneNumberId);
      if (!selected) throw new Error("Pick a number first");

      const res = await apiRequest("PUT", `/api/stores/${storeId}/whatsapp-number`, {
        phoneNumberId: selected.phoneNumberId,
        wabaId: selected.wabaId,
        displayPhoneNumber: selected.displayPhoneNumber,
        accessToken,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save WhatsApp number");
      return body;
    },
    onSuccess: () => {
      toast({ title: "WhatsApp number connected", description: "Takes effect immediately for new inbound messages." });
      setDiscovered(null);
      setSelectedPhoneNumberId("");
      queryClient.invalidateQueries({ queryKey: ["/api/stores", storeId, "whatsapp-number"] });
      refetch();
    },
    onError: (err: Error) => toast({ title: "Couldn't connect number", description: err.message, variant: "destructive" }),
  });

  if (!currentStore) return null;

  const allNumbers = discovered?.flatMap((w) => w.phoneNumbers.map((n) => ({ ...n, businessName: w.businessName, wabaName: w.wabaName }))) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> WhatsApp Number
          </CardTitle>
          {data && <Badge variant={data.status === "active" ? "default" : "outline"} className="capitalize">{data.status.replace("_", " ")}</Badge>}
        </div>
        <CardDescription>
          Connect the WhatsApp number your customers message. Paste your access token and we'll find your number for you — no need to
          look up or type any Meta IDs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            {data && (
              <div className="flex items-center gap-2 text-sm rounded-lg border bg-muted/30 p-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Currently connected: <span className="font-medium">{data.displayPhoneNumber || data.phoneNumberId}</span></span>
              </div>
            )}

            <Accordion type="single" collapsible className="rounded-lg border px-3">
              <AccordionItem value="how-to" className="border-0">
                <AccordionTrigger className="text-sm py-3">
                  <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4" /> How do I get an access token?</span>
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
                  <ol className="list-decimal ml-4 space-y-2">
                    <li>Go to <span className="font-medium text-foreground">Meta Business Suite</span> (business.facebook.com) for the account that owns your WhatsApp number, or the app you registered on <span className="font-medium text-foreground">developers.facebook.com</span>.</li>
                    <li>Under <span className="font-medium text-foreground">Business Settings → Users → System Users</span>, create a system user (or use an existing one) and assign it <span className="font-medium text-foreground">full control</span> of your WhatsApp Business Account.</li>
                    <li>Click <span className="font-medium text-foreground">Generate New Token</span> on that system user, select your app, and check the <span className="font-medium text-foreground">whatsapp_business_management</span> and <span className="font-medium text-foreground">whatsapp_business_messaging</span> permissions.</li>
                    <li>Copy the token it generates — it's shown only once — and paste it below, then click <span className="font-medium text-foreground">Find My Numbers</span>.</li>
                  </ol>
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/business-management-api/get-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Meta's official guide <ExternalLink className="h-3 w-3" />
                  </a>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Access Token</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => { setAccessToken(e.target.value); setDiscovered(null); }}
                  placeholder="Paste your system-user access token"
                  className="font-mono text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={() => discover.mutate()}
                  disabled={!accessToken || accessToken === MASK || discover.isPending}
                >
                  {discover.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                  Find My Numbers
                </Button>
              </div>
              {accessToken === MASK && (
                <p className="text-xs text-muted-foreground">A token is already saved. Paste a new one to change the connected number.</p>
              )}
            </div>

            {allNumbers.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Choose your number</Label>
                <RadioGroup value={selectedPhoneNumberId} onValueChange={setSelectedPhoneNumberId} className="space-y-2">
                  {allNumbers.map((n) => (
                    <label key={n.phoneNumberId} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                      <RadioGroupItem value={n.phoneNumberId} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{n.displayPhoneNumber}</p>
                        <p className="text-xs text-muted-foreground">{n.verifiedName} · {n.businessName}</p>
                      </div>
                      {n.qualityRating && <Badge variant="outline" className="text-xs">{n.qualityRating}</Badge>}
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}

            <Separator />

            <div className="flex justify-end">
              <Button
                onClick={() => connect.mutate()}
                disabled={!selectedPhoneNumberId || connect.isPending}
              >
                {connect.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                Connect Number
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
