import { Clock } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useStore } from "@/lib/store-context";
import { AttendanceSettingsSection } from "./components/attendance-settings";
import { NoStoreSelected } from "./components/no-store-selected";

/** Split out of the old settings-store.tsx tab hub - see store-details.tsx. */
export default function SettingsAttendancePage() {
  const { currentStore, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Attendance and clock-in" description="How this store records who came in, and when." scope="store" />
      {!currentStore || currentStore.id === "all" ? (
        <NoStoreSelected icon={Clock} action="configure clock-in and geofencing" />
      ) : (
        <AttendanceSettingsSection />
      )}
    </div>
  );
}
