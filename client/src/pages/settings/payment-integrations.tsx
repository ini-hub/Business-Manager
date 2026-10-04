import { CreditCard } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useStore } from "@/lib/store-context";
import { StoreIntegrationsSection } from "./components/store-integrations";
import { NoStoreSelected } from "./components/no-store-selected";

/** Split out of the old settings-store.tsx tab hub - see store-details.tsx. */
export default function SettingsPaymentIntegrationsPage() {
  const { currentStore, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Payments" description="Connect Flutterwave, Stripe or Paystack for this store's own checkout." scope="store" />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={CreditCard} action="configure payment integrations" />
      ) : (
        <StoreIntegrationsSection />
      )}
    </div>
  );
}
