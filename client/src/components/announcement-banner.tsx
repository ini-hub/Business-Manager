import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Info, AlertTriangle, Wrench, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Announcement = {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "update" | "maintenance";
  dismissible: boolean;
};

const TYPE_STYLES: Record<Announcement["type"], string> = {
  info: "bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900",
  update: "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900",
  warning: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
  maintenance: "bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900",
};

const TYPE_ICONS: Record<Announcement["type"], typeof Info> = {
  info: Info,
  update: Sparkles,
  warning: AlertTriangle,
  maintenance: Wrench,
};

const DISMISSED_KEY = "dismissed-announcements";

function getDismissedIds(): string[] {
  try {
    // sessionStorage, not localStorage - a dismissed banner should come back
    // next login/session, not be gone forever on this browser.
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function AnnouncementBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState<string[]>(getDismissedIds);

  const { data } = useQuery<{ announcements: Announcement[] }>({
    queryKey: ["/api/announcements"],
    enabled: !!user,
    refetchInterval: 5 * 60 * 1000,
  });

  const visible = (data?.announcements || []).filter((ann) => !dismissed.includes(ann.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  return (
    <div className="flex flex-col gap-px">
      {visible.map((ann) => {
        const Icon = TYPE_ICONS[ann.type] || Info;
        return (
          <div
            key={ann.id}
            data-testid={`banner-announcement-${ann.id}`}
            className={cn("flex items-start gap-3 border-b px-4 py-2.5 text-sm", TYPE_STYLES[ann.type] || TYPE_STYLES.info)}
          >
            <Icon className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="font-semibold leading-snug">{ann.title}</p>
              <p className="leading-snug whitespace-pre-wrap break-words">{ann.message}</p>
            </div>
            {ann.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(ann.id)}
                aria-label="Dismiss announcement"
                data-testid={`button-dismiss-announcement-${ann.id}`}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
