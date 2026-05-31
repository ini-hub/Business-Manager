import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CreditCard, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export function StoreIntegrationsSection() {
  const { currentStore } = useStore();
  const { toast } = useToast();

  const { data: integrations = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/stores", currentStore?.id, "integrations"],
    enabled: !!currentStore?.id,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", `/api/stores/${currentStore?.id}/integrations`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Integration settings updated successfully" });
      refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Failed to save integration",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const [activeTab, setActiveTab] = useState<"flutterwave" | "stripe" | "paystack" | "twilio" | "quickbooks">("flutterwave");
  
  // Custom states for key configurations
  const [isActive, setIsActive] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [currency, setCurrency] = useState("NGN");

  const activeConfig = integrations.find((int) => int.provider === activeTab);

  useEffect(() => {
    if (activeConfig) {
      setIsActive(activeConfig.isActive ?? false);
      setPublicKey(activeConfig.publicKey || "");
      setSecretKey(activeConfig.secretKey || "••••••••••••••••");
      setWebhookSecret(activeConfig.webhookSecret || "••••••••••••••••");
      setCurrency(activeConfig.currency || "NGN");
    } else {
      setIsActive(false);
      setPublicKey("");
      setSecretKey("");
      setWebhookSecret("");
      setCurrency(activeTab === "stripe" ? "USD" : "NGN");
    }
  }, [activeConfig, activeTab]);

  if (!currentStore) return null;
  if (isLoading) {
    return (
      <Card className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </Card>
    );
  }

  const handleSave = () => {
    saveMutation.mutate({
      provider: activeTab,
      isActive,
      publicKey,
      secretKey,
      webhookSecret,
      currency,
    });
  };

  const providers = [
    { id: "flutterwave", name: "Flutterwave", desc: "Perfect for local and international cards and bank transfers across Africa." },
    { id: "stripe", name: "Stripe", desc: "Premium global processor accepting cards, Apple Pay, Google Pay, and localized bank rails." },
    { id: "paystack", name: "Paystack", desc: "Fast, reliable payments via cards, USSD, and bank transfers, tailored for Africa." },
    { id: "twilio", name: "Twilio SMS", desc: "Send automated SMS notifications to staff and customers for checkouts and bookings." },
    { id: "quickbooks", name: "QuickBooks", desc: "Synchronize transaction records, product list, and payroll reports with your QuickBooks ledger." },
  ];

  return (
    <Card className="border-primary/20 shadow-sm overflow-hidden">
      <CardHeader className="bg-muted/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <CreditCard className="h-6 w-6 text-primary" />
              Dynamic Payment Integrations
            </CardTitle>
            <CardDescription>
              Link your store to your personal payment gateways. Customers will pay directly into your account.
            </CardDescription>
          </div>
          <div className="flex bg-muted p-1 rounded-lg self-start md:self-auto">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveTab(p.id as any)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === p.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        <div className="flex items-start justify-between gap-4 p-4 bg-primary/5 rounded-lg border border-primary/10">
          <div className="space-y-1">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              {providers.find(p => p.id === activeTab)?.name} Integration
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
              }`}>
                {isActive ? "Active" : "Inactive"}
              </span>
            </h4>
            <p className="text-xs text-muted-foreground max-w-xl">
              {providers.find(p => p.id === activeTab)?.desc}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="active-toggle" className="text-xs font-semibold">Enable</Label>
            <Switch
              id="active-toggle"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Account SID" : activeTab === "quickbooks" ? "Client ID" : "Public Key"}
            </Label>
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder={activeTab === "twilio" ? "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" : activeTab === "quickbooks" ? "Enter QuickBooks Client ID" : "Enter public key"}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Auth Token" : activeTab === "quickbooks" ? "Client Secret" : "Secret Key"}
            </Label>
            <Input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={activeTab === "twilio" ? "Enter Twilio Auth Token" : activeTab === "quickbooks" ? "Enter QuickBooks Client Secret" : "Enter secret key"}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-1">
              {activeTab === "twilio" ? "Twilio Phone Number" : activeTab === "quickbooks" ? "Company ID (Realm ID)" : "Webhook Secret / Hash"}
            </Label>
            <Input
              type="text"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={activeTab === "twilio" ? "e.g. +1234567890" : activeTab === "quickbooks" ? "Enter Realm ID" : "Enter webhook secret"}
              className="font-mono text-sm"
            />
          </div>

          {activeTab !== "twilio" && activeTab !== "quickbooks" && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Settlement Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Settlement Currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">₦ NGN (Nigerian Naira)</SelectItem>
                  <SelectItem value="USD">$ USD (US Dollar)</SelectItem>
                  <SelectItem value="GHS">₵ GHS (Ghanaian Cedi)</SelectItem>
                  <SelectItem value="KES">KSh KES (Kenyan Shilling)</SelectItem>
                  <SelectItem value="GBP">£ GBP (British Pound)</SelectItem>
                  <SelectItem value="EUR">€ EUR (Euro)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="p-4 bg-muted/30 rounded-lg border text-xs space-y-2">
          <h5 className="font-semibold flex items-center gap-1 text-muted-foreground uppercase tracking-wider text-[10px]">
            <Lock className="h-3 w-3" /> Webhook Endpoint Url Configuration
          </h5>
          <p className="text-muted-foreground leading-relaxed">
            Copy the endpoint URL below and configure it in your {providers.find(p => p.id === activeTab)?.name} developer settings dashboard to enable automatic checkout payment status updates:
          </p>
          <div className="flex items-center justify-between gap-4 p-2 bg-background border rounded font-mono text-[11px] overflow-x-auto select-all">
            {typeof window !== "undefined" ? window.location.origin : ""}/api/payments/webhook/{activeTab}
          </div>
        </div>
      </CardContent>

      <Separator />

      <CardContent className="pt-6 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          )}
          Save Integration Settings
        </Button>
      </CardContent>
    </Card>
  );
}
