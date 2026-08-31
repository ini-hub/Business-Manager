/**
 * Lazy loader for the Google Maps JS API.
 *
 * The key is baked in at build time by Vite, so it must be present in the build
 * environment (Render's dashboard, not just at runtime) or the picker renders
 * keyless. Everything here degrades to `null` rather than throwing, so a missing
 * or rejected key leaves the manual coordinate inputs working.
 */

export const GOOGLE_MAPS_API_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "";

export const hasGoogleMapsKey = (): boolean => GOOGLE_MAPS_API_KEY.trim().length > 0;

/**
 * Loosely typed on purpose: pulling in @types/google.maps for a single settings
 * picker is not worth the dependency, and the surface used here is small.
 */
export type GoogleMapsApi = any;

let loaderPromise: Promise<GoogleMapsApi | null> | null = null;

export function loadGoogleMaps(): Promise<GoogleMapsApi | null> {
  if (loaderPromise) return loaderPromise;

  if (!hasGoogleMapsKey()) {
    loaderPromise = Promise.resolve(null);
    return loaderPromise;
  }

  loaderPromise = new Promise((resolve) => {
    // Already present (a second picker mounting, or an HMR reload).
    if (typeof window !== "undefined" && (window as any).google?.maps?.Map) {
      resolve((window as any).google.maps);
      return;
    }

    const existing = document.getElementById("google-maps-js") as HTMLScriptElement | null;
    const onReady = () => resolve((window as any).google?.maps ?? null);

    if (existing) {
      existing.addEventListener("load", onReady);
      existing.addEventListener("error", () => resolve(null));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-js";
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
      `&libraries=places,marker&loading=async&v=weekly`;
    script.addEventListener("load", onReady);
    // A rejected or unbilled key fails here; the caller falls back to manual entry.
    script.addEventListener("error", () => resolve(null));
    document.head.appendChild(script);
  });

  return loaderPromise;
}
