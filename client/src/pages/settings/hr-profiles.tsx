import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { BackToSettingsButton } from "@/components/settings-back-button";
import { HrProfileSettingsSection } from "./components/hr-profile-settings";
import { HrSectionFieldsBuilder } from "./components/hr-section-fields-builder";

export default function SettingsHrProfilesPage() {
  const [selectedSection, setSelectedSection] = useState<"personal" | "job_current" | null>(null);

  if (selectedSection) {
    return (
      <HrSectionFieldsBuilder section={selectedSection} onBack={() => setSelectedSection(null)} />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Profile Settings"
        description="Configure profile sections and manage field requirements during onboarding."
        actions={<BackToSettingsButton />}
      />
      <HrProfileSettingsSection onSelectSection={setSelectedSection} />
    </div>
  );
}
