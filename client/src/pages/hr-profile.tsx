import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useHasPermission } from "@/lib/permissions";
import { IconButton } from "@/components/icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PersonalTab } from "@/components/hr/PersonalTab";
import { JobTab } from "@/components/hr/JobTab";
import { TimeOffTab } from "@/components/hr/TimeOffTab";
import { EmergencyContactsTab } from "@/components/hr/EmergencyContactsTab";
import { DocumentsTab } from "@/components/hr/DocumentsTab";
import { BenefitsTab } from "@/components/hr/BenefitsTab";
import { DisciplinaryTab } from "@/components/hr/DisciplinaryTab";
import { GuarantorTab } from "@/components/hr/GuarantorTab";

interface SectionConfig { section: string; isEnabled: boolean }

/**
 * The BambooHR-style employee profile: personal, job, time off, emergency,
 * documents, benefits, disciplinary, guarantor - one tab per section, shown
 * only when the business has it enabled (hr_section_config, admin-configured
 * at /admin/businesses/:id/hr). Reached at /staff/hr-profile (self, any
 * role) or /staffs/:id/hr-profile (manager/owner viewing another staff
 * member's profile) - see client/src/App.tsx.
 */
export default function HrProfilePage() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const staffId = id || user?.staffId || "";
  const isViewingSelf = !id || id === user?.staffId;
  const { hasPermission: canManage } = useHasPermission("Staff & Payroll");
  const backHref = id ? "/staffs" : "/";

  const { data: sections = [], isLoading } = useQuery<SectionConfig[]>({
    queryKey: ["/api/hr/sections"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/sections")).json(),
  });

  const isEnabled = (section: string) => sections.find((s) => s.section === section)?.isEnabled ?? true;

  if (!staffId) {
    return <div className="p-6 text-sm text-muted-foreground">No staff profile found.</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <IconButton label="Back" variant="ghost" className="h-8 w-8" onClick={() => setLocation(backHref)}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <h1 className="text-lg font-bold">{isViewingSelf ? "My HR Profile" : "HR Profile"}</h1>
      </div>

      <Tabs defaultValue="personal">
        <TabsList className="flex-wrap h-auto">
          {isEnabled("personal") && <TabsTrigger value="personal" data-testid="tab-hr-personal">Personal</TabsTrigger>}
          {isEnabled("job") && <TabsTrigger value="job" data-testid="tab-hr-job">Job</TabsTrigger>}
          {isEnabled("time_off") && <TabsTrigger value="time_off" data-testid="tab-hr-timeoff">Time Off</TabsTrigger>}
          {isEnabled("emergency") && <TabsTrigger value="emergency" data-testid="tab-hr-emergency">Emergency</TabsTrigger>}
          {isEnabled("documents") && <TabsTrigger value="documents" data-testid="tab-hr-documents">Documents</TabsTrigger>}
          {isEnabled("benefits") && <TabsTrigger value="benefits" data-testid="tab-hr-benefits">Benefits</TabsTrigger>}
          {canManage && isEnabled("disciplinary") && <TabsTrigger value="disciplinary" data-testid="tab-hr-disciplinary">Disciplinary</TabsTrigger>}
          {isEnabled("guarantor") && <TabsTrigger value="guarantor" data-testid="tab-hr-guarantor">Guarantor</TabsTrigger>}
        </TabsList>

        {isEnabled("personal") && <TabsContent value="personal"><PersonalTab staffId={staffId} /></TabsContent>}
        {isEnabled("job") && <TabsContent value="job"><JobTab staffId={staffId} canManage={canManage} /></TabsContent>}
        {isEnabled("time_off") && <TabsContent value="time_off"><TimeOffTab staffId={staffId} canManage={canManage} /></TabsContent>}
        {isEnabled("emergency") && <TabsContent value="emergency"><EmergencyContactsTab staffId={staffId} basePath="/api/hr" /></TabsContent>}
        {isEnabled("documents") && <TabsContent value="documents"><DocumentsTab staffId={staffId} /></TabsContent>}
        {isEnabled("benefits") && <TabsContent value="benefits"><BenefitsTab staffId={staffId} /></TabsContent>}
        {canManage && isEnabled("disciplinary") && <TabsContent value="disciplinary"><DisciplinaryTab staffId={staffId} /></TabsContent>}
        {isEnabled("guarantor") && <TabsContent value="guarantor"><GuarantorTab staffId={staffId} basePath="/api/hr" /></TabsContent>}
      </Tabs>
    </div>
  );
}
