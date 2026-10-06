import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, Clock, CreditCard, MessageSquare, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/loader";

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

  // ---- Grace period ----
  const { data: graceData, isLoading: graceLoading } = useQuery<{ graceDays: number }>({
    queryKey: ["/api/admin/platform-config/grace-days"],
  });
  const [graceDays, setGraceDays] = useState<string>("");
  useEffect(() => {
    if (graceData) setGraceDays(String(graceData.graceDays));
  }, [graceData]);

  const saveGraceDays = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/grace-days", { graceDays: Number(graceDays) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update grace period");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config/grace-days"] });
      toast({ title: "Grace period updated", description: "Applies to every business from now on, including ones already past their trial." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update grace period", description: err.message, variant: "destructive" }),
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

  // ---- Export branding ("Powered by" line) ----
  const { data: brandData, isLoading: brandLoading } = useQuery<{ enabled: boolean; text: string }>({
    queryKey: ["/api/admin/platform-config/export-branding"],
  });
  const [brandEnabled, setBrandEnabled] = useState(true);
  const [brandText, setBrandText] = useState("");
  useEffect(() => {
    if (brandData) {
      setBrandEnabled(brandData.enabled);
      setBrandText(brandData.text);
    }
  }, [brandData]);

  const saveBranding = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/export-branding", { enabled: brandEnabled, text: brandText });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update export branding");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config/export-branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/export-branding"] });
      toast({ title: "Export branding updated", description: "Applies to documents generated from now on." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update export branding", description: err.message, variant: "destructive" }),
  });

  // ---- WhatsApp Business Platform (Cloud API) ----
  // The ONE Meta Tech Provider app this platform uses to receive webhooks for
  // every connected business's WhatsApp number - distinct from a business's
  // own number/WABA (connected separately, per store) and from the
  // "SMS & WhatsApp" OTP-channel toggle further down.
  const { data: waPlatformData, isLoading: waPlatformLoading } = useQuery<{ isActive: boolean; appSecretSet: boolean; verifyTokenSet: boolean }>({
    queryKey: ["/api/admin/platform-config/whatsapp"],
  });

  const [waActive, setWaActive] = useState(false);
  const [waAppSecret, setWaAppSecret] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");

  useEffect(() => {
    if (waPlatformData) {
      setWaActive(waPlatformData.isActive);
      setWaAppSecret(waPlatformData.appSecretSet ? MASK : "");
      setWaVerifyToken(waPlatformData.verifyTokenSet ? MASK : "");
    }
  }, [waPlatformData]);

  const saveWhatsAppPlatformConfig = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/whatsapp", {
        isActive: waActive,
        appSecret: waAppSecret,
        verifyToken: waVerifyToken,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update WhatsApp platform configuration");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config/whatsapp"] });
      toast({ title: "WhatsApp platform configuration updated", description: "Takes effect immediately - no restart needed." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update WhatsApp platform configuration", description: err.message, variant: "destructive" }),
  });

  // ---- SMS/WhatsApp configuration ----
  const { data: smsData, isLoading: smsLoading } = useQuery<{ smsEnabled: boolean; whatsappEnabled: boolean }>({
    queryKey: ["/api/admin/platform-config/sms"],
  });

  const [smsEnabled, setSmsEnabled] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);

  useEffect(() => {
    if (smsData) {
      setSmsEnabled(smsData.smsEnabled);
      setWhatsappEnabled(smsData.whatsappEnabled);
    }
  }, [smsData]);

  const saveSmsConfig = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/platform-config/sms", { smsEnabled, whatsappEnabled });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to update SMS configuration");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/platform-config/sms"] });
      toast({ title: "SMS configuration updated", description: "Changes take effect immediately for password reset flows." });
    },
    onError: (err: Error) => toast({ title: "Couldn't update SMS configuration", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">Platform Settings</h1>
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
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
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
                {saveTrialDays.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Grace Period
          </CardTitle>
          <CardDescription>
            Days of full access after a trial ends or a renewal fails, with a countdown banner, before the business drops to the free
            tier (soft lock). Nothing is deleted and checkout and exports are never blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          {graceLoading ? (
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="grace-days">Days</Label>
                <Input id="grace-days" type="number" min={0} max={90} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className="w-32" />
              </div>
              <Button onClick={() => saveGraceDays.mutate()} disabled={saveGraceDays.isPending}>
                {saveGraceDays.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
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
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
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
                  {saveCredentials.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                  Save Credentials
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" /> WhatsApp Business Platform
          </CardTitle>
          <CardDescription>
            This platform's own Meta app credentials, used to receive WhatsApp webhooks for every connected business's number. Each
            business connects its own WhatsApp number separately - this only configures the shared app secret and webhook verify token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {waPlatformLoading ? (
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Switch id="wa-active" checked={waActive} onCheckedChange={setWaActive} />
                <Label htmlFor="wa-active" className="text-sm">Active</Label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">App Secret</Label>
                  <Input type="password" value={waAppSecret} onChange={(e) => setWaAppSecret(e.target.value)} placeholder="Enter Meta app secret" className="font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Webhook Verify Token</Label>
                  <Input type="password" value={waVerifyToken} onChange={(e) => setWaVerifyToken(e.target.value)} placeholder="Enter webhook verify token" className="font-mono text-sm" />
                </div>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button onClick={() => saveWhatsAppPlatformConfig.mutate()} disabled={saveWhatsAppPlatformConfig.isPending}>
                  {saveWhatsAppPlatformConfig.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                  Save WhatsApp Configuration
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> SMS & WhatsApp
          </CardTitle>
          <CardDescription>
            Enable SMS and WhatsApp channels for password reset notifications and other messaging flows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {smsLoading ? (
            <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">SMS</Label>
                    <p className="text-xs text-muted-foreground">Send reset codes via SMS text message</p>
                  </div>
                  <Switch id="sms-enabled" checked={smsEnabled} onCheckedChange={setSmsEnabled} />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">WhatsApp</Label>
                    <p className="text-xs text-muted-foreground">Send reset codes via WhatsApp messages</p>
                  </div>
                  <Switch id="whatsapp-enabled" checked={whatsappEnabled} onCheckedChange={setWhatsappEnabled} />
                </div>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button onClick={() => saveSmsConfig.mutate()} disabled={saveSmsConfig.isPending}>
                  {saveSmsConfig.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                  Save SMS Configuration
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" /> Export branding
          </CardTitle>
          <CardDescription>
            A "powered by" line printed on receipts, quotes, payslips and exported PDF reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {brandLoading ? (
            <Spinner className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                <Label htmlFor="brand-enabled" className="text-sm font-semibold">Show on exported documents</Label>
                <Switch id="brand-enabled" checked={brandEnabled} onCheckedChange={setBrandEnabled} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand-text">Text</Label>
                <Input id="brand-text" value={brandText} maxLength={80} disabled={!brandEnabled} onChange={(e) => setBrandText(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending}>
                  {saveBranding.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                  Save
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
