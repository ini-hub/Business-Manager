import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { StoresManagementSection } from "./components/stores-management";

/**
 * Split out of the old settings-business.tsx tab hub so this gets its own
 * URL (/settings/stores) and therefore its own breadcrumb - a tab swap kept
 * the URL (and so the breadcrumb) pinned to "Business" no matter which tab
 * was open, which read as a stray "Business" crumb on the Stores/Roles tabs.
 */
export default function SettingsStoresPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Manage Stores"
        description="Add, edit, or remove your business locations."
        actions={<BackToSettingsButton />}
      />
      <StoresManagementSection />
    </div>
  );
}
