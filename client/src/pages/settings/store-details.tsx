import { Store } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { useStore } from "@/lib/store-context";
import { StoreDetailsSection } from "./components/store-details";
import { NoStoreSelected } from "./components/no-store-selected";

/**
 * Split out of the old settings-store.tsx tab hub so this gets its own URL
 * (/settings/store-details) and breadcrumb, instead of every store-scoped
 * settings tab sharing one "Store Settings" crumb - see settings/stores.tsx
 * for the same split done on the Business Settings side.
 */
export default function SettingsStoreDetailsPage() {
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
      <PageHeader
        title="Store Details"
        description="Receipt branding, low-stock threshold, payroll defaults, and loyalty configuration."
        actions={<BackToSettingsButton />}
      />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={Store} action="configure receipt branding and payroll defaults" />
      ) : (
        <StoreDetailsSection />
      )}
    </div>
  );
}
