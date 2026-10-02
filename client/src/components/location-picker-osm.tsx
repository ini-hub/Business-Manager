import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PickedLocation } from "@/components/location-picker";

type Props = {
  value: PickedLocation;
  radiusMeters: number;
  onChange: (next: PickedLocation) => void;
  disabled?: boolean;
  /** Called if the map tiles/library cannot load, so the parent can show manual-entry guidance. */
  onUnavailable: () => void;
};

type GeocodeResult = { label: string; lat: number; lng: number };

const DEFAULT_CENTER: [number, number] = [6.524379, 3.379206]; // Lagos

/**
 * Keyless map + address search (Leaflet / OpenStreetMap), used when Google Maps
 * is not configured. Search goes through our own /api/geocode proxy.
 */
export function LocationPickerOsm({ value, radiusMeters, onChange, disabled, onUnavailable }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const commitRef = useRef<(lat: number, lng: number, label?: string | null) => void>(() => {});
  const [ready, setReady] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const labelRef = useRef(value.label);
  labelRef.current = value.label;

  useEffect(() => {
    let cancelled = false;
    let map: any = null;

    (async () => {
      try {
        const [{ default: L }] = await Promise.all([
          import("leaflet"),
          import("leaflet/dist/leaflet.css"),
        ]);
        if (cancelled || !nodeRef.current) return;

        const has = value.latitude !== null && value.longitude !== null;
        const center: [number, number] = has ? [value.latitude!, value.longitude!] : DEFAULT_CENTER;

        map = L.map(nodeRef.current).setView(center, has ? 18 : 12);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        const icon = L.divIcon({
          className: "",
          html: '<div style="width:18px;height:18px;border-radius:9999px;background:#059669;border:3px solid #fff;box-shadow:0 0 0 1px #059669,0 2px 4px rgba(0,0,0,.4)"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = L.marker(center, { icon, draggable: !disabled }).addTo(map);
        const circle = L.circle(center, {
          radius: radiusMeters,
          color: "#059669",
          weight: 2,
          fillColor: "#10b981",
          fillOpacity: 0.15,
        }).addTo(map);

        const commit = (lat: number, lng: number, label?: string | null) => {
          marker.setLatLng([lat, lng]);
          circle.setLatLng([lat, lng]);
          onChangeRef.current({
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6)),
            label: label ?? null,
          });
        };
        marker.on("dragend", () => {
          const p = marker.getLatLng();
          commit(p.lat, p.lng);
        });
        map.on("click", (e: any) => {
          if (!disabled) commit(e.latlng.lat, e.latlng.lng);
        });

        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        commitRef.current = commit;
        setReady(true);
      } catch {
        if (!cancelled) onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // Mount-only, like the Google picker: rebuilding on every edit would reset the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) circleRef.current?.setRadius(radiusMeters);
  }, [radiusMeters, ready]);

  // Follow external changes (GPS capture, typed coordinates).
  useEffect(() => {
    if (!ready) return;
    const { latitude: lat, longitude: lng } = value;
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    markerRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setLatLng([lat, lng]);
    const map = mapRef.current;
    if (map && !map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }, [value.latitude, value.longitude, ready]);

  // Debounced address search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await apiRequest("GET", `/api/geocode?q=${encodeURIComponent(q)}`);
        const data: GeocodeResult[] = await res.json();
        if (cancelled) return;
        setResults(data);
        if (data.length === 0) setSearchError("No matches. Try a street and town, or drop the pin on the map.");
      } catch {
        if (!cancelled) setSearchError("Address search is unavailable right now. Click the map or enter coordinates.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const pick = (r: GeocodeResult) => {
    setResults([]);
    setQuery("");
    mapRef.current?.setView([r.lat, r.lng], 18);
    commitRef.current(r.lat, r.lng, r.label);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search address or place"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          data-testid="input-location-search"
        />
        {searching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
        {results.length > 0 && (
          <ul className="absolute z-[1000] mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover text-sm shadow-md" data-testid="location-search-results">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-accent"
                  onClick={() => pick(r)}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searchError && <p className="text-sm text-muted-foreground" data-testid="text-search-error">{searchError}</p>}

      <div className="relative">
        <div ref={nodeRef} data-testid="location-map" className="relative z-0 h-64 w-full rounded-md border bg-muted" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-muted/60">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
