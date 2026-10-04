import { Wallet } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useStore } from "@/lib/store-context";
import { CapitalAssetsSettings } from "./components/capital-assets-settings";
import { NoStoreSelected } from "./components/no-store-selected";

/** Mirrors whatsapp-number.tsx - one settings sub-page for capital/assets/liabilities inputs. */
export default function SettingsCapitalAssetsPage() {
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
      <SettingsPageHeader title="Capital and assets" description="What's been invested, what the business owns and what it owes. Feeds the balance sheet report." scope="store" />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={Wallet} action="manage capital and assets" />
      ) : (
        <CapitalAssetsSettings />
      )}
    </div>
  );
}
