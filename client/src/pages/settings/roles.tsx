import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { RolesPermissionsSection } from "./components/roles-permissions";

/**
 * Split out of the old settings-business.tsx tab hub so this gets its own
 * URL (/settings/roles) and therefore its own breadcrumb - see
 * settings/stores.tsx for the same split and why.
 */
export default function SettingsRolesPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Roles and permissions"
        description="What each role can open. Give someone a role from their staff profile."
        scope="business"
        actions={
          <AddButton label="Create custom role" gate="custom_roles_permissions" onClick={() => setLocation("/settings/roles/new")} data-testid="button-create-role" />
        }
      />
      <RolesPermissionsSection />
    </div>
  );
}
