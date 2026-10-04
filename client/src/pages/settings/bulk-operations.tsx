import { SettingsPageHeader } from "@/components/settings-page-header";
import { BulkOperationsSection } from "./components/bulk-operations";

/** Split out of the old settings-store.tsx tab hub - see store-details.tsx. */
export default function SettingsBulkOperationsPage() {
  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Bulk operations" description="Import or export staff, expenses, inventory and customers." scope="store" />
      <BulkOperationsSection />
    </div>
  );
}
