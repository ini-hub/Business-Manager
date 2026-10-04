import { useState } from "react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { HrProfileSettingsSection } from "./components/hr-profile-settings";
import { HrSectionFieldsBuilder } from "./components/hr-section-fields-builder";

export default function SettingsHrProfilesPage() {
  const [selectedSection, setSelectedSection] = useState<"personal" | "job_current" | "time_off" | "emergency" | "documents" | "benefits" | "disciplinary" | "guarantor" | null>(null);

  if (selectedSection) {
    return (
      <HrSectionFieldsBuilder section={selectedSection} onBack={() => setSelectedSection(null)} />
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Staff profile settings" description="What new staff fill in when they join." scope="business" />
      <HrProfileSettingsSection onSelectSection={setSelectedSection} />
    </div>
  );
}
