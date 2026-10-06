import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useStore } from "@/lib/store-context";
import { StoresManagementSection } from "./components/stores-management";

/**
 * Split out of the old settings-business.tsx tab hub so this gets its own
 * URL (/settings/stores) and therefore its own breadcrumb - a tab swap kept
 * the URL (and so the breadcrumb) pinned to "Business" no matter which tab
 * was open, which read as a stray "Business" crumb on the Stores/Roles tabs.
 */
export default function SettingsStoresPage() {
  const [, setLocation] = useLocation();
  const { business } = useStore();
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Stores"
        description="Each store has its own customers, staff and stock."
        scope="business"
        actions={
          <AddButton label="Add a store" limit="store_count" onClick={() => setLocation("/settings/stores/new")} disabled={!business} data-testid="button-add-store" />
        }
      />
      <StoresManagementSection />
    </div>
  );
}
