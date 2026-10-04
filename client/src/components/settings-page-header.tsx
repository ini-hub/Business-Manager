import { BackToSettingsButton } from "@/components/settings-back-button";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";

type Scope = "business" | "store";

/**
 * Header for every page that hangs off /settings. The scope pill tells the
 * reader up front whether a change touches every store or only the one
 * selected in the top bar. Navigation back is a BackButton (icon only on a phone), not a breadcrumb, so every settings page looks the same.
 */
export function SettingsPageHeader({
  title,
  description,
  scope,
  actions,
}: {
  title: string;
  description: string;
  scope: Scope;
  actions?: React.ReactNode;
}) {
  return (
    <PageHeader
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-lg font-bold">{title}</span>
          <ScopeBadge scope={scope} />
        </span>
      }
      description={description}
      inlineActions
      hideBreadcrumb
      actions={
        <>
          <BackToSettingsButton />
          {actions}
        </>
      }
    />
  );
}

export function ScopeBadge({ scope }: { scope: Scope }) {
  const { currentStore } = useStore();
  const storeName = currentStore && currentStore.id !== "all" ? currentStore.name : "This store";
  return scope === "store" ? (
    <span
      title={`${storeName} only`}
      className="flex min-w-0 shrink-0 items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
    >
      <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{storeName}</span>
      <span className="shrink-0">&nbsp;only</span>
    </span>
  ) : (
    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      All stores
    </span>
  );
}
