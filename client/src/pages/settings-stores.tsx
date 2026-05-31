import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { useStore } from "@/lib/store-context";
import { Building2, Store, ShieldCheck, Database, CreditCard, BookOpen, Pencil, MapPin, Phone } from "lucide-react";
import { StoresManagementSection } from "./settings/components/stores-management";
import { BusinessSettingsSection } from "./settings/components/business-settings";
import { RolesPermissionsSection } from "./settings/components/roles-permissions";
import { BulkOperationsSection } from "./settings/components/bulk-operations";
import { StoreIntegrationsSection } from "./settings/components/store-integrations";
import { BorrowBookSettingsSection } from "./settings/components/credit-sales-settings";

export default function SettingsStoresPage() {
  const [, setLocation] = useLocation();
  const {
    business,
    currentStore,
    isLoading,
  } = useStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const tabItems: TabItem[] = [
    { value: "stores", label: "Stores Management", icon: <Store className="h-4 w-4" /> },
    { value: "business", label: "Business Details", icon: <Building2 className="h-4 w-4" /> },
    { value: "roles", label: "Roles & Permissions", icon: <ShieldCheck className="h-4 w-4" />, testId: "tab-roles-permissions" },
    { value: "bulk", label: "Bulk Operations", icon: <Database className="h-4 w-4" />, testId: "tab-bulk-operations" },
    { value: "payments", label: "Plugins & Integrations", icon: <CreditCard className="h-4 w-4" /> },
    { value: "credit-sales", label: "Credit Sales Reminders", icon: <BookOpen className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business & Stores"
        description="Manage your business information and store locations"
      />

      <Tabs defaultValue="stores" className="w-full space-y-6">
        <PolymorphicTabsList tabs={tabItems} variant="default" />

        <TabsContent value="stores" className="space-y-6 mt-0">
          <StoresManagementSection />
        </TabsContent>

        <TabsContent value="business" className="space-y-6 mt-0">
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
              <Button
                variant="outline"
                onClick={() => {
                  setLocation(business ? "/settings/business/edit" : "/settings/business/new");
                }}
                data-testid="button-edit-business"
              >
                <Pencil className="h-4 w-4 mr-2" />
                {business ? "Edit" : "Set Up"}
              </Button>
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
                  No business information set up yet. Click "Set Up" to add your business details.
                </p>
              )}
            </CardContent>
          </Card>

          {!currentStore ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <Store className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure receipt branding.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <BusinessSettingsSection />
          )}
        </TabsContent>

        <TabsContent value="roles" className="space-y-6 mt-0 animate-in fade-in duration-200">
          <RolesPermissionsSection />
        </TabsContent>

        <TabsContent value="bulk" className="space-y-6 mt-0 animate-in fade-in duration-200">
          <BulkOperationsSection />
        </TabsContent>

        <TabsContent value="payments" className="space-y-6 mt-0">
          {!currentStore || currentStore.id === "all" ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <CreditCard className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure custom payment integrations.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <StoreIntegrationsSection />
          )}
        </TabsContent>

        <TabsContent value="credit-sales" className="space-y-6 mt-0">
          {!currentStore || currentStore.id === "all" ? (
            <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
              <BookOpen className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
                <CardDescription className="max-w-sm mt-1">
                  You need to select or create a store location first under the <strong>Stores Management</strong> tab to configure debt reminder policies.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <BorrowBookSettingsSection />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
