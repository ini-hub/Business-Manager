import { useSearch } from "wouter";

/**
 * Appends the current full URL (path + query) as a `returnTo` param on `path`,
 * so a detail page can send the user back to the exact list/filters/tab they came from.
 */
export function appendReturnTo(path: string, currentLocation: string, currentSearch: string): string {
  const current = currentSearch ? `${currentLocation}?${currentSearch}` : currentLocation;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}returnTo=${encodeURIComponent(current)}`;
}

/**
 * Reads `returnTo` off the current URL for a detail page's "Back" link, falling back
 * to a fixed default when absent (e.g. a bookmarked/direct link with no origin context).
 */
export function useReturnTo(fallback: string): { backHref: string } {
  const search = useSearch();
  const returnTo = new URLSearchParams(search).get("returnTo");
  return { backHref: returnTo ? decodeURIComponent(returnTo) : fallback };
}
