import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const SECTIONS = [
  { key: "personal", label: "Personal Information" },
  { key: "job", label: "Job Information" },
  { key: "time_off", label: "Time Off" },
  { key: "emergency", label: "Emergency Contacts" },
  { key: "documents", label: "Documents" },
  { key: "benefits", label: "Benefits" },
  { key: "disciplinary", label: "Disciplinary Records" },
  { key: "guarantor", label: "Guarantor Form" },
] as const;

interface SectionConfig { section: string; isEnabled: boolean; isRequiredForOnboarding: boolean }

export function HrProfileSettingsSection({ onSelectSection }: { onSelectSection?: (section: "personal" | "job_current" | "time_off" | "emergency" | "documents" | "benefits" | "disciplinary" | "guarantor") => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sectionsUrl = `/api/hr/sections`;

  const { data: sections = [], isLoading } = useQuery<SectionConfig[]>({
    queryKey: [sectionsUrl],
    queryFn: async () => (await apiRequest("GET", sectionsUrl)).json(),
  });

  const updateSection = useMutation({
    mutationFn: async ({ section, ...body }: { section: string; isEnabled?: boolean; isRequiredForOnboarding?: boolean }) =>
      apiRequest("PUT", `${sectionsUrl}/${section}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [sectionsUrl] });
      toast({ title: "Setting saved" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not update section", description: getUserFriendlyError(error) }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Staff Profile Sections</CardTitle>
        <CardDescription>Control which profile sections new staff members must complete before getting full access. Click a section to customize its fields.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {SECTIONS.map(({ key, label }) => {
          const cfg = sections.find((s) => s.section === key);
          const mappedKey = key === "job" ? "job_current" : (key as "personal" | "job_current");
          return (
            <div key={key} className="border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => onSelectSection?.(mappedKey)}
                    className="text-left w-full hover:underline cursor-pointer"
                  >
                    <p className="text-sm font-medium text-primary">{label}</p>
                    {cfg?.isRequiredForOnboarding && <Badge variant="secondary" className="mt-1">Required for onboarding</Badge>}
                    <p className="text-xs text-muted-foreground mt-1">Click to manage fields →</p>
                  </button>
                </div>
                <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                    Required
                    <Switch
                      checked={cfg?.isRequiredForOnboarding ?? false}
                      onCheckedChange={(checked) => updateSection.mutate({ section: key, isRequiredForOnboarding: checked })}
                      disabled={updateSection.isPending}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                    Enabled
                    <Switch
                      checked={cfg?.isEnabled ?? true}
                      onCheckedChange={(checked) => updateSection.mutate({ section: key, isEnabled: checked })}
                      disabled={updateSection.isPending}
                    />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

