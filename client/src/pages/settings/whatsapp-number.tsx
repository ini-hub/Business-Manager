import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
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
      <PageHeader
        title="WhatsApp Number"
        description="Connect or change the WhatsApp number this store's customers message."
        actions={<BackToSettingsButton />}
      />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={MessageSquare} action="configure a WhatsApp number" />
      ) : (
        <WhatsAppNumberSection />
      )}
    </div>
  );
}
