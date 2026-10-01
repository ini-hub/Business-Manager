import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { HrProfileSettingsSection, HrFieldsSettingsSection } from "./components/hr-profile-settings";

export default function SettingsHrProfilesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Profile Settings"
        description="Configure profile sections, create custom forms, and set which information is required during onboarding."
        actions={<BackToSettingsButton />}
      />
      <HrProfileSettingsSection />
      <HrFieldsSettingsSection />
    </div>
  );
}
