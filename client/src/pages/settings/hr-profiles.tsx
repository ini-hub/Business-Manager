import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { HrProfileSettingsSection } from "./components/hr-profile-settings";

export default function SettingsHrProfilesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Profile Settings"
        description="Configure which staff profile sections are enabled and required during onboarding."
        actions={<BackToSettingsButton />}
      />
      <HrProfileSettingsSection />
    </div>
  );
}
