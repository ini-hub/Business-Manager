import { useState } from "react";
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

export function HrProfileSettingsSection() {
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
        <CardDescription>Control which profile sections new staff members must complete before getting full access.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {SECTIONS.map(({ key, label }) => {
          const cfg = sections.find((s) => s.section === key);
          return (
            <div key={key} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                {cfg?.isRequiredForOnboarding && <Badge variant="secondary" className="mt-1">Required for onboarding</Badge>}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Required
                  <Switch
                    checked={cfg?.isRequiredForOnboarding ?? false}
                    onCheckedChange={(checked) => updateSection.mutate({ section: key, isRequiredForOnboarding: checked })}
                    disabled={updateSection.isPending}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Enabled
                  <Switch
                    checked={cfg?.isEnabled ?? true}
                    onCheckedChange={(checked) => updateSection.mutate({ section: key, isEnabled: checked })}
                    disabled={updateSection.isPending}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
