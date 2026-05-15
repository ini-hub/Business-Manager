import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, Link } from "wouter";
import { ChevronRight } from "lucide-react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  isLoading?: boolean;
}

export function PageHeader({ title, description, actions, isLoading = false }: PageHeaderProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
    );
  }

  const [location] = useLocation();
  const segments = location.split("/").filter(Boolean);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        {segments.length > 0 && (
          <div className="flex items-center text-xs text-muted-foreground mb-2">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            {segments.map((seg, i) => {
              const url = "/" + segments.slice(0, i + 1).join("/");
              const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
              const isLast = i === segments.length - 1;
              return (
                <div key={url} className="flex items-center">
                  <ChevronRight className="h-3 w-3 mx-1 opacity-50" />
                  {isLast ? (
                    <span className="font-medium text-foreground">{label}</span>
                  ) : (
                    <Link href={url} className="hover:text-foreground transition-colors">{label}</Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
