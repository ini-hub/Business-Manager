import { useQuery } from "@tanstack/react-query";

export type ExportBranding = { enabled: boolean; text: string };

const DEFAULT: ExportBranding = { enabled: true, text: "Powered by Kowope App" };

/** Fetches the admin-managed "Powered by" line; falls back to the default if the call fails. */
export async function fetchExportBranding(): Promise<ExportBranding> {
  try {
    const res = await fetch("/api/export-branding", { credentials: "include" });
    if (!res.ok) return DEFAULT;
    return await res.json();
  } catch {
    return DEFAULT;
  }
}

/** Returns the line to print, or null when an admin has switched it off. */
export async function getPoweredByText(): Promise<string | null> {
  const b = await fetchExportBranding();
  return b.enabled && b.text ? b.text : null;
}

/** For React views (receipts, quotes) that are printed or captured to PDF. */
export function usePoweredByText(): string | null {
  const { data } = useQuery<ExportBranding>({
    queryKey: ["/api/export-branding"],
    queryFn: fetchExportBranding,
    staleTime: 5 * 60 * 1000,
  });
  const b = data ?? DEFAULT;
  return b.enabled && b.text ? b.text : null;
}
