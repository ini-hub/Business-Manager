import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { RolesPermissionsSection } from "./components/roles-permissions";

/**
 * Split out of the old settings-business.tsx tab hub so this gets its own
 * URL (/settings/roles) and therefore its own breadcrumb - see
 * settings/stores.tsx for the same split and why.
 */
export default function SettingsRolesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Create custom staff roles with specific module access."
        actions={<BackToSettingsButton />}
      />
      <RolesPermissionsSection />
    </div>
  );
}
