import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { BulkOperationsSection } from "./components/bulk-operations";

/** Split out of the old settings-store.tsx tab hub - see store-details.tsx. */
export default function SettingsBulkOperationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Operations"
        description="Bulk import or export staff, expenses, inventory, and customers."
        actions={<BackToSettingsButton />}
      />
      <BulkOperationsSection />
    </div>
  );
}
