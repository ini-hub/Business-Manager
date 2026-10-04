import { MessageSquare } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useStore } from "@/lib/store-context";
import { WhatsAppNumberSection } from "./components/whatsapp-number-settings";
import { NoStoreSelected } from "./components/no-store-selected";

/** Mirrors payment-integrations.tsx - one settings sub-page per connectable integration. */
export default function SettingsWhatsAppNumberPage() {
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
      <SettingsPageHeader title="WhatsApp number" description="The number this store's customers get messages from." scope="store" />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={MessageSquare} action="configure a WhatsApp number" />
      ) : (
        <WhatsAppNumberSection />
      )}
    </div>
  );
}
