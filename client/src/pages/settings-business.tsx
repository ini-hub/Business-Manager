import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { Building2, Pencil, MapPin, Phone, EyeOff } from "lucide-react";

/**
 * Org-wide business profile - applies across every store the business has,
 * never scoped to just one (see Store Settings, client/src/pages/settings-store.tsx,
 * for the per-store half). Used to be one tab of four sharing this same URL
 * (Business Profile / Manage Stores / Roles & Permissions / Billing) - a tab
 * swap never changes the URL, so every tab showed the same "Business"
 * breadcrumb and, on the Billing tab, a second nested page header duplicated
 * on screen. Stores, Roles, and Billing each now have their own route
 * (settings/stores.tsx, settings/roles.tsx, settings/billing.tsx) instead.
 */
export default function SettingsBusinessPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { business, isLoading, updateBusiness } = useStore();
  const { toast } = useToast();
  const isOwner = user?.role === "owner";
  const ownOnly = (business as any)?.staffOwnTransactionsOnly !== false;

  const setOwnOnly = async (checked: boolean) => {
    if (!business) return;
    try {
      await updateBusiness(business.id, { staffOwnTransactionsOnly: checked } as any);
      toast({ title: checked ? "Staff now see only their own transactions" : "Staff can now see all transactions" });
    } catch {
      toast({ title: "Couldn't update this setting", description: "Please try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Profile"
        description="Your business name, address, receipt prefix default, and branding."
        actions={<BackToSettingsButton />}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Business Information
            </CardTitle>
            <CardDescription>
              Your business details that appear across all stores
            </CardDescription>
          </div>
          {isOwner && (
            <Button
              variant="outline"
              onClick={() => setLocation(business ? "/settings/business/edit" : "/settings/business/new")}
              data-testid="button-edit-business"
            >
              <Pencil className="h-4 w-4 mr-2" />
              {business ? "Edit" : "Set Up"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {business ? (
            <div className="space-y-2">
              <p className="font-medium text-lg" data-testid="text-business-name">{business.name}</p>
              {(business as any).address && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {(business as any).address}
                </p>
              )}
              {(business as any).phone && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  {(business as any).phoneCountryCode || "+234"} {(business as any).phone}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No business information set up yet. {isOwner ? 'Click "Set Up" to add your business details.' : "Ask your business owner to set this up."}
            </p>
          )}
        </CardContent>
      </Card>

      {business && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <EyeOff className="h-5 w-5" />
              Transaction visibility
            </CardTitle>
            <CardDescription>
              Owners and managers always see every transaction. This controls everyone else.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="staff-own-transactions-only" className="text-sm">
                <span className="font-medium">Staff see only their own transactions</span>
                <span className="block text-muted-foreground">
                  A transaction counts as theirs when they processed the checkout or were the lead or assisting staff.
                  Customer spend and visit history stay hidden from the staff role regardless.
                </span>
              </label>
              <Switch
                id="staff-own-transactions-only"
                checked={ownOnly}
                onCheckedChange={setOwnOnly}
                disabled={!isOwner}
                data-testid="switch-staff-own-transactions-only"
              />
            </div>
            {!isOwner && <p className="mt-3 text-xs text-muted-foreground">Only the owner can change this.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
