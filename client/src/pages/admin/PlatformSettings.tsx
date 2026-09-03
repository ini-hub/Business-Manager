import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, Clock, CreditCard, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

const MASK = "••••••••••••••••";

type PlatformCredential = {
  provider: string;
  isActive: boolean;
  publicKey: string | null;
  secretKeySet: boolean;
  webhookSecretSet: boolean;
  updatedAt: string;
};

/**
 * The two previously-missing "spot to configure X" gaps: trial length
 * (server/lib/trial.ts's TRIAL_DAYS was a hardcoded constant with no admin
 * control) and the platform's own payment gateway credentials (only
 * rotatable by editing .env and redeploying). See server/routes-admin.ts's
 * "PLATFORM SETTINGS ENDPOINTS" section.
 */
export default function PlatformSettings() {
  const { toast } = useToast();

  // ---- Trial length ----
  const { data: trialData, isLoading: trialLoading } = useQuery<{ trialDays: number }>({
    queryKey: ["/api/admin/platform-config/trial-days"],
  });
  const [trialDays, setTrialDays] = useState<string>("");
  useEffect(() => {
    if (trialData) setTrialDays(String(trialData.trialDays));
  }, [trialData]);

  const saveTrialDays = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/trial-days", { trialDays: Number(trialDays) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update trial length");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config/trial-days"] });
      toast({ title: "Trial length updated", description: "Applies to businesses signing up from now on - existing trials are unaffected." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update trial length", description: err.message, variant: "destructive" }),
  });

  // ---- Payment gateway credentials ----
  const { data: credData, isLoading: credLoading } = useQuery<{ credentials: PlatformCredential[] }>({
    queryKey: ["/api/admin/platform-payment-credentials"],
  });
  const paystack = credData?.credentials.find((c) => c.provider === "paystack");

  const [isActive, setIsActive] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  useEffect(() => {
    if (paystack) {
      setIsActive(paystack.isActive);
      setPublicKey(paystack.publicKey || "");
      setSecretKey(paystack.secretKeySet ? MASK : "");
      setWebhookSecret(paystack.webhookSecretSet ? MASK : "");
    }
  }, [paystack]);

  const saveCredentials = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-payment-credentials/paystack", {
        isActive,
        publicKey,
        secretKey,
        webhookSecret,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update payment credentials");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-payment-credentials"] });
      toast({ title: "Payment credentials updated", description: "Takes effect immediately - no restart needed." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update payment credentials", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Platform Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Trial Length
          </CardTitle>
          <CardDescription>How many days a new business gets full access to every feature, free. Only affects new signups.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          {trialLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="trial-days">Days</Label>
                <Input
                  id="trial-days"
                  type="number"
                  min={1}
                  max={365}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="w-32"
                />
              </div>
              <Button onClick={() => saveTrialDays.mutate()} disabled={saveTrialDays.isPending}>
                {saveTrialDays.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" /> Platform Payment Gateway
          </CardTitle>
          <CardDescription>
            The Paystack credentials used to charge businesses for their subscription (separate from a business's own store payment
            integrations). Rotating a key here takes effect immediately, no redeploy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {credLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Switch id="cred-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="cred-active" className="text-sm">Active</Label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Public Key</Label>
                  <Input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="pk_live_..." className="font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Secret Key</Label>
                  <Input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_live_..." className="font-mono text-sm" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-sm font-semibold">Webhook Secret</Label>
                  <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="Enter webhook secret" className="font-mono text-sm" />
                </div>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button onClick={() => saveCredentials.mutate()} disabled={saveCredentials.isPending}>
                  {saveCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Credentials
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
