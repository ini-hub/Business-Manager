import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/loader";

const SECTIONS = [
  { key: "personal", label: "Personal information" },
  { key: "job", label: "Job information" },
  { key: "time_off", label: "Time off" },
  { key: "emergency", label: "Emergency contacts" },
  { key: "documents", label: "Documents" },
  { key: "benefits", label: "Benefits" },
  { key: "disciplinary", label: "Disciplinary records" },
  { key: "guarantor", label: "Guarantor form" },
] as const;

type Level = "off" | "optional" | "required";

const LEVELS: { value: Level; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "Hidden from staff profiles." },
  { value: "optional", label: "Optional", desc: "Shown. Staff can fill it in any time." },
  { value: "required", label: "Required", desc: "Must be completed before a new staff member gets full access." },
];

const HINTS: Record<Level, string> = {
  off: "Hidden from staff profiles",
  optional: "Shown, can be filled in later",
  required: "Must be done before full access",
};

const toBody = (level: Level) => ({ isEnabled: level !== "off", isRequiredForOnboarding: level === "required" });

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

  if (isLoading) return <div className="flex justify-center py-8"><Spinner className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const levelOf = (key: string): Level => {
    const cfg = sections.find((s) => s.section === key);
    if (cfg && !cfg.isEnabled) return "off";
    return cfg?.isRequiredForOnboarding ? "required" : "optional";
  };
  const levels = SECTIONS.map((s) => levelOf(s.key));
  const shown = levels.filter((l) => l !== "off").length;
  const required = levels.filter((l) => l === "required").length;

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid gap-2 md:grid-cols-3">
        {LEVELS.map((l) => (
          <div key={l.value} className={cn("rounded-lg p-3 text-sm", l.value === "required" ? "bg-primary/10 text-primary" : "bg-muted/60")}>
            <p className="font-semibold">{l.label}</p>
            <p className={l.value === "required" ? "" : "text-muted-foreground"}>{l.desc}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm font-semibold">
        {required === 0 ? "New staff get full access straight away. Nothing is required." : `New staff must complete ${required} ${required === 1 ? "section" : "sections"} before they get full access.`}
      </p>

      <div className="mt-2 divide-y">
        {SECTIONS.map(({ key, label }, i) => {
          const level = levels[i];
          const mappedKey = key === "job" ? "job_current" : (key as "personal" | "job_current");
          return (
            <div key={key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground">{HINTS[level]}</p>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div role="radiogroup" aria-label={`${label} requirement`} className="inline-flex rounded-lg bg-muted p-1">
                  {LEVELS.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      role="radio"
                      aria-checked={level === l.value}
                      disabled={updateSection.isPending}
                      onClick={() => level !== l.value && updateSection.mutate({ section: key, ...toBody(l.value) })}
                      className={cn("rounded-md px-3 py-2 text-sm font-medium transition-colors", level === l.value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                      data-testid={`level-${key}-${l.value}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => onSelectSection?.(mappedKey)} className="inline-flex items-center gap-0.5 text-sm font-medium text-primary underline" data-testid={`fields-${key}`}>
                  Fields <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t pt-3 text-sm text-muted-foreground">{shown} of {SECTIONS.length} sections shown, {required} required</p>
    </div>
  );
}
